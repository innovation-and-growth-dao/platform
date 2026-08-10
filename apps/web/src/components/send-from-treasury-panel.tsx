'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, configApi, treasuryBucketsApi, type TreasuryOverview, type PublicConfig, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTreasuryAutoRefresh } from '@/lib/treasury-refresh';
import { useT } from '@/lib/prefs-context';

/**
 * §15.4 — any board member can initiate an arbitrary outbound treasury
 * transfer (rotation, ad-hoc payouts, refunds, etc.). The form takes a
 * destination address, an amount in ADA, and a written context that becomes
 * the action description (audit trail). The request creates a
 * BOARD_TRANSFER MultisigAction; from there it follows the standard 3-of-5
 * Approve & sign flow (every board member sees it in the queue below).
 *
 * Self-hides for non-board users. The "Transaction context" field is
 * collapsible to keep the form compact when not in use.
 */
export function SendFromTreasuryPanel({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [buckets, setBuckets] = useState<TreasuryBucket[]>([]);
  const [sourceBucketId, setSourceBucketId] = useState<string>(''); // '' = primary
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useState('');
  const [context, setContext] = useState('');
  const [showContext, setShowContext] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi.overview().then(setOverview).catch(() => setOverview(null));
    configApi.get().then(setCfg).catch(() => setCfg(null));
    treasuryBucketsApi.list().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([]));
  }, []);
  useEffect(load, [load]);
  // Keep the source balances live after a broadcast (no F5).
  useTreasuryAutoRefresh(load);

  if (!isBoard) return null;
  // §15.3 — without the assembled multisig there's no on-chain source to
  // build a tx from (the platform doesn't sign the env TREASURY_ADDRESS),
  // so queueing a transfer would just create a row that can't be acted on.
  // Self-hides until the board completes setup.
  if (cfg && !cfg.multisigConfigured) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="font-semibold">{t('Send from treasury')}</div>
        <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('The board hasn’t finished assembling the multisig yet. Until every seat has submitted a signing key (see')}{' '}
          <strong>{t('Treasury multisig — setup')}</strong>{' '}
          {t('above), the platform doesn’t have a script address to send funds out of. The form returns once the multisig is built.')}
        </div>
      </section>
    );
  }

  // The picked source's live balance (defaults to primary). When buckets
  // are available, the dropdown lets the board switch between them.
  const selectedBucket = sourceBucketId
    ? buckets.find((b) => b.id === sourceBucketId)
    : buckets.find((b) => b.isPrimary);
  const treasuryAda = selectedBucket?.balanceAda ?? overview?.treasury.balanceAda ?? 0;
  const amt = Number(amount);
  const validAmount = Number.isFinite(amt) && amt > 0;
  const insufficient = validAmount && amt > treasuryAda;
  const validAddr = /^addr(_test)?[a-z0-9]+$/i.test(dest.trim());
  const validContext = context.trim().length >= 10 && context.trim().length <= 2000;
  // Queueing is allowed even when underfunded — the 3rd-signature gate refuses
  // to broadcast when the balance is short, so the action just sits PENDING_SIGS
  // until funds arrive (useful when a board member knows a sweep is coming).
  const canSubmit = validAddr && validAmount && validContext && !busy;

  const submit = async () => {
    setError(null); setSuccess(null); setBusy(true);
    try {
      await treasuryApi.prepareTransfer({
        destAddress: dest.trim(),
        amountAda: amt,
        context: context.trim(),
        sourceBucketId: sourceBucketId || undefined,
      });
      setSuccess(`${t('Transfer of')} ${amt.toLocaleString()} ₳ ${t('queued — awaiting 3-of-5 board signatures in the queue below.')}`);
      setDest(''); setAmount(''); setContext('');
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{t('Send from treasury')}</div>
        <span className="text-xs text-neutral-500 tabular-nums">
          {t('treasury balance')} {treasuryAda.toLocaleString()} ₳
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {t('Any board member can queue an outbound transfer. It then needs every board signature in the Approve & sign queue below; on the last signature the platform builds + broadcasts the tx.')}
      </p>
      {/* §15.5 — Source bucket picker. Only shown when more than the
          primary bucket exists; otherwise the primary is the implicit
          source and we don't clutter the form. */}
      {buckets.length > 1 ? (
        <label className="mt-2 block text-xs">
          {t('Source bucket')}
          <select
            value={sourceBucketId}
            onChange={(e) => { setSourceBucketId(e.target.value); setSuccess(null); }}
            className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {buckets.map((b) => (
              <option key={b.id} value={b.isPrimary ? '' : b.id}>
                {b.label} — {b.balanceAda.toLocaleString()} ₳
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem]">
        <label className="block text-xs">
          {t('Destination address')}
          <input
            value={dest}
            onChange={(e) => { setDest(e.target.value); setSuccess(null); }}
            placeholder={t('addr1… or addr_test1…')}
            className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="block text-xs">
          {t('Amount (₳)')}
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setSuccess(null); }}
            placeholder="0"
            className="mt-0.5 block w-full rounded-md border border-neutral-300 px-2 py-1 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>
      {/* Context — collapsible so the form is compact when idle. Required (10
          char min). Becomes the MultisigAction.description so every signer
          sees WHY they're approving. */}
      <div className="mt-2 rounded border border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
        >
          <span>
            {t('Transaction context (audit trail) — required')}
            <span className={`ml-2 text-[11px] font-normal ${validContext ? 'text-emerald-600' : 'text-neutral-500'}`}>
              {context.trim().length}/10 {t('min')}
            </span>
          </span>
          <span>{showContext ? `▾ ${t('hide')}` : `▸ ${t('show')}`}</span>
        </button>
        {showContext ? (
          <textarea
            value={context}
            onChange={(e) => { setContext(e.target.value); setSuccess(null); }}
            placeholder={t("Why is this transfer needed? E.g. 'Rotate funds from legacy treasury to new multisig (genesis bootstrap)', 'Reimburse Alice for hardware wallet purchase, see invoice #42', …")}
            rows={3}
            className="block w-full resize-y rounded-b border-t border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-900"
          />
        ) : null}
      </div>
      {insufficient ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ {t('Treasury holds')} {treasuryAda.toLocaleString()} ₳ — {t('short of the')} {amt.toLocaleString()} ₳ {t('you’re queueing. The action can still be queued and authorized; it just won’t broadcast on the 3rd signature until the treasury has the funds.')}
        </div>
      ) : null}
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
      {success ? <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{success}</div> : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={!canSubmit}
          onClick={submit}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? '…' : t('Queue transfer')}
        </button>
        {!validAddr && dest ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{t('address looks invalid (need addr… / addr_test…)')}</span> : null}
        {amount && !validAmount ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{t('amount must be')} {'>'} 0</span> : null}
      </div>
    </section>
  );
}
