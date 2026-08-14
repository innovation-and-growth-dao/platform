'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, treasuryBucketsApi, type TreasuryOverview as Overview, type TreasuryBucket } from '@/lib/api';
import { CopyButton } from './copy-button';
import { MultisigSetup } from './multisig-setup';
import { HotWalletControls } from './hot-wallet-controls';
import { TreasuryBucketsPanel } from './treasury-buckets-panel';
import { TreasuryTransactions } from './treasury-transactions';
import { useTreasuryAutoRefresh } from '@/lib/treasury-refresh';
import { useT } from '@/lib/prefs-context';
import { useAuth } from '@/lib/auth-context';

const ada = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const BUCKET_COLOR: Record<string, string> = {
  rewards: 'bg-emerald-500',
  operations: 'bg-sky-500',
};
const roundColor = 'bg-violet-500';

/** §15 — Treasury overview: budget buckets (allocated/spent/remaining) + balances. */
export function TreasuryOverview() {
  const t = useT();
  const { profile } = useAuth();
  const [subTab, setSubTab] = useState<'overview' | 'transactions' | 'setup'>('overview');
  const [data, setData] = useState<Overview | null>(null);
  const [buckets, setBuckets] = useState<TreasuryBucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    treasuryApi.overview().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    // §15.5 — the multisig's sub-addresses (primary + labeled buckets), so the
    // headline Treasury balance can be their SUM rather than just the primary.
    treasuryBucketsApi.list().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  // §15 — reload on multisig broadcast (+ delayed re-checks for db-sync lag)
  // and on a slow background poll, so balances update without F5.
  useTreasuryAutoRefresh(load);

  // Total treasury = sum across every multisig sub-address (falls back to the
  // primary balance from the overview if the bucket list isn't loaded yet).
  const treasuryTotal = buckets.length > 0
    ? buckets.reduce((s, b) => s + b.balanceAda, 0)
    : (data?.treasury.balanceAda ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Treasury')}</h2>
        <p className="text-sm text-neutral-500">
          {t("The DAO's 3-of-5 multisig holds the budget; a low-balance hot wallet pays tx fees. Budgets: rewards, operations, and one per funding round.")}
        </p>
      </div>

      {/* §15 — Overview | Transactions sub-menu. */}
      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {(([['overview', t('Overview')], ['transactions', t('Transactions')], ...(profile ? [['setup', t('Treasury multisig setup')]] : [])] as const) as ['overview' | 'transactions' | 'setup', string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
              subTab === key
                ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'transactions' ? (
        <TreasuryTransactions />
      ) : subTab === 'setup' ? (
        // §15 — multisig setup: roster of board key submissions + assembled script address
        // (or "not yet built" banner). Moved to its own tab to keep the Overview focused.
        <MultisigSetup onAssembled={load} />
      ) : (
        <>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!data ? (
        <p className="text-sm text-neutral-500">{t('Loading…')}</p>
      ) : (
        <>
          {/* Balances */}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Headline = SUM across all multisig sub-addresses; the per-address
                breakdown (with Copy) lives in "Treasury buckets" below, so no
                address is duplicated here. Highlighted in blue as the key figure. */}
            <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
              <div className="text-xs text-neutral-500">{t('Treasury (multisig) balance')}</div>
              <div className="text-lg font-semibold tabular-nums text-blue-800 dark:text-blue-200">
                {data.treasury.configured ? `${ada(treasuryTotal)} ₳` : t('not configured')}
              </div>
              {/* Every sub-address with its label, on-chain address, live balance + copy. */}
              {buckets.length > 0 ? (
                <div className="mt-2 border-t border-blue-200 pt-1 dark:border-blue-900">
                  <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wide text-neutral-400">
                    <span>{t('Address')}</span>
                    <span>{t('Balance (on-chain)')}</span>
                  </div>
                  <ul className="divide-y divide-blue-200 dark:divide-blue-900">
                    {buckets.map((b) => (
                      <li key={b.id} className="py-1.5 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{b.label}{b.isPrimary ? <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-300">{t('primary')}</span> : null}</span>
                          <span className="tabular-nums font-medium">{b.balanceAda.toLocaleString()} ₳</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="min-w-0 truncate font-mono text-[10px] text-neutral-500" title={b.bech32Address}>{b.bech32Address}</span>
                          <CopyButton text={b.bech32Address} label={t('Copy')} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : data.treasury.configured ? (
                <div className="mt-0.5 text-[11px] text-neutral-500">{t('see Treasury buckets below')}</div>
              ) : null}
            </div>
            <Card
              label={t('Anchor hot wallet')}
              value={`${ada(data.hotWallet.balanceAda)} ₳`}
              addr={data.hotWallet.address}
              warn={data.hotWallet.balanceAda < data.hotWallet.minAda ? `${t('below')} ${data.hotWallet.minAda} ₳ ${t('— top-up needed')}` : undefined}
            />
          </div>
          {/* §15.5 — labeled buckets under the active multisig (with live
              balances + Copy). The panel self-renders create + rename + delete
              controls only for board members; everyone else sees the read-only
              roster. */}
          <TreasuryBucketsPanel onChange={load} />
          {/* §15.3 — board controls for the hot wallet (top up + sweep). Self-hides for non-board. */}
          <HotWalletControls />

          {/* Budget buckets — allocated, with spent overlaid as a bar. */}
          <div className="space-y-3">
            <div className="text-sm font-medium">{t('Budget allocation')}</div>
            {data.buckets.map((b) => {
              const pct = b.allocatedAda > 0 ? Math.min(100, (b.spentAda / b.allocatedAda) * 100) : 0;
              const color = BUCKET_COLOR[b.key] ?? roundColor;
              return (
                <div key={b.key} className="text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-xs text-neutral-500 tabular-nums">
                      {t('spent')} {ada(b.spentAda)} / {ada(b.allocatedAda)} ₳ · {ada(b.remainingAda)} {t('left')}
                    </span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className={`h-full ${color}`} style={{ width: `${Math.max(pct, b.spentAda > 0 ? 2 : 0)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex justify-between">
              <span className="text-neutral-500">{t('Treasury total')} <span className="text-xs text-neutral-400">{t('(all addresses, incl. hot wallet)')}</span></span>
              <span className="font-medium tabular-nums">{ada(data.totalAllocatedAda)} ₳</span>
            </div>
            <div className="flex justify-between pl-3 text-xs text-neutral-500">
              <span>{t('· of which hot wallet')}</span>
              <span className="tabular-nums">{ada(data.hotWallet.balanceAda)} ₳</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-neutral-100 pt-1 dark:border-neutral-800">
              <span className="text-neutral-500">{t('Total spent')}</span>
              <span className="font-medium tabular-nums">{ada(data.totalSpentAda)} ₳</span>
            </div>
            <div className="flex justify-between pl-3 text-xs text-neutral-500">
              <span>{t('· funding')}</span><span className="tabular-nums">{ada(data.spent.funding)} ₳</span>
            </div>
            <div className="flex justify-between pl-3 text-xs text-neutral-500">
              <span>{t('· rewards')}</span><span className="tabular-nums">{ada(data.spent.rewards)} ₳</span>
            </div>
            <div className="flex justify-between pl-3 text-xs text-neutral-500">
              <span>{t('· operations')}</span><span className="tabular-nums">{ada(data.spent.operations)} ₳</span>
            </div>
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}

function Card({ label, value, addr, warn, note, tone = 'neutral' }: { label: string; value: string; addr?: string | null; warn?: string; note?: string; tone?: 'blue' | 'neutral' }) {
  const t = useT();
  const wrap = tone === 'blue'
    ? 'rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40'
    : 'rounded-lg border border-neutral-200 p-3 dark:border-neutral-800';
  return (
    <div className={wrap}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === 'blue' ? 'text-blue-800 dark:text-blue-200' : ''}`}>{value}</div>
      {note ? <div className="mt-0.5 text-[11px] text-neutral-500">{note}</div> : null}
      {addr ? (
        <div className="mt-0.5 flex items-start gap-2">
          <div className="flex-1 break-all font-mono text-[11px] text-neutral-400">{addr}</div>
          <CopyButton text={addr} label={t('Copy')} />
        </div>
      ) : null}
      {warn ? <div className="mt-1 text-xs text-amber-600">{warn}</div> : null}
    </div>
  );
}
