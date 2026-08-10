'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardPaymentsApi, matchesProposalSearch, type FeePayment } from '@/lib/api';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { fmtDate } from './round-ui';
import { useT } from '@/lib/prefs-context';

/**
 * §12 — board task list for submission-fee settlements created by budget changes:
 * a TOPUP is owed BY the submitter (they pay more fee), a REFUND is owed TO the
 * submitter (the DAO returns fee). A board member records the on-chain tx to settle.
 * Self-hides when there's nothing outstanding.
 */
export function BoardPayments({ history = false, query }: { history?: boolean; query?: string }) {
  const t = useT();
  const [all, setAll] = useState<FeePayment[]>([]);
  const load = useCallback(() => {
    boardPaymentsApi.pending(history).then(setAll).catch(() => setAll([]));
  }, [history]);
  useEffect(load, [load]);

  const items = all.filter((p) => matchesProposalSearch(query, { title: p.proposalTitle, proposer: p.submitter, publicId: p.proposalPublicId }));
  if (items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="text-base font-semibold">{t('Payments to settle')}{history ? t(' (incl. history)') : ''}</h3>
      <p className="text-xs text-neutral-500">
        {t('Budget changes create a submission-fee')} <strong>{t('top-up')}</strong> {t('(the submitter owes more) or a')}
        <strong> {t('refund')}</strong> {t('(the DAO returns). Pay/collect on-chain, then record the tx to mark it done.')}
      </p>
      <ul className="space-y-2">
        {items.map((p) => (
          <PaymentRow key={p.id} p={p} onSettled={load} />
        ))}
      </ul>
    </section>
  );
}

function PaymentRow({ p, onSettled }: { p: FeePayment; onSettled: () => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const [tx, setTx] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTopup = p.kind === 'TOPUP';
  const settled = p.status === 'SETTLED';
  // §12 — a TOPUP is paid by the SUBMITTER: PENDING = waiting for their payment (board can't act);
  // AWAITING_CONFIRM = they paid + submitted the tx, the board verifies it on-chain + confirms.
  // A REFUND is paid by the BOARD: the board sends from the multisig and records the tx hash.
  const awaitingConfirm = p.status === 'AWAITING_CONFIRM';

  // REFUND → record the board's tx; TOPUP → confirm the submitter's already-submitted tx (no hash).
  const settle = async (withTx: boolean) => {
    setError(null);
    if (withTx && !tx.trim()) { setError(t('Paste the on-chain tx hash to settle.')); return; }
    setBusy(true);
    try {
      await boardPaymentsApi.settle(p.id, withTx ? tx.trim() : undefined);
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settle failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {p.proposalPublicId ? <span className="font-mono text-xs text-neutral-500">{p.proposalPublicId} · </span> : null}
          {p.proposalTitle ?? 'proposal'}
        </span>
        <span className="flex items-center gap-1.5">
          {settled ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ {t('SETTLED')}</span> : null}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${isTopup ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'}`}>
            {isTopup ? t('TOP-UP') : t('REFUND')}
          </span>
        </span>
      </div>
      <div className="mt-1 text-xs">
        <span className={`font-semibold ${isTopup ? 'text-amber-700 dark:text-amber-400' : 'text-sky-700 dark:text-sky-400'}`}>
          {isTopup ? `${t('Submitter owes')} ${p.amountAda.toLocaleString()} ₳` : `${t('Return')} ${p.amountAda.toLocaleString()} ₳ ${t('to the submitter')}`}
        </span>
        <span className="text-neutral-500">{p.submitter ? ` · ${p.submitter}` : ''}</span>
      </div>
      {/* Old → new fee (the "old payment" vs "current payment") + the budget change driving it. */}
      <div className="mt-0.5 text-xs text-neutral-500">
        {t('budget')} {p.prevAmountAda.toLocaleString()} → {p.newAmountAda.toLocaleString()} ₳
        {p.prevFeeAda != null && p.newFeeAda != null ? ` · ${t('fee')} ${p.prevFeeAda.toLocaleString()} → ${p.newFeeAda.toLocaleString()} ₳` : ''}
      </div>
      {/* §12 — the address to send a refund to (copyable). Top-ups are paid to the fee address. */}
      {!isTopup ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">{t('Refund to:')}</span>
          {p.payoutAddress ? (
            <>
              <span className="break-all font-mono text-neutral-700 dark:text-neutral-300">{p.payoutAddress}</span>
              <CopyButton text={p.payoutAddress} />
            </>
          ) : (
            <span className="text-amber-600">{t('no payout address on the proposal — ask the submitter')}</span>
          )}
        </div>
      ) : null}
      {settled ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span className="text-emerald-700 dark:text-emerald-400">✓ {t('Settled')}{p.settledAt ? ` ${fmtDate(p.settledAt)}` : ''}</span>
          {p.txHash ? (
            <>
              <span>· {t('tx')}</span>
              <span className="break-all font-mono text-neutral-600 dark:text-neutral-400">{p.txHash}</span>
              <CopyButton text={p.txHash} />
            </>
          ) : null}
        </div>
      ) : isTopup ? (
        // TOPUP — the submitter pays. Board only acts once they've submitted the tx (AWAITING_CONFIRM).
        awaitingConfirm ? (
          <div className="mt-2 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-neutral-500">{t('Submitter\'s top-up tx:')}</span>
              {p.txHash ? (
                <a href={txUrl(p.txHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">{p.txHash} ↗</a>
              ) : <span className="text-neutral-400">—</span>}
            </div>
            <button disabled={busy} onClick={() => settle(false)} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">
              {busy ? t('Confirming…') : t('Verify on-chain & confirm')}
            </button>
          </div>
        ) : (
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            ⏳ {t('Awaiting the submitter\'s top-up payment — they pay')} {p.amountAda.toLocaleString()} ₳ {t('and submit the tx on their proposal, then you confirm it here.')}
          </div>
        )
      ) : (
        // REFUND — the board sends from the multisig and records the tx hash.
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            placeholder={t('tx hash of the refund you sent')}
            value={tx}
            onChange={(e) => setTx(e.target.value)}
          />
          <button disabled={busy} onClick={() => settle(true)} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">
            {busy ? t('Saving…') : t('Mark settled')}
          </button>
        </div>
      )}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </li>
  );
}
