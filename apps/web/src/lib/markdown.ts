/**
 * A tiny, dependency-free, XSS-safe Markdown → HTML renderer.
 *
 * We deliberately avoid pulling in a markdown library (see the project's
 * dependency-version lesson). This supports the subset the proposal editor's
 * toolbar produces — headings, bold, italic, inline code, links, and bullet /
 * numbered lists — and nothing else.
 *
 * Safety: the source is HTML-escaped FIRST, so user text can never inject tags.
 * The only HTML in the output is what this function emits, and link hrefs are
 * restricted to http(s)/mailto (no `javascript:` URIs).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline spans, applied to already-escaped text. Order matters (bold before italic). */
function inline(s: string): string {
  let t = s;
  // [text](url) — sanitize the href to http(s)/mailto only.
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const safe = /^(https?:\/\/|mailto:)/i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer" class="text-emerald-600 underline">${text}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>');
  t = t.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
  t = t.replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1 text-[0.9em] dark:bg-neutral-800">$1</code>');
  return t;
}

const H_CLASS: Record<string, string> = {
  h2: 'mt-3 text-base font-semibold',
  h3: 'mt-3 text-sm font-semibold',
  h4: 'mt-2 text-sm font-medium',
};

/** Render a markdown string to a safe HTML string. */
export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src ?? '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join('<br/>'))}</p>`);
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const tag = h[1].length === 1 ? 'h2' : h[1].length === 2 ? 'h3' : 'h4';
      out.push(`<${tag} class="${H_CLASS[tag]}">${inline(h[2])}</${tag}>`);
    } else if (ul) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul class="my-1 list-disc pl-5">');
        list = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol class="my-1 list-decimal pl-5">');
        list = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}
