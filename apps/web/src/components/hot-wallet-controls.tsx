'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, treasuryBucketsApi, type TreasuryOverview, type HotWalletHistoryItem, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';
import { ConfirmDialog } from './confirm-dialog';

/**
 * §15.3 — board-only controls for the anchor hot wallet:
 *   • Top up: prepare an OPS multisig action (treasury → hot wallet) for any
 *     amount up to the platform cap (1000 ₳).
 *   • Sweep: single-click move of all hot-wallet funds back into the multisig.
 *   • History: collapsible list of every top-up + sweep with explorer links.
 *     Persisted so the data survives page refresh.
 *
 * Self-hides for non-board users.
 */
export function HotWalletControls({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const { txUrl } = useExplorer();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [policy, setPolicy] = useState<{ minAda: number; topUpMaxAda: number; autoTopUpAda: number } | null>(null);
  const [history, setHistory] = useState<HotWalletHistoryItem[]>([]);
  const [amount, setAmount] = useState<string>('');
  const [busy, setBusy] = useState<'topup' | 'sweep' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccess] = useState<string | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [buckets, setBuckets] = useState<TreasuryBucket[]>([]);
  const [sourceBucketId, setSourceBucketId] = useState<string>('');

  const load = useCallback(() => {
    treasuryApi.overview().then(setOverview).catch(() => setOverview(null));
    treasuryApi.hotWalletPolicy().then(setPolicy).catch(() => setPolicy(null));
    treasuryApi.hotWalletHistory().then((r) => setHistory(r.items)).catch(() => setHistory([]));
    treasuryBucketsApi.list().then((r) => {
      setBuckets(r.buckets);
      // Default the top-up source to the OPERATIONS-flagged bucket (fallback primary).
      setSourceBucketId((cur) => cur || r.buckets.find((b) => b.isDefaultOperations)?.id || r.buckets.find((b) => b.isPrimary)?.id || '');
    }).catch(() => setBuckets([]));
  }, []);
  useEffect(load, [load]);

  if (!isBoard) return null;
  if (!overview || !policy) return null;
  if (!overview.hotWallet.address) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="font-semibold">{t('Hot wallet')}</div>
        <div className="mt-1 text-xs text-amber-700">{t('No anchor hot wallet is configured.')}</div>
      </section>
    );
  }
  const balance = overview.hotWallet.balanceAda;
  const low = balance < policy.minAda;
  const num = Number(amount);
  const validAmount = Number.isFinite(num) && num > 0 && num <= policy.topUpMaxAda;

  const topup = async () => {
    setError(null); setSuccess(null); setBusy('topup');
    try {
      await treasuryApi.prepareTopUp(num, sourceBucketId || undefined);
      setSuccess(`${t('Top-up of')} ${num.toLocaleString()} ₳ ${t('prepared — awaiting 3-of-5 board signatures in Actions.')}`);
      setAmount('');
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };
  const sweep = async () => {
    setConfirmSweep(false);
    setError(null); setSuccess(null); setBusy('sweep');
    try {
      const r = await treasuryApi.sweepHotWallet();
      setSuccess(`${t('Hot wallet swept to treasury — tx')} ${r.txHash.slice(0, 12)}…`);
      // Refresh history so the new sweep appears at the top.
      load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t('Hot wallet — board controls')}</div>
          <span className={`text-xs tabular-nums ${low ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}`}>
            {t('balance')} {balance.toLocaleString()} ₳ {low ? `(${t('below')} ${policy.minAda} ₳)` : ''}
          </span>
        </div>
        <p className="text-xs text-neutral-500">
          {t('Top-ups go through the standard 3-of-5 board signing flow (they appear in')} <strong>{t('Actions to sign')}</strong>{t(').')}
          {t('A sweep moves the full hot-wallet balance back into the treasury immediately (no threshold). A few ADA may remain at the hot wallet after a sweep due to the Cardano tx fee and minUTxO requirement.')}
        </p>
        {low ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t('⚠ Hot wallet is below')} {policy.minAda} ₳ — {t('the platform also auto-prepares a')} {policy.autoTopUpAda} ₳ {t('top-up when this happens. You can prepare a different amount below.')}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          {/* §15.6 — source bucket: only meaningful when the multisig has more
              than one bucket; defaults to the Operations-flagged one. */}
          {buckets.length > 1 ? (
            <label className="block text-xs">
              {t('Source bucket')}
              <select
                value={sourceBucketId}
                onChange={(e) => setSourceBucketId(e.target.value)}
                className="mt-0.5 block rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}{b.isDefaultOperations ? ` ${t('(Operations)')}` : ''} — {b.balanceAda.toLocaleString()} ₳
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs">
            {t('Top-up amount (₳, max')} {policy.topUpMaxAda.toLocaleString()})
            <input
              type="number"
              min={1}
              max={policy.topUpMaxAda}
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setSuccess(null); }}
              placeholder={String(policy.autoTopUpAda)}
              className="mt-0.5 block w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <button
            disabled={!validAmount || busy !== null}
            onClick={topup}
            className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
          >
            {busy === 'topup' ? '…' : t('Prepare top-up')}
          </button>
          <button
            disabled={balance <= 0 || busy !== null}
            onClick={() => setConfirmSweep(true)}
            title={balance <= 0 ? t('Hot wallet is empty.') : t('Move all hot-wallet funds back to the multisig treasury.')}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {busy === 'sweep' ? '…' : t('Sweep hot wallet → treasury')}
          </button>
        </div>
        {successMsg ? <div className="text-xs text-emerald-700 dark:text-emerald-300">{successMsg}</div> : null}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}

        {/* §15.3 — collapsible TX history. Persisted server-side so refreshing
            the page (or another board member loading it) sees the same list. */}
        <div className="rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>{t('Hot wallet ↔ treasury history')} ({history.length})</span>
            <span>{showHistory ? t('▾ hide') : t('▸ show')}</span>
          </button>
          {showHistory ? (
            history.length === 0 ? (
              <div className="px-2 pb-2 text-[11px] text-neutral-500">{t('No transactions yet.')}</div>
            ) : (
              <ul className="space-y-1 px-2 pb-2 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="rounded border border-neutral-200 bg-neutral-50/60 p-1.5 dark:border-neutral-800 dark:bg-neutral-800/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          h.direction === 'TOP_UP'
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        }`}>
                          {h.direction === 'TOP_UP' ? t('TOP-UP · treasury → hot') : t('SWEEP · hot → treasury')}
                        </span>
                        <span className="tabular-nums">{h.amountAda.toLocaleString()} ₳</span>
                        {/* §15.3 — status badge so the user sees WHERE in the
                            flow each top-up sits: pending sigs → ready (manual
                            broadcast) → broadcasting → PAID. */}
                        <StatusChip h={h} />
                      </span>
                      <span className="text-[11px] text-neutral-500">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    {h.txHash ? (
                      <div className="mt-0.5 break-all">
                        {t('tx')} <a href={txUrl(h.txHash)} target="_blank" rel="noreferrer" className="font-mono text-emerald-700 underline dark:text-emerald-400">{h.txHash} ↗</a>
                      </div>
                    ) : null}
                    {h.initiatedBy ? <div className="text-[11px] text-neutral-500">{t('initiated by')} {h.initiatedBy}</div> : null}
                    {/* §15.3 — once a top-up reaches READY, a board member must
                        broadcast the assembled tx from the wallet that controls
                        the treasury (we don't hold that key) and paste the hash
                        here. Inline so the user doesn't have to scroll up to
                        Actions. */}
                    {h.direction === 'TOP_UP' && (h.status === 'READY' || h.status === 'BROADCASTED') ? (
                      <TopUpBroadcastPanel id={h.id} onChange={load} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={confirmSweep}
        title={t('Sweep hot wallet?')}
        tone="danger"
        confirmLabel={t('Sweep to treasury')}
        message={
          <>
            {t('Move')} <strong>{balance.toLocaleString()} ₳</strong> {t('from the hot wallet back to the treasury multisig. This runs immediately (no multisig threshold). A small amount may remain at the hot wallet because of the Cardano tx fee and minUTxO requirement.')}
          </>
        }
        onConfirm={sweep}
        onCancel={() => setConfirmSweep(false)}
      />
    </>
  );
}

/** Per-row status pill in the history list. */
function StatusChip({ h }: { h: HotWalletHistoryItem }) {
  const t = useT();
  const cls: Record<string, string> = {
    PENDING_SIGS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    READY:        'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
    BROADCASTED:  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    CONFIRMED:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    FAILED:       'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    SWEPT:        'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  };
  const label = h.status === 'PENDING_SIGS' && h.threshold
    ? `${t('pending sigs')} · ${h.approvals ?? 0}/${h.threshold}`
    : h.status === 'READY' ? t('authorized · awaiting broadcast')
    : h.status === 'BROADCASTED' ? t('broadcast · awaiting on-chain')
    : h.status === 'CONFIRMED' ? t('✓ PAID')
    : h.status === 'SWEPT' ? t('✓ SWEPT')
    : h.status;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls[h.status] ?? cls.PENDING_SIGS}`}>
      {label}
    </span>
  );
}

/**
 * §15.3 — for OPS top-ups that have reached READY: the platform does NOT
 * hold the treasury's private key, so it can't broadcast the assembled
 * multisig tx automatically. A board member who DOES control that key
 * broadcasts the tx from their wallet and pastes the on-chain hash here.
 * We verify against the hot wallet address via Koios and flip to CONFIRMED.
 */
function TopUpBroadcastPanel({ id, onChange }: { id: string; onChange: () => void }) {
  const t = useT();
  const [tx, setTx] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[0-9a-f]{64}$/i.test(tx.trim());
  const submit = async () => {
    if (!valid) return;
    setBusy(true); setError(null);
    try { await treasuryApi.submitPayoutTx(id, tx.trim()); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
      <div className="font-semibold text-amber-800 dark:text-amber-200">{t('Manual broadcast needed')}</div>
      <div className="mt-0.5 text-neutral-700 dark:text-neutral-300">
        {t('The platform doesn’t hold the treasury signing key. Sign + broadcast this tx from the wallet that controls the treasury address, then paste the on-chain tx hash here so the platform can verify and mark it PAID.')}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          value={tx}
          onChange={(e) => { setTx(e.target.value); setError(null); }}
          placeholder={t('64-hex broadcast tx hash')}
          className="flex-1 rounded border border-neutral-300 px-2 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          disabled={!valid || busy}
          onClick={submit}
          className="rounded border border-emerald-500 px-2 py-0.5 text-[11px] text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
        >
          {busy ? '…' : t('Verify on-chain')}
        </button>
      </div>
      {error ? <div className="mt-1 text-red-600">{error}</div> : null}
    </div>
  );
}
