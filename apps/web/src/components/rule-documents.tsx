'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ruleDocumentsApi, type RuleDocSummary, type RuleDocDetail, type RuleDocVote, type RuleDocComment, type RuleAttachment, type AddAttachmentInput } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { useExplorer } from '@/lib/explorer';
import { MarkdownEditor, Markdown } from './markdown';

// ── helpers ──────────────────────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function downloadText(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function slugify(s: string) {
  return (s || 'rule-document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'rule-document';
}

// §27 — audience + editable-by option labels.
const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';
const RULE_AUDIENCE_LABEL: Record<string, string> = {
  BOARD: 'Board members only',
  MEMBERS: 'Board members, DReps and experts',
  EVERYONE: 'Everyone signed in (incl. viewers)',
};
const RULE_EDITABLE_LABEL: Record<string, string> = {
  PROPOSER: 'Only me (the author)',
  PROPOSER_BOARD: 'The author and board members',
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

// §27 — should an attachment's extracted text be shown formatted (Markdown) rather than raw? (Same
// heuristic as the §30 document feature: Markdown reads better rendered; CSV/tabular stays raw.)
function extractedIsMarkdown(a: Pick<RuleAttachment, 'mimeType' | 'fileName' | 'sourceUrl' | 'extractedText'>): boolean {
  const mime = (a.mimeType ?? '').toLowerCase();
  const name = `${a.fileName ?? ''} ${a.sourceUrl ?? ''}`.toLowerCase();
  if (mime.includes('markdown') || /\.(md|markdown)(\?|#|$)/.test(name)) return true;
  if (mime.includes('csv') || /\.csv(\?|#|$)/.test(name)) return false;
  const s = (a.extractedText ?? '').slice(0, 4000);
  if (!s.trim()) return false;
  const heading = /^#{1,6}\s+\S/m.test(s);
  const lines = s.split('\n').filter((l) => l.trim());
  const commaRows = lines.filter((l) => (l.match(/,/g)?.length ?? 0) >= 2).length;
  if (lines.length >= 3 && commaRows / lines.length > 0.7 && !heading) return false;
  const bold = /\*\*\S[\s\S]*?\S\*\*/.test(s);
  const list = /^\s{0,3}([-*+]|\d+\.)\s+\S/m.test(s);
  const table = /^\s*\|.+\|\s*$/m.test(s) && /^\s*\|?\s*:?-{3,}/m.test(s);
  const link = /\[[^\]]+\]\([^)]+\)/.test(s);
  return heading || bold || list || table || link;
}

// §27 — attachment editor (files / links) for the document editor. Mirrors the §30 version.
function RuleAttachmentEditor({
  items, linkDraft, setLinkDraft, linkTitle, setLinkTitle, onAddFile, onAddLink, onRemove, onRename, onInsertBody, disabled,
}: {
  items: { id?: string; source: string; title?: string | null; fileName?: string | null; sourceUrl?: string | null; note?: string | null; ok?: boolean }[];
  linkDraft: string;
  setLinkDraft: (v: string) => void;
  linkTitle: string;
  setLinkTitle: (v: string) => void;
  onAddFile: (dataUrl: string, fileName: string) => void | Promise<void>;
  onAddLink: (url: string, title?: string) => void | Promise<void>;
  onRemove: (index: number, id?: string) => void | Promise<void>;
  onRename?: (id: string, title: string) => void | Promise<void>;
  onInsertBody?: (index: number) => void | Promise<void>;
  disabled?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addLink = async () => {
    const url = linkDraft.trim();
    if (!url) return;
    setBusy(true);
    try { await onAddLink(url, linkTitle.trim() || undefined); setLinkDraft(''); setLinkTitle(''); } finally { setBusy(false); }
  };
  const saveRename = async () => {
    if (!renaming || !onRename) return;
    setBusy(true);
    try { await onRename(renaming.id, renaming.value.trim()); setRenaming(null); } finally { setBusy(false); }
  };
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        await onAddFile(dataUrl, file.name);
      }
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  return (
    <div className="space-y-2">
      {items.length ? (
        <ul className="space-y-1">
          {items.map((a, i) => (
            <li key={a.id ?? i} className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-800">
              {renaming && a.id && renaming.id === a.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: a.id!, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveRename(); } if (e.key === 'Escape') setRenaming(null); }}
                    placeholder={t('Document name')}
                    disabled={busy}
                    className={`${field} min-w-0 flex-1`}
                  />
                  <button type="button" onClick={() => void saveRename()} disabled={busy || !renaming.value.trim()} className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{t('Save name')}</button>
                  <button type="button" onClick={() => setRenaming(null)} disabled={busy} className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Cancel')}</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 rounded bg-neutral-100 px-1 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800">{a.source === 'LINK' ? t('link') : t('file')}</span>
                    {a.source === 'LINK'
                      ? <a href={a.sourceUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{a.title || a.sourceUrl}</a>
                      : <span>{a.title || a.fileName}</span>}
                    {a.source === 'LINK' && a.title && a.sourceUrl && a.title !== a.sourceUrl ? <span className="ml-2 truncate text-[11px] text-neutral-400">{a.sourceUrl}</span> : null}
                    {a.source !== 'LINK' && a.title && a.fileName && a.title !== a.fileName ? <span className="ml-2 truncate text-[11px] text-neutral-400">{a.fileName}</span> : null}
                    {a.note ? <span className={`ml-2 text-[11px] ${a.ok === false ? 'text-amber-600' : 'text-neutral-400'}`}>{a.note}</span> : null}
                  </span>
                  {!disabled ? (
                    <span className="flex shrink-0 items-center gap-2">
                      {onInsertBody && a.source === 'LINK' && a.ok ? (
                        <button type="button" onClick={() => void onInsertBody(i)} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">{t('Insert content into body')}</button>
                      ) : null}
                      {onRename && a.id ? (() => {
                        const auto = a.source === 'LINK' ? a.sourceUrl : a.fileName;
                        const named = !!a.title && a.title !== auto;
                        return <button type="button" onClick={() => setRenaming({ id: a.id!, value: named ? a.title! : '' })} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">{named ? t('Rename') : t('Add name')}</button>;
                      })() : null}
                      <button type="button" onClick={() => onRemove(i, a.id)} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700">{t('Remove')}</button>
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-neutral-500">{t('No files or links yet.')}</p>}
      {!disabled ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.json,.html" onChange={(e) => onFiles(e.target.files)} disabled={busy} className="text-sm" />
          </div>
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addLink(); } }}
            placeholder={t('Document name (optional) — e.g. “Budget 2026 proposal”')}
            disabled={busy}
            className={field}
          />
          <div className="flex gap-2">
            <input
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addLink(); } }}
              placeholder="https://… (Google Doc / Drive / any link)"
              disabled={busy}
              className={field}
            />
            <button type="button" onClick={() => void addLink()} disabled={busy || !linkDraft.trim()} className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Add link')}</button>
          </div>
          {busy ? <p className="text-xs text-neutral-500">{t('Checking…')}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// §27 — one attachment in the detail view: open a link, download a file, read its text formatted.
function RuleAttachmentView({ docId, a }: { docId: string; a: RuleAttachment }) {
  const t = useT();
  const [showText, setShowText] = useState(false);
  const [raw, setRaw] = useState(false);
  const readable = !!a.extractedText?.trim();
  const isMarkdown = extractedIsMarkdown(a);
  const download = async () => {
    const f = await ruleDocumentsApi.attachmentFile(docId, a.id);
    const el = document.createElement('a'); el.href = f.dataUrl; el.download = f.fileName || a.fileName || 'document'; el.click();
  };
  return (
    <li className="rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="mr-1.5 rounded bg-neutral-100 px-1 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800">{a.source === 'LINK' ? t('link') : t('file')}</span>
          {a.source === 'LINK'
            ? <a href={a.sourceUrl ?? '#'} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{a.title || a.sourceUrl}</a>
            : <span>{a.fileName || a.title}</span>}
          <span className={`ml-2 text-[11px] ${readable ? 'text-neutral-400' : 'text-amber-600'}`}>{readable ? `✓ ${t('readable here')}` : `· ${t('link only (not readable on our side)')}`}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {a.hasFile ? <button onClick={download} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('Download')}</button> : null}
          {readable ? <button onClick={() => setShowText((v) => !v)} className="text-xs text-neutral-500 hover:underline">{showText ? t('Hide text') : t('View text')}</button> : null}
        </span>
      </div>
      {showText && a.extractedText ? (
        <div className="mt-2">
          {isMarkdown ? (
            <div className="mb-1 text-right">
              <button onClick={() => setRaw((v) => !v)} className="text-[11px] text-neutral-400 hover:underline">{raw ? t('Show formatted') : t('Show raw text')}</button>
            </div>
          ) : null}
          {isMarkdown && !raw ? (
            <div className="prose prose-sm max-h-96 max-w-none overflow-auto rounded bg-neutral-50 p-3 dark:prose-invert dark:bg-neutral-900">
              <Markdown>{a.extractedText}</Markdown>
            </div>
          ) : (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{a.extractedText}</pre>
          )}
        </div>
      ) : null}
    </li>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700',
  DRAFT: 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900',
  DELETED: 'bg-neutral-100 dark:bg-neutral-800/40 border-neutral-200 dark:border-neutral-800 opacity-60',
  PRIVATE: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
};
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  DRAFT: 'bg-neutral-400/20 text-neutral-600 dark:text-neutral-300',
  DELETED: 'bg-red-500/10 text-red-600 dark:text-red-300',
  PRIVATE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

// §27/§28 expiry helpers.
const ymd = (iso: string) => iso.slice(0, 10);
const tomorrowYmd = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const toExpiryIso = (d: string) => new Date(d + 'T23:59:59').toISOString();
const defaultExpiry = () => new Date(Date.now() + 365 * 864e5).toISOString();
function ExpiryLine({ iso }: { iso: string | null }) {
  if (!iso) return <div className="mb-4 text-xs text-neutral-500">Expiration: <span className="font-medium text-neutral-700 dark:text-neutral-300">never</span></div>;
  const expired = new Date(iso).getTime() < Date.now();
  return (
    <div className="mb-4 text-xs text-neutral-500">
      Expiration: <span className={`font-medium ${expired ? 'text-red-600 dark:text-red-400' : 'text-neutral-700 dark:text-neutral-300'}`}>{new Date(iso).toLocaleDateString()}{expired ? ' (expired)' : ''}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status] ?? STATUS_BADGE.DRAFT}`}>{status}</span>;
}

function LastVoteLine({ v, onOpenProposal }: { v: RuleDocVote; onOpenProposal: () => void }) {
  const inProgress = v.status === 'ACTIVE';
  const outcome = inProgress ? 'Voting in progress' : v.approved ? 'Approved' : 'Rejected';
  return (
    <div className="text-xs text-neutral-600 dark:text-neutral-300">
      <span className="font-medium">Last vote:</span>{' '}
      <button onClick={onOpenProposal} className="text-emerald-700 underline decoration-dotted hover:text-emerald-600 dark:text-emerald-400">
        {v.publicId ?? 'proposal'}
      </button>{' '}
      — {v.deleteVote ? 'delete · ' : ''}
      {outcome} · {v.voted} of {v.eligible} DReps voted · {v.ratioPct}% approval (need {v.thresholdPct}%)
    </div>
  );
}

// A pulsing "voting in progress" pill (no emoji) — shown beside the status while a vote is live.
function VotingPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      VOTE IN PROGRESS
    </span>
  );
}

// Prominent banner on a document whose approval vote is live, with a one-click link to go vote.
function VoteInProgressBanner({ v, onOpen }: { v: RuleDocVote; onOpen: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="text-sm text-amber-900 dark:text-amber-200">
        <span className="font-semibold">A vote {v.deleteVote ? 'to DELETE this document' : 'to APPROVE this document'} is in progress.</span>{' '}
        {v.voted} of {v.eligible} DReps voted · {v.ratioPct}% approval (need {v.thresholdPct}%).
      </div>
      <button onClick={onOpen} className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
        Open the vote →
      </button>
    </div>
  );
}

// ── integrity / verification box ──────────────────────────────────────────────
function IntegrityBox({ doc }: { doc: RuleDocDetail }) {
  const { txUrl } = useExplorer();
  const [check, setCheck] = useState<null | 'ok' | 'bad'>(null);
  const anchoredTx = doc.lastVote?.anchorTxHash ?? null;
  const anchoredHash = doc.lastVote?.contentHash ?? null;

  const verify = async () => {
    const h = await sha256Hex(doc.contentMd);
    setCheck(h === doc.contentHash ? 'ok' : 'bad');
  };

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900/40">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Document integrity</h3>
      <div className="space-y-1">
        <div className="break-all font-mono text-xs">
          <span className="text-neutral-500">SHA-256(content): </span>{doc.contentHash}
        </div>
        {anchoredTx ? (
          <div className="text-xs">
            <span className="text-neutral-500">Anchored on-chain: </span>
            <a href={txUrl(anchoredTx)} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline dark:text-emerald-400">
              {anchoredTx.slice(0, 16)}…
            </a>
            {anchoredHash && anchoredHash !== doc.contentHash ? (
              <span className="ml-2 text-amber-600">⚠ current content differs from the anchored hash</span>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-neutral-500">Not yet anchored — a hash is written on-chain when an approval vote opens.</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={verify} className="rounded border border-emerald-600 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
          Verify in browser
        </button>
        <button onClick={() => downloadText(`${slugify(doc.title)}.md`, doc.contentMd)} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">
          Download content
        </button>
        {check === 'ok' ? <span className="text-xs font-medium text-emerald-600">✓ content matches the hash</span> : null}
        {check === 'bad' ? <span className="text-xs font-medium text-red-600">✗ mismatch</span> : null}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        To verify independently: click <em>Download content</em>, then run{' '}
        <code className="rounded bg-neutral-200 px-1 dark:bg-neutral-800">shasum -a 256 {slugify(doc.title)}.md</code>{' '}
        (macOS/Linux) or <code className="rounded bg-neutral-200 px-1 dark:bg-neutral-800">sha256sum {slugify(doc.title)}.md</code>.
        The output must equal the hash above{anchoredTx ? ' and the docHash inside the on-chain transaction metadata' : ''}.
      </p>
    </div>
  );
}

// ── feedback thread ────────────────────────────────────────────────────────────
function CommentCard({ c, doc, onDelete, onReply }: { c: RuleDocComment; doc: RuleDocDetail; onDelete: (id: string) => void; onReply?: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="flex items-center gap-2">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{c.authorName}</span>
          {c.authorRole ? <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{c.authorRole}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <span>{new Date(c.createdAt).toLocaleString()}</span>
          {!c.deleted && (c.isMine || doc.canModerate) ? <button onClick={() => onDelete(c.id)} className="text-red-500 hover:underline">delete</button> : null}
        </span>
      </div>
      {c.deleted ? <p className="text-sm italic text-neutral-400">[deleted]</p> : <div className="prose-sm text-sm"><Markdown>{c.contentMd ?? ''}</Markdown></div>}
      {onReply && !c.deleted ? <button onClick={() => onReply(c.id)} className="mt-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400">Reply</button> : null}
    </div>
  );
}

function Feedback({ doc, reload }: { doc: RuleDocDetail; reload: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [open, setOpen] = useState(false); // feedback hidden by default

  const post = async (contentMd: string, parentId?: string) => {
    if (!contentMd.trim()) return;
    setBusy(true);
    try {
      await ruleDocumentsApi.comment(doc.id, contentMd.trim(), parentId);
      if (parentId) { setReplyTo(null); setReplyText(''); } else setText('');
      reload();
    } finally { setBusy(false); }
  };
  const del = async (id: string) => { await ruleDocumentsApi.deleteComment(id); reload(); };
  const count = doc.comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <div className="mt-6">
      <button onClick={() => setOpen((o) => !o)} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        Feedback ({count})
        <span className="text-xs font-normal text-neutral-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {!open ? null : (
      <>
      <div className="space-y-3">
        {doc.comments.map((c) => (
          <div key={c.id}>
            <CommentCard c={c} doc={doc} onDelete={del} onReply={doc.canComment ? setReplyTo : undefined} />
            {(c.replies && c.replies.length > 0) || replyTo === c.id ? (
              <div className="ml-6 mt-2 space-y-2 border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
                {c.replies?.map((r) => <CommentCard key={r.id} c={r} doc={doc} onDelete={del} />)}
                {replyTo === c.id ? (
                  <div>
                    <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder="Reply…" className="w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900" />
                    <div className="mt-1 flex gap-2">
                      <button disabled={busy || !replyText.trim()} onClick={() => post(replyText, c.id)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? 'Posting…' : 'Reply'}</button>
                      <button onClick={() => { setReplyTo(null); setReplyText(''); }} className="rounded border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-600">Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {doc.comments.length === 0 ? <p className="text-xs text-neutral-500">No feedback yet.</p> : null}
      </div>
      {doc.canComment ? (
        <div className="mt-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Give feedback on this document…" className="w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900" />
          <button disabled={busy || !text.trim()} onClick={() => post(text)} className="mt-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? 'Posting…' : 'Post feedback'}</button>
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

// ── document detail view (public) ──────────────────────────────────────────────
function RuleDocDetailView({ id, onBack, onStartVote }: { id: string; onBack: () => void; onStartVote: (docId: string) => void }) {
  const [doc, setDoc] = useState<RuleDocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { setParams } = useUrlNav();

  const load = useCallback(() => {
    ruleDocumentsApi.get(id).then(setDoc).catch((e) => setError(e instanceof Error ? e.message : 'not found'));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // While an approval vote is live, refresh so the page reflects the outcome (ACTIVE / DRAFT) and
  // drops the "in progress" banner the moment the vote ends — no manual reload needed.
  useEffect(() => {
    if (doc?.lastVote?.status !== 'ACTIVE') return;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [doc?.lastVote?.status, load]);

  if (error) return <div className="text-sm text-red-500">{error} <button onClick={onBack} className="underline">back</button></div>;
  if (!doc) return <div className="text-sm text-neutral-500">Loading…</div>;

  if (editing && doc.editable) {
    return (
      <div>
        <button onClick={() => setEditing(false)} className="mb-3 text-xs text-neutral-500 hover:underline">← Back to document</button>
        <MyDocEditor id={doc.id} onDone={() => { setEditing(false); load(); }} />
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-xs text-neutral-500 hover:underline">← Back to rule documents</button>
      <div className={`rounded-lg border p-5 ${STATUS_STYLE[doc.status] ?? STATUS_STYLE.DRAFT}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{doc.title}</h2>
          <div className="flex items-center gap-2">
            {doc.editable ? <button onClick={() => setEditing(true)} className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">Edit</button> : null}
            {doc.lastVote?.status === 'ACTIVE' ? <VotingPill /> : null}
            <StatusBadge status={doc.status} />
          </div>
        </div>
        <div className="mb-4 text-xs text-neutral-500">By {doc.ownerName}{doc.publishedAt ? ` · published ${new Date(doc.publishedAt).toLocaleDateString()}` : ''}
          {doc.status === 'ACTIVE' && doc.approvedAt ? ` · approved ${new Date(doc.approvedAt).toLocaleDateString()}` : ''}
          {doc.status === 'ACTIVE' ? ' · obligatory to follow' : doc.status === 'DRAFT' ? ' · draft — not yet obligatory' : ''}</div>

        <ExpiryLine iso={doc.expiresAt} />

        <div className="prose max-w-none dark:prose-invert"><Markdown>{doc.contentMd}</Markdown></div>

        {doc.attachments.length ? (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Document files &amp; links</h3>
            <ul className="space-y-1">
              {doc.attachments.map((a) => <RuleAttachmentView key={a.id} docId={doc.id} a={a} />)}
            </ul>
          </div>
        ) : null}

        {doc.lastVote?.status === 'ACTIVE' ? (
          <VoteInProgressBanner v={doc.lastVote} onOpen={() => setParams({ view: 'internal', ip: doc.lastVote!.proposalId })} />
        ) : doc.lastVote ? (
          <div className="mt-4"><LastVoteLine v={doc.lastVote} onOpenProposal={() => setParams({ view: 'internal', ip: doc.lastVote!.proposalId })} /></div>
        ) : null}

        <IntegrityBox doc={doc} />

        {doc.canPropose ? (
          <div className="mt-4 flex gap-2">
            <button onClick={() => onStartVote(doc.id)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
              Start a vote on this document
            </button>
          </div>
        ) : null}

        <Feedback doc={doc} reload={load} />
      </div>
    </div>
  );
}

// ── public Rule Documents page (left nav) ──────────────────────────────────────
const FILTERS = ['all', 'active', 'draft', 'deleted'] as const;

export function RuleDocuments() {
  const { get, setParams } = useUrlNav();
  const filter = (get('filter') as string) || 'all';
  const selected = get('doc');
  const [docs, setDocs] = useState<RuleDocSummary[] | null>(null);

  useEffect(() => {
    setDocs(null);
    ruleDocumentsApi.list(filter === 'all' ? undefined : filter).then(setDocs).catch(() => setDocs([]));
  }, [filter]);

  const startVote = (docId: string) => setParams({ view: 'internal', newRule: docId, doc: null, filter: null });

  if (selected) return <div className="mx-auto max-w-3xl"><RuleDocDetailView id={selected} onBack={() => setParams({ doc: null })} onStartVote={startVote} /></div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Rule Documents</h2>
      </div>
      <p className="mb-3 text-sm text-neutral-500">The Council&rsquo;s rules. Active documents are obligatory; drafts are proposed but not yet binding. Each document&rsquo;s content is hashed and anchored on-chain when its approval vote opens.</p>

      <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setParams({ filter: f === 'all' ? null : f })}
            className={`px-3 py-1.5 text-sm capitalize ${filter === f ? 'border-b-2 border-emerald-600 font-medium text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {docs === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-neutral-500">No documents.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => setParams({ doc: d.id })}
              className={`block w-full rounded-lg border p-3 text-left transition hover:shadow-sm ${STATUS_STYLE[d.status] ?? STATUS_STYLE.DRAFT}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`font-medium ${d.status === 'DELETED' ? 'line-through' : ''}`}>{d.title}</span>
                <div className="flex items-center gap-2">
                  {d.lastVote?.status === 'ACTIVE' ? <VotingPill /> : null}
                  <StatusBadge status={d.status} />
                </div>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                By {d.ownerName}
                {d.status === 'ACTIVE' && d.approvedAt ? ` · approved ${new Date(d.approvedAt).toLocaleDateString()}` : ''}
              </div>
              {d.lastVote ? (
                <div className="mt-1 text-xs text-neutral-500">
                  Last vote {d.lastVote.publicId}: {d.lastVote.status === 'ACTIVE' ? 'in progress' : d.lastVote.approved ? 'approved' : 'rejected'} · {d.lastVote.voted}/{d.lastVote.eligible} voted · {d.lastVote.ratioPct}%
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── "My Rule documents" (My Area tab) ──────────────────────────────────────────
function MyDocEditor({ id, onDone }: { id: string | null; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [commentAudience, setCommentAudience] = useState('MEMBERS');
  const [docEditableBy, setDocEditableBy] = useState('PROPOSER');
  const [pendingAtts, setPendingAtts] = useState<(AddAttachmentInput & { note?: string; ok?: boolean })[]>([]);
  const [savedAtts, setSavedAtts] = useState<RuleAttachment[]>([]);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) ruleDocumentsApi.get(id).then((d) => {
      setTitle(d.title); setContent(d.contentMd); setExpiresAt(d.expiresAt);
      setCommentAudience(d.commentAudience); setDocEditableBy(d.docEditableBy); setSavedAtts(d.attachments);
    }).catch(() => undefined);
  }, [id]);

  const addLinkNew = async (url: string, name?: string) => {
    let note = t('checking…'); let ok: boolean | undefined;
    try { const p = await ruleDocumentsApi.probeLink(url); ok = p.ok; note = p.ok ? `✓ ${t('readable')} (${p.chars.toLocaleString()} ${t('chars')})` : `✗ ${p.note ?? t('could not read')}`; }
    catch { ok = false; note = `✗ ${t('could not read')}`; }
    setPendingAtts((s) => [...s, { source: 'LINK', url, title: name, note, ok }]);
  };
  const addFileNew = (dataUrl: string, fileName: string) => setPendingAtts((s) => [...s, { source: 'UPLOAD', dataUrl, fileName, note: t('will be read on save') }]);
  const insertBodyNew = async (index: number) => {
    const a = pendingAtts[index];
    if (!a?.url) return;
    if (content.trim() && !window.confirm(t('Replace the current content with the full content of this document?'))) return;
    setBusy(true); setError(null);
    try { const { text } = await ruleDocumentsApi.fetchLinkText(a.url); setContent(text); }
    catch (e) { setError(e instanceof Error ? e.message : t('could not read the link')); }
    finally { setBusy(false); }
  };
  const addLinkSaved = async (url: string, name?: string) => { const d = await ruleDocumentsApi.addAttachment(id!, { source: 'LINK', url, title: name }); setSavedAtts(d.attachments); };
  const addFileSaved = async (dataUrl: string, fileName: string) => { const d = await ruleDocumentsApi.addAttachment(id!, { source: 'UPLOAD', dataUrl, fileName }); setSavedAtts(d.attachments); };
  const removeSaved = async (_i: number, attId?: string) => { if (!attId) return; const d = await ruleDocumentsApi.removeAttachment(id!, attId); setSavedAtts(d.attachments); };
  const renameSaved = async (attId: string, name: string) => { const d = await ruleDocumentsApi.renameAttachment(id!, attId, name); setSavedAtts(d.attachments); };
  const insertBodySaved = async (index: number) => {
    const a = savedAtts[index];
    if (!a?.sourceUrl) return;
    if (content.trim() && !window.confirm(t('Replace the current content with the full content of this document?'))) return;
    setBusy(true); setError(null);
    try { const { text } = await ruleDocumentsApi.fetchLinkText(a.sourceUrl); setContent(text); }
    catch (e) { setError(e instanceof Error ? e.message : t('could not read the link')); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setError(null); setBusy(true);
    try {
      if (id) {
        await ruleDocumentsApi.update(id, { title, contentMd: content, expiresAt, commentAudience, docEditableBy });
      } else {
        const finalAtts = [...pendingAtts];
        if (linkDraft.trim()) finalAtts.push({ source: 'LINK', url: linkDraft.trim(), title: linkTitle.trim() || undefined });
        const payload: AddAttachmentInput[] = finalAtts.map((a) => ({ source: a.source, dataUrl: a.dataUrl, fileName: a.fileName, url: a.url, title: a.title }));
        await ruleDocumentsApi.create({ title, contentMd: content, expiresAt, commentAudience, docEditableBy, attachments: payload });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const items = id
    ? savedAtts.map((a) => ({ id: a.id, source: a.source, title: a.title, fileName: a.fileName, sourceUrl: a.sourceUrl, note: a.extractedText?.trim() ? `✓ ${t('readable')}` : null, ok: !!a.extractedText?.trim() }))
    : pendingAtts.map((a) => ({ source: a.source, fileName: a.fileName, sourceUrl: a.url, title: a.title, note: a.note, ok: a.ok }));

  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
      <h3 className="mb-3 text-sm font-semibold">{id ? 'Edit document' : 'New document'}</h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title"
        className="mb-3 w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
      />
      <MarkdownEditor value={content} onChange={setContent} title="Content" minRows={10} placeholder="Write the rules… (supports **bold**, *italics*, ## headings, lists)" />

      <div className="mt-4">
        <span className="text-sm font-medium">Files &amp; links</span>
        <p className="mb-1 text-xs text-neutral-500">Attach files or links (incl. Google Docs/Drive). A readable link can be inserted into the content so it becomes part of the hashed, on-chain document.</p>
        <RuleAttachmentEditor
          items={items}
          linkDraft={linkDraft}
          setLinkDraft={setLinkDraft}
          linkTitle={linkTitle}
          setLinkTitle={setLinkTitle}
          onAddFile={id ? addFileSaved : addFileNew}
          onAddLink={id ? addLinkSaved : addLinkNew}
          onRemove={id ? removeSaved : (i) => setPendingAtts((s) => s.filter((_, idx) => idx !== i))}
          onRename={id ? renameSaved : undefined}
          onInsertBody={id ? insertBodySaved : insertBodyNew}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Who can comment</label>
          <select className={field} value={commentAudience} onChange={(e) => setCommentAudience(e.target.value)}>
            {Object.entries(RULE_AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Who can edit the document</label>
          <select className={field} value={docEditableBy} onChange={(e) => setDocEditableBy(e.target.value)}>
            {Object.entries(RULE_EDITABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <span className="text-sm font-medium">Expiration</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={expiresAt === null} onChange={(e) => setExpiresAt(e.target.checked ? null : defaultExpiry())} />
          Never expires
        </label>
        {expiresAt !== null ? (
          <input type="date" value={ymd(expiresAt)} min={tomorrowYmd()} onChange={(e) => setExpiresAt(e.target.value ? toExpiryIso(e.target.value) : null)} className="rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900" />
        ) : null}
        <p className="text-xs text-neutral-400">A future date, or never (default). Once set, the expiry can only be shortened.</p>
      </div>
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button disabled={busy || title.trim().length < 3 || content.trim().length < 1} onClick={save} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-600">Cancel</button>
      </div>
    </div>
  );
}

export function MyRuleDocuments() {
  const [docs, setDocs] = useState<RuleDocSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const { setParams } = useUrlNav();

  const load = useCallback(() => {
    ruleDocumentsApi.mine().then(setDocs).catch(() => setDocs([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const publish = async (id: string) => { await ruleDocumentsApi.publish(id); load(); };
  const remove = async (id: string) => { await ruleDocumentsApi.remove(id); load(); };

  if (editing) {
    return <MyDocEditor id={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load(); }} />;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">My rule documents</h3>
        <button onClick={() => setEditing('new')} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ New document</button>
      </div>
      <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-300">
        <p className="mb-2"><span className="font-semibold text-neutral-700 dark:text-neutral-200">Use a rule document when</span> you are writing a rule for the DAO, or a document meant to be publicly available. The result lives here, in Rule Documents.</p>
        <p className="mb-1 font-semibold text-neutral-700 dark:text-neutral-200">How it works</p>
        <ol className="ml-4 list-decimal space-y-0.5">
          <li><span className="font-medium">Private</span> — you draft it (and attach files/links); only you can see it.</li>
          <li><span className="font-medium">Draft</span> — you publish it for others to read and comment (you choose who); you (and optionally board members) keep editing.</li>
          <li><span className="font-medium">Approval vote</span> — any DRep opens a vote on it. Submitting the vote <span className="font-medium">freezes the content, hashes it, anchors it on-chain</span> and ties it to that proposal. The document is locked while the vote runs.</li>
          <li><span className="font-medium">Active</span> — if approved, it becomes binding (obligatory). If rejected it returns to Draft; an approved delete vote marks it Deleted.</li>
        </ol>
        <p className="mt-2">Only members can author — if you&rsquo;re a registered DRep, join first (it&rsquo;s free).</p>
      </div>
      {docs === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-neutral-500">You have no rule documents yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className={`rounded-lg border p-3 ${STATUS_STYLE[d.status] ?? STATUS_STYLE.DRAFT}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`font-medium ${d.status === 'DELETED' ? 'line-through' : ''}`}>{d.title}</span>
                <div className="flex items-center gap-2">
                  {d.lastVote?.status === 'ACTIVE' ? <VotingPill /> : null}
                  <StatusBadge status={d.status} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {d.status !== 'PRIVATE' ? (
                  <button onClick={() => setParams({ view: 'rules', doc: d.id })} className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-600">View</button>
                ) : null}
                {d.lastVote?.status === 'ACTIVE' ? (
                  <button onClick={() => setParams({ view: 'internal', ip: d.lastVote!.proposalId })} className="rounded border border-amber-500 px-2 py-0.5 text-amber-700 dark:text-amber-300">Open the vote</button>
                ) : d.status === 'DRAFT' || d.status === 'ACTIVE' ? (
                  <button onClick={() => setParams({ view: 'internal', newRule: d.id })} className="rounded border border-emerald-600 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">Start approval vote</button>
                ) : null}
                {d.editable ? <button onClick={() => setEditing(d.id)} className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-600">Edit</button> : null}
                {d.status === 'PRIVATE' ? <button onClick={() => publish(d.id)} className="rounded border border-emerald-600 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">Publish (→ draft)</button> : null}
                {d.deletable ? <button onClick={() => remove(d.id)} className="rounded border border-red-500 px-2 py-0.5 text-red-600">{d.status === 'PRIVATE' ? 'Discard' : 'Delete'}</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
