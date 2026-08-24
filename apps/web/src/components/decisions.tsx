'use client';

import { useCallback, useEffect, useState } from 'react';
import { decisionsApi, type DecisionSummary, type DecisionDetail, type DecisionVote, type DecisionComment } from '@/lib/api';
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
  return (s || 'decision').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'decision';
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

// §28/§28 expiry helpers. expiresAt is stored as an ISO string or null (never).
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

function LastVoteLine({ v, onOpenProposal }: { v: DecisionVote; onOpenProposal: () => void }) {
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

// Prominent banner on a decision whose approval vote is live, with a one-click link to go vote.
function VoteInProgressBanner({ v, onOpen }: { v: DecisionVote; onOpen: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="text-sm text-amber-900 dark:text-amber-200">
        <span className="font-semibold">A vote {v.deleteVote ? 'to DELETE this decision' : 'to APPROVE this decision'} is in progress.</span>{' '}
        {v.voted} of {v.eligible} DReps voted · {v.ratioPct}% approval (need {v.thresholdPct}%).
      </div>
      <button onClick={onOpen} className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
        Open the vote →
      </button>
    </div>
  );
}

// ── integrity / verification box ──────────────────────────────────────────────
function IntegrityBox({ doc }: { doc: DecisionDetail }) {
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Decision integrity</h3>
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
function CommentCard({ c, doc, onDelete, onReply }: { c: DecisionComment; doc: DecisionDetail; onDelete: (id: string) => void; onReply?: (id: string) => void }) {
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

function Feedback({ doc, reload }: { doc: DecisionDetail; reload: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [open, setOpen] = useState(false); // feedback hidden by default

  const post = async (contentMd: string, parentId?: string) => {
    if (!contentMd.trim()) return;
    setBusy(true);
    try {
      await decisionsApi.comment(doc.id, contentMd.trim(), parentId);
      if (parentId) { setReplyTo(null); setReplyText(''); } else setText('');
      reload();
    } finally { setBusy(false); }
  };
  const del = async (id: string) => { await decisionsApi.deleteComment(id); reload(); };
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
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Give feedback on this decision…" className="w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900" />
          <button disabled={busy || !text.trim()} onClick={() => post(text)} className="mt-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? 'Posting…' : 'Post feedback'}</button>
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

// ── decision detail view (public) ──────────────────────────────────────────────
function DecisionDetailView({ id, onBack, onStartVote }: { id: string; onBack: () => void; onStartVote: (docId: string) => void }) {
  const [doc, setDoc] = useState<DecisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setParams } = useUrlNav();

  const load = useCallback(() => {
    decisionsApi.get(id).then(setDoc).catch((e) => setError(e instanceof Error ? e.message : 'not found'));
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

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-xs text-neutral-500 hover:underline">← Back to decisions</button>
      <div className={`rounded-lg border p-5 ${STATUS_STYLE[doc.status] ?? STATUS_STYLE.DRAFT}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{doc.title}</h2>
          <div className="flex items-center gap-2">
            {doc.lastVote?.status === 'ACTIVE' ? <VotingPill /> : null}
            <StatusBadge status={doc.status} />
          </div>
        </div>
        <div className="mb-4 text-xs text-neutral-500">By {doc.ownerName}{doc.publishedAt ? ` · published ${new Date(doc.publishedAt).toLocaleDateString()}` : ''}
          {doc.status === 'ACTIVE' && doc.approvedAt ? ` · approved ${new Date(doc.approvedAt).toLocaleDateString()}` : ''}
          {doc.status === 'ACTIVE' ? ' · obligatory to follow' : doc.status === 'DRAFT' ? ' · draft — not yet obligatory' : ''}</div>

        <ExpiryLine iso={doc.expiresAt} />

        <div className="prose max-w-none dark:prose-invert"><Markdown>{doc.contentMd}</Markdown></div>

        {doc.lastVote?.status === 'ACTIVE' ? (
          <VoteInProgressBanner v={doc.lastVote} onOpen={() => setParams({ view: 'internal', ip: doc.lastVote!.proposalId })} />
        ) : doc.lastVote ? (
          <div className="mt-4"><LastVoteLine v={doc.lastVote} onOpenProposal={() => setParams({ view: 'internal', ip: doc.lastVote!.proposalId })} /></div>
        ) : null}

        <IntegrityBox doc={doc} />

        {doc.canPropose ? (
          <div className="mt-4 flex gap-2">
            <button onClick={() => onStartVote(doc.id)} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
              Start a vote on this decision
            </button>
          </div>
        ) : null}

        <Feedback doc={doc} reload={load} />
      </div>
    </div>
  );
}

// ── public Decisions page (left nav) ──────────────────────────────────────
const FILTERS = ['all', 'active', 'draft', 'deleted'] as const;

export function Decisions() {
  const { get, setParams } = useUrlNav();
  const filter = (get('filter') as string) || 'all';
  const selected = get('doc');
  const [docs, setDocs] = useState<DecisionSummary[] | null>(null);

  useEffect(() => {
    setDocs(null);
    decisionsApi.list(filter === 'all' ? undefined : filter).then(setDocs).catch(() => setDocs([]));
  }, [filter]);

  const startVote = (docId: string) => setParams({ view: 'internal', newDecision: docId, doc: null, filter: null });

  if (selected) return <div className="mx-auto max-w-3xl"><DecisionDetailView id={selected} onBack={() => setParams({ doc: null })} onStartVote={startVote} /></div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Decisions</h2>
      </div>
      <p className="mb-3 text-sm text-neutral-500">The Council&rsquo;s rules. Active decisions are obligatory; drafts are proposed but not yet binding. Each decision&rsquo;s content is hashed and anchored on-chain when its approval vote opens.</p>

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
        <p className="text-sm text-neutral-500">No decisions.</p>
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

// ── "My Decisions" (My Area tab) ──────────────────────────────────────────
function MyDecisionEditor({ id, onDone }: { id: string | null; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null); // null = never
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) decisionsApi.get(id).then((d) => { setTitle(d.title); setContent(d.contentMd); setExpiresAt(d.expiresAt); }).catch(() => undefined);
  }, [id]);

  const save = async () => {
    setError(null); setBusy(true);
    try {
      if (id) await decisionsApi.update(id, { title, contentMd: content, expiresAt });
      else await decisionsApi.create({ title, contentMd: content, expiresAt });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
      <h3 className="mb-3 text-sm font-semibold">{id ? 'Edit decision' : 'New decision'}</h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Decision title"
        className="mb-3 w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
      />
      <MarkdownEditor value={content} onChange={setContent} title="Content" minRows={10} placeholder="Write the decision… (supports **bold**, *italics*, ## headings, lists)" />
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

export function MyDecisions() {
  const [docs, setDocs] = useState<DecisionSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const { setParams } = useUrlNav();

  const load = useCallback(() => {
    decisionsApi.mine().then(setDocs).catch(() => setDocs([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const publish = async (id: string) => { await decisionsApi.publish(id); load(); };
  const remove = async (id: string) => { await decisionsApi.remove(id); load(); };

  if (editing) {
    return <MyDecisionEditor id={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load(); }} />;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">My decisions</h3>
        <button onClick={() => setEditing('new')} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ New decision</button>
      </div>
      <p className="mb-3 text-xs text-neutral-500">Draft a decision privately, publish it for other DReps to review and give feedback, keep editing until you (or another DRep) open an approval vote — which freezes the content and anchors its hash. Only Council members can author — if you&rsquo;re a registered DRep, join the Council first (it&rsquo;s free).</p>
      {docs === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-neutral-500">You have no decisions yet.</p>
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
                  <button onClick={() => setParams({ view: 'decisions', doc: d.id })} className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-600">View</button>
                ) : null}
                {d.lastVote?.status === 'ACTIVE' ? (
                  <button onClick={() => setParams({ view: 'internal', ip: d.lastVote!.proposalId })} className="rounded border border-amber-500 px-2 py-0.5 text-amber-700 dark:text-amber-300">Open the vote</button>
                ) : d.status === 'DRAFT' || d.status === 'ACTIVE' ? (
                  <button onClick={() => setParams({ view: 'internal', newDecision: d.id })} className="rounded border border-emerald-600 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">Start approval vote</button>
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
