import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** SEC — SSRF guard. A user-supplied link is fetched server-side, so block loopback/link-local/
 *  private/reserved targets (incl. cloud metadata 169.254.169.254) and re-check on every redirect. */
function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-host / private / loopback
    if (a === 169 && b === 254) return true; // link-local + AWS/GCP IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true;
    if (lc.startsWith('fe80') || lc.startsWith('fc') || lc.startsWith('fd')) return true; // link-local + ULA
    if (lc.startsWith('::ffff:')) return isBlockedIp(lc.slice(7)); // v4-mapped
    return false;
  }
  return true; // unparseable → block
}

/** Resolve a hostname and assert every resolved address is a public, non-reserved IP. Throws otherwise. */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('that link points to a non-public address and cannot be fetched');
    return;
  }
  const results = await lookup(host, { all: true }).catch(() => {
    throw new Error('could not resolve the link host');
  });
  if (!results.length || results.some((r) => isBlockedIp(r.address))) {
    throw new Error('that link points to a non-public address and cannot be fetched');
  }
}

/** Max characters of extracted text we keep/feed the AI (keeps prompts + storage bounded). */
export const MAX_EXTRACTED_CHARS = 60_000;

export type ExtractResult = { text: string; note?: string };

/** Decode a `data:<mime>;base64,<...>` data URL into { mime, buffer }. */
export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isB64 = !!m[2];
  const buffer = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime, buffer };
}

function cleanText(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"'),
  );
}

/** Extract plain text from a document buffer by mime type (+ filename hint). Throws a user-facing
 *  message when a format can't be read, so the board sees why. */
export async function extractText(buffer: Buffer, mime: string, fileName?: string): Promise<ExtractResult> {
  const lower = (fileName ?? '').toLowerCase();
  const is = (t: string) => mime.includes(t);

  // PDF
  if (is('pdf') || lower.endsWith('.pdf')) {
    const r = await pdfParse(buffer);
    const text = cleanText(r.text ?? '');
    if (!text) throw new Error('This PDF has no extractable text (it may be a scanned image). Upload a text-based PDF, a DOCX, or paste as TXT.');
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), note: text.length > MAX_EXTRACTED_CHARS ? 'truncated' : undefined };
  }

  // DOCX (Office Open XML)
  if (is('officedocument.wordprocessingml') || lower.endsWith('.docx')) {
    const r = await mammoth.extractRawText({ buffer });
    const text = cleanText(r.value ?? '');
    if (!text) throw new Error('Could not read any text from this DOCX.');
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), note: text.length > MAX_EXTRACTED_CHARS ? 'truncated' : undefined };
  }

  // Legacy .doc (binary) — mammoth doesn't support it
  if (is('msword') || lower.endsWith('.doc')) {
    throw new Error('The old .doc format is not supported — save as DOCX, PDF, or TXT and re-upload.');
  }

  // HTML
  if (is('html') || lower.endsWith('.html') || lower.endsWith('.htm')) {
    const text = htmlToText(buffer.toString('utf8'));
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), note: text.length > MAX_EXTRACTED_CHARS ? 'truncated' : undefined };
  }

  // Plain text / markdown / json / csv / anything utf8-ish
  if (is('text') || is('json') || is('markdown') || is('csv') || lower.match(/\.(txt|md|markdown|json|csv)$/)) {
    const text = cleanText(buffer.toString('utf8'));
    if (!text) throw new Error('The file is empty.');
    return { text: text.slice(0, MAX_EXTRACTED_CHARS), note: text.length > MAX_EXTRACTED_CHARS ? 'truncated' : undefined };
  }

  // Unknown: best-effort as utf8 text, else reject.
  const guess = cleanText(buffer.toString('utf8'));
  if (guess && /[\x20-\x7e]/.test(guess) && !guess.includes('\u0000')) {
    return { text: guess.slice(0, MAX_EXTRACTED_CHARS), note: 'read as plain text (unknown type)' };
  }
  throw new Error(`Unsupported file type (${mime || 'unknown'}). Use PDF, DOCX, TXT, Markdown, or a link.`);
}

/** Rewrite an IPFS / Google Docs / Drive link to a directly-fetchable export URL. `googleExport`
 *  marks a Google export so the caller can detect a sign-in wall (HTML where a doc was expected). */
export function toFetchableUrl(raw: string): { url: string; googleExport: boolean } {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol === 'ipfs:') {
      const cid = raw.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//, '');
      return { url: `https://gateway.pinata.cloud/ipfs/${cid}`, googleExport: false };
    }
    const ipfsPath = /\/ipfs\/([^?#]+)/.exec(u.pathname);
    if (ipfsPath && /(^|\.)(ipfs\.io|dweb\.link|cloudflare-ipfs\.com)$/i.test(host)) {
      return { url: `https://gateway.pinata.cloud/ipfs/${ipfsPath[1]}`, googleExport: false };
    }
    if (host === 'docs.google.com') {
      const m = /^\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
      if (m) {
        const [, kind, id] = m;
        const format = kind === 'spreadsheets' ? 'csv' : kind === 'document' ? 'markdown' : 'txt';
        return { url: `https://docs.google.com/${kind}/d/${id}/export?format=${format}`, googleExport: true };
      }
    }
    if (host === 'drive.google.com') {
      const m = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname) ?? /[?&]id=([a-zA-Z0-9_-]+)/.exec(u.search);
      if (m) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, googleExport: true };
    }
  } catch {
    /* fall through to raw */
  }
  return { url: raw, googleExport: false };
}

/** Fetch a (possibly Google/Drive) link and extract its text. Returns the extracted text + the
 *  resolved mime. Throws Error with a user-facing message on any failure (unreadable, too large,
 *  permission wall). Used by §30 document attachments (LINK) and the scoring-tool templates. */
export async function fetchAndExtract(
  rawUrl: string,
  maxBytes = 30 * 1024 * 1024,
): Promise<{ text: string; note?: string; mime: string }> {
  const url = (rawUrl || '').trim();
  const { url: first, googleExport } = toFetchableUrl(url);
  // SEC (SSRF): block internal/loopback/link-local/private targets and re-validate on EVERY redirect
  // hop, so a public host cannot 30x into the internal network. Redirects are followed manually
  // (not 'follow') so each new host is checked before we connect to it; legitimate Google/Drive
  // exports (which redirect to public googleusercontent hosts) still work.
  let fetchUrl = first;
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:\/\//i.test(fetchUrl)) throw new Error('enter a valid http(s) link');
    await assertPublicHost(new URL(fetchUrl).hostname);
    res = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000), redirect: 'manual' }).catch((e) => {
      throw new Error(e instanceof Error ? e.message : String(e));
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      fetchUrl = new URL(loc, fetchUrl).toString();
      continue;
    }
    break;
  }
  if (!res) throw new Error('could not fetch the link');
  if (res.status >= 300 && res.status < 400) throw new Error('this link redirects too many times; paste the final document link');
  if (!res.ok) throw new Error(`the link returned ${res.status}`);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'text/html';
  if (googleExport && mime.includes('html')) {
    throw new Error(
      'this Google document is not publicly readable — in the document, Share → General access → "Anyone with the link" (Viewer), then paste the link again',
    );
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error('the linked document is too large');
  const { text, note } = await extractText(Buffer.from(ab), mime, url);
  return { text, note, mime };
}
