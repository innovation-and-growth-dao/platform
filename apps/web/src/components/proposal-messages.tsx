'use client';

import { useCallback, useEffect, useState } from 'react';
import { messagesApi, type MessageThread } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/** One message thread (board ↔ submitter back-and-forth) with a reply box. */
export function MessageThreadCard({ thread, canBoard, showProposal = false, onChange }: {
  thread: MessageThread;
  canBoard: boolean;
  showProposal?: boolean;
  onChange: () => void;
}) {
  const tr = useT();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try { await messagesApi.reply(thread.id, body); setReply(''); onChange(); }
    catch { /* keep the draft on failure */ } finally { setBusy(false); }
  };
  const markDone = async () => {
    setBusy(true);
    try { await messagesApi.markDone(thread.id); onChange(); }
    catch { /* */ } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {showProposal
            ? <span>{thread.proposalPublicId ? `${thread.proposalPublicId} · ` : ''}{thread.proposalTitle}</span>
            : <span className="text-neutral-500">{tr('Message')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${thread.status === 'DONE' ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
            {thread.status}
          </span>
          {canBoard && thread.status === 'OPEN' ? (
            <button onClick={markDone} disabled={busy} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{tr('Mark done')}</button>
          ) : null}
        </div>
      </div>
      <ul className="mt-2 space-y-2">
        {thread.entries.map((e) => (
          <li key={e.id} className={`flex ${e.fromBoard ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${e.fromBoard ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-sky-50 dark:bg-sky-950/30'}`}>
              <div className="text-[11px] text-neutral-500">
                {e.author ?? (e.fromBoard ? tr('Board') : tr('Submitter'))} · {e.fromBoard ? tr('Board') : tr('Submitter')} · {new Date(e.createdAt).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap">{e.body}</div>
            </div>
          </li>
        ))}
      </ul>
      {thread.status === 'OPEN' ? (
        <div className="mt-2 space-y-1">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder={tr('Write a reply…')}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button onClick={send} disabled={busy || !reply.trim()} className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? '…' : tr('Respond')}
          </button>
        </div>
      ) : (
        <div className="mt-1 text-xs text-neutral-400">{tr('Closed')}{thread.doneAt ? ` ${tr('on')} ${new Date(thread.doneAt).toLocaleDateString()}` : ''}.</div>
      )}
    </div>
  );
}

/** Per-proposal message history + (board) compose. Lives at the bottom of a proposal page. */
export function ProposalMessagesPanel({ proposalId, canBoard }: { proposalId: string; canBoard: boolean }) {
  const t = useT();
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { messagesApi.forProposal(proposalId).then(setThreads).catch(() => setThreads([])); }, [proposalId]);
  useEffect(() => { load(); }, [load]);

  const items = threads ?? [];
  // Submitters with no messages and no compose rights → nothing to show.
  if (!canBoard && items.length === 0) return null;

  const start = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try { await messagesApi.start(proposalId, body); setDraft(''); setComposing(false); load(); }
    catch { /* */ } finally { setBusy(false); }
  };

  return (
    <section id="proposal-messages" className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('Messages')} {items.length ? `(${items.length})` : ''}</h3>
        {canBoard ? (
          <button onClick={() => setComposing((v) => !v)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">
            {t('Send message to the submitter')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-neutral-500">{t('Board ↔ submitter messages for this proposal — e.g. asking the team to send the promised tokens to the Treasury. Visible to board members and the submitter only.')}</p>
      {composing ? (
        <div className="space-y-2 rounded border border-emerald-200 p-2 dark:border-emerald-900">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder={t('Ask the submitter to do something…')} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          <div className="flex gap-2">
            <button onClick={start} disabled={busy || !draft.trim()} className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? t('Sending…') : t('Send')}</button>
            <button onClick={() => { setComposing(false); setDraft(''); }} className="rounded border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">{t('Cancel')}</button>
          </div>
        </div>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-neutral-500">{t('No messages yet.')}</p> : items.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard={canBoard} onChange={load} />)}
    </section>
  );
}

/** Submitter's My-Area "Messages" tab — every thread across their proposals (open first, then closed). */
export function SubmitterMessages() {
  const t = useT();
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const load = useCallback(() => { messagesApi.mine().then(setThreads).catch(() => setThreads([])); }, []);
  useEffect(() => { load(); }, [load]);
  const items = threads ?? [];
  const open = items.filter((t) => t.status === 'OPEN');
  const done = items.filter((t) => t.status === 'DONE');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Messages')}</h2>
        <p className="text-sm text-neutral-500">{t('Messages from the board about your proposals — e.g. a request to send tokens to the Treasury. Respond here; the board is notified.')}</p>
      </div>
      {items.length === 0 ? <p className="text-sm text-neutral-500">{t('No messages.')}</p> : null}
      <div className="space-y-3">
        {open.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard={false} showProposal onChange={load} />)}
      </div>
      {done.length ? (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="text-sm font-medium text-neutral-500">{t('Closed')} ({done.length})</div>
          {done.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard={false} showProposal onChange={load} />)}
        </div>
      ) : null}
    </div>
  );
}

/** Per-proposal message tally + expandable history, shown next to a "Send message" button so the
 *  board can check existing communication before opening a new thread. */
export function ProposalMessageInfo({ proposalId, canBoard = true }: { proposalId: string; canBoard?: boolean }) {
  const t = useT();
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { messagesApi.forProposal(proposalId).then(setThreads).catch(() => setThreads([])); }, [proposalId]);
  useEffect(() => { load(); }, [load]);
  const items = threads ?? [];
  if (items.length === 0) return <span className="text-xs text-neutral-400">{t('no messages yet')}</span>;
  const active = items.filter((t) => t.status === 'OPEN').length;
  const done = items.filter((t) => t.status === 'DONE').length;
  return (
    <div className="text-xs">
      <button onClick={() => setOpen((v) => !v)} className="text-neutral-500 hover:underline">
        {t('Messages:')} <span className={`font-medium ${active > 0 ? 'text-amber-600' : 'text-neutral-700 dark:text-neutral-300'}`}>{active}</span> {t('active')} · <span className="font-medium text-neutral-700 dark:text-neutral-300">{done}</span> {t('done')} {open ? t('▴ hide') : t('▾ view')}
      </button>
      {open ? <div className="mt-2 space-y-2">{items.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard={canBoard} onChange={load} />)}</div> : null}
    </div>
  );
}

/** Board "all messages" screen — every thread (active first, then done history). */
export function BoardAllMessages({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const load = useCallback(() => { messagesApi.boardAll().then(setThreads).catch(() => setThreads([])); }, []);
  useEffect(() => { load(); }, [load]);
  const items = threads ?? [];
  const open = items.filter((t) => t.status === 'OPEN');
  const done = items.filter((t) => t.status === 'DONE');
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">{t('← back to actions')}</button>
      <div>
        <h2 className="text-lg font-semibold">{t('All messages')}</h2>
        <p className="text-sm text-neutral-500">{t('Every board ↔ submitter thread across all proposals —')} {open.length} {t('active,')} {done.length} {t('done.')}</p>
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium text-neutral-500">{t('Active')} ({open.length})</div>
        {open.length === 0 ? <p className="text-sm text-neutral-500">{t('No active messages.')}</p> : open.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard showProposal onChange={load} />)}
      </div>
      {done.length ? (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="text-sm font-medium text-neutral-500">{t('Done')} ({done.length})</div>
          {done.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard showProposal onChange={load} />)}
        </div>
      ) : null}
    </div>
  );
}

/** Board Actions to-do — threads where the submitter replied last (awaiting the board). */
export function BoardMessages({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const load = useCallback(() => { messagesApi.boardPending().then(setThreads).catch(() => setThreads([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (threads.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-base font-semibold">{t('Messages with responses')} ({threads.length})</h3>
      <p className="text-xs text-neutral-500">{t('§3.5 — submitters replied to these. Respond, or mark the thread done.')}</p>
      {threads.map((t) => <MessageThreadCard key={t.id} thread={t} canBoard showProposal onChange={() => { load(); onChange?.(); }} />)}
    </section>
  );
}
