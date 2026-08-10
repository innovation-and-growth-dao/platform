'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardDeadlinesApi, boardPledgeApi, messagesApi, matchesProposalSearch, type PendingPledge } from '@/lib/api';
import { ProposalMessageInfo } from './proposal-messages';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';

/**
 * §3 — board reviews on-chain pledge payments. The team committed a pledge at
 * proposal creation and pasted the tx hash after the proposal reached FUNDING.
 * The platform verifies the payment ON-CHAIN against the pledge address (same
 * verifyPayment used for the submission fee). Board Approves (confirms +
 * unlocks milestone POAs) or Rejects (team re-pastes a corrected hash).
 *
 * Self-hides when empty.
 */
export function PledgeConfirmations({ onChange, query }: { onChange?: () => void; query?: string }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [all, setAll] = useState<PendingPledge[]>([]);

  const load = useCallback(() => {
    boardPledgeApi.pending().then(setAll).catch(() => setAll([]));
  }, []);
  useEffect(load, [load]);

  const pending = all.filter((p) => matchesProposalSearch(query, { title: p.title, proposer: p.submitter, publicId: p.publicId }));
  if (pending.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">{t('Pledge payments to confirm')} ({pending.length})</h3>
      <p className="text-xs text-neutral-500">
        {t('The platform checks each pledge tx')} <strong>{t('on-chain')}</strong> {t('(did the paid amount reach the pledge address?).')}
        <strong> {t('Approve')}</strong> {t('to confirm — milestone POAs unlock — or')} <strong>{t('Reject')}</strong> {t('with a reason; the team will paste a corrected hash. Open the proposal to read the team’s return-method plan.')}
      </p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <PendingPledgeRow key={p.id} p={p} onReviewed={() => { load(); onChange?.(); }} onOpen={() => setParams({ proposal: p.id })} />
        ))}
      </ul>
    </section>
  );
}

function PendingPledgeRow({ p, onReviewed, onOpen }: { p: PendingPledge; onReviewed: () => void; onOpen: () => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §3.5 — invite the submitter to act (e.g. send the pledge to the Treasury) before confirming.
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState(false);

  const sendMessage = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try { await messagesApi.start(p.id, body); setDraft(''); setComposing(false); setSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : t('message failed')); } finally { setBusy(false); }
  };

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError(t('A reason is required to reject — the team will see it.'));
      return;
    }
    setBusy(true);
    try {
      await boardPledgeApi.review(p.id, decision, feedback.trim() || undefined);
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('review failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          {p.title}
        </button>
        <span className="text-xs text-neutral-500">
          {p.publicId ? <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span> : null}
          {p.roundNumber != null ? `${t('round')} #${p.roundNumber}` : ''}
          {p.submitter ? ` · ${t('by')} ${p.submitter}` : ''}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {t('pledge')} {p.pledgeAmountAda.toLocaleString()} ₳
        {p.pledgeReturnMethod ? ` · ${t('open the proposal to read the return-method plan')}` : ''}
        {/* §16.4 — grace window countdown + one-click extension. */}
        {p.pledgeGraceEndsAt ? (
          <span className={new Date(p.pledgeGraceEndsAt) < new Date() ? 'ml-2 font-medium text-red-600' : 'ml-2'}>
            · {t('grace until')} {new Date(p.pledgeGraceEndsAt).toLocaleDateString()}
            {new Date(p.pledgeGraceEndsAt) < new Date() ? ` ${t('(expired — extend or reject)')}` : ''}
          </span>
        ) : null}
        {p.pledgeGraceEndsAt ? (
          <button
            onClick={() => void boardDeadlinesApi.extendPledgeGrace(p.id, 14).then(onReviewed)}
            className="ml-2 rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100 dark:border-neutral-700"
            title={t('Extend the pledge grace window by 14 days (§16.4)')}
          >
            {t('+14 days grace')}
          </button>
        ) : null}
      </div>
      <div className="mt-1"><ProposalMessageInfo proposalId={p.id} /></div>

      <div className="mt-2 text-xs">
        <div className="font-medium text-neutral-600 dark:text-neutral-400">{t('Pledge tx:')}</div>
        {p.pledgeTxHash ? (
          <div>
            <a href={txUrl(p.pledgeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
              {p.pledgeTxHash} ↗
            </a>
            <span className="ml-2 font-medium">
              {p.verification.paid ? (
                <span className="text-emerald-600">✓ {t('paid')} {p.verification.paidAda.toLocaleString()} ₳</span>
              ) : p.verification.found ? (
                <span className="text-red-600">✗ {t('only')} {p.verification.paidAda.toLocaleString()} ₳ {t('to the pledge address')}</span>
              ) : (
                <span className="text-amber-600">⏳ {t('not found on-chain')}</span>
              )}
            </span>
          </div>
        ) : (
          <div className="text-amber-600">{t('no tx hash submitted yet')}</div>
        )}
      </div>

      <textarea
        className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        rows={2}
        placeholder={t('Feedback for the team (required to reject, optional to approve)')}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => review('APPROVE')}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? t('Working…') : p.verification.paid ? t('Approve — pledge verified') : t('Approve anyway')}
        </button>
        <button
          disabled={busy}
          onClick={() => review('REJECT')}
          className="rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
        >
          {t('Reject')}
        </button>
        <button
          disabled={busy}
          onClick={() => { setComposing((v) => !v); setDraft(''); }}
          className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700"
        >
          {t('Send message')}
        </button>
      </div>
      {composing ? (
        <div className="mt-2 space-y-1">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={t('Ask the submitter to do something — e.g. send the pledge to the Treasury…')} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
          <div className="flex gap-2">
            <button onClick={sendMessage} disabled={busy || !draft.trim()} className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">{t('Send')}</button>
            <button onClick={() => { setComposing(false); setDraft(''); }} className="rounded border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700">{t('Cancel')}</button>
          </div>
        </div>
      ) : null}
      {sent ? <div className="mt-1 text-xs text-emerald-600">✓ {t('Message sent — the submitter will see it under Messages and can respond.')}</div> : null}
    </li>
  );
}
