'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRevenueApi, messagesApi, matchesProposalSearch, type PendingRevenueSharing } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';
import { ProposalMessageInfo } from './proposal-messages';
import { useT } from '@/lib/prefs-context';

/**
 * §3.4 — board to-do: funded proposals that declared commercial/revenue-sharing terms must have
 * those conditions verified by the board before the team can submit milestone POAs. Without this,
 * the team is blocked with "the revenue-sharing conditions must be verified by the board…".
 */
export function RevenueSharingConfirmations({ onChange, query }: { onChange?: () => void; query?: string }) {
  const t = useT();
  const [all, setAll] = useState<PendingRevenueSharing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // §3.5 — inline "ask the submitter to do something" composer, keyed by proposal id.
  const [composeId, setComposeId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const load = useCallback(() => { boardRevenueApi.pending().then(setAll).catch(() => setAll([])); }, []);
  useEffect(load, [load]);

  const pending = all.filter((p) => matchesProposalSearch(query, { title: p.title, proposer: p.submitter, publicId: p.publicId }));
  if (pending.length === 0) return null;

  const verify = async (id: string) => {
    setConfirmId(null);
    setBusy(id);
    try { await boardRevenueApi.verify(id); load(); onChange?.(); }
    catch { /* leave the row in place */ } finally { setBusy(null); }
  };
  const sendMessage = async (proposalId: string) => {
    const body = draft.trim();
    if (!body) return;
    setBusy(proposalId);
    try { await messagesApi.start(proposalId, body); setDraft(''); setComposeId(null); setSent(proposalId); onChange?.(); }
    catch { /* */ } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-base font-semibold">{t('Revenue-sharing to verify')} ({pending.length})</h3>
      <p className="text-xs text-neutral-500">
        {t('§3.4 — these funded proposals declared commercial / revenue-sharing terms. Verify the conditions so the team can start submitting milestone POAs.')}
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.publicId ? `${p.publicId} · ` : ''}{p.title}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setComposeId((v) => (v === p.id ? null : p.id)); setDraft(''); }}
                  disabled={busy === p.id}
                  className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700"
                >
                  {t('Send message')}
                </button>
                <button
                  onClick={() => setConfirmId(p.id)}
                  disabled={busy === p.id}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === p.id ? '…' : t('Verify revenue-sharing')}
                </button>
              </div>
            </div>
            <div className="text-xs text-neutral-500">
              {t('by')} {p.submitter ?? '—'}{p.categoryName ? ` · ${p.categoryName}` : ''}{p.roundNumber != null ? ` · ${t('Round')} #${p.roundNumber}` : ''}
            </div>
            <div className="mt-1"><ProposalMessageInfo proposalId={p.id} /></div>
            {composeId === p.id ? (
              <div className="mt-2 space-y-1">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t('Ask the submitter to do something — e.g. send the promised tokens to the Treasury…')} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                <div className="flex gap-2">
                  <button onClick={() => sendMessage(p.id)} disabled={busy === p.id || !draft.trim()} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">{t('Send')}</button>
                  <button onClick={() => { setComposeId(null); setDraft(''); }} className="rounded border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700">{t('Cancel')}</button>
                </div>
              </div>
            ) : null}
            {sent === p.id ? <div className="mt-1 text-xs text-emerald-600">✓ {t('Message sent — the submitter will see it under Messages and can respond.')}</div> : null}
            {p.revenueSharingMd ? (
              <div className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-900/40 dark:text-neutral-300">
                {p.revenueSharingMd}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirmId}
        title={t('Verify revenue-sharing conditions?')}
        message={t("Confirm the proposal's commercial / revenue-sharing terms are acceptable. This unblocks the team to submit milestone POAs. It can't be undone.")}
        confirmLabel={t('Verify')}
        cancelLabel={t('Cancel')}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void verify(confirmId); }}
      />
    </section>
  );
}
