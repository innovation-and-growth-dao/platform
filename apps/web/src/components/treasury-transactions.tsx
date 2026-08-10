'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/prefs-context';
import { treasuryApi, type TreasuryTx } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { useAuth } from '@/lib/auth-context';
import { useTreasuryAutoRefresh } from '@/lib/treasury-refresh';

/**
 * §15 — Treasury → Transactions: every on-chain tx that touched a treasury address,
 * enriched with the platform's context (submission fee → proposal/submitter; board
 * action → purpose/destination). Board members can add/edit a title + note for any
 * tx (e.g. label an anonymous deposit "Intersect — Milestone 1"). Incoming green,
 * outgoing red.
 */
const DIRECTION_TABS = [
  { key: '', label: 'All' },
  { key: 'IN', label: 'Incoming' },
  { key: 'INTERNAL', label: 'Internal' },
  { key: 'OUT', label: 'Outgoing' },
] as const;

export function TreasuryTransactions() {
  const tr = useT();
  const { txUrl } = useExplorer();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [txs, setTxs] = useState<TreasuryTx[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // §15 — direction filter (default: all), free-text search (debounced) and
  // server-side pagination (max 50 per page).
  const [direction, setDirection] = useState<'' | 'IN' | 'OUT' | 'INTERNAL'>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState(''); // debounced value actually sent to the API
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    treasuryApi
      .transactions({ direction: direction || undefined, q: q || undefined, page })
      .then((r) => { setTxs(r.transactions); setTotal(r.total); setPageSize(r.pageSize); setPage(r.page); })
      .catch((e) => setError(e instanceof Error ? e.message : tr('Failed to load')));
  }, [direction, q, page]);
  useEffect(() => { load(); }, [load]);
  // §15 — new txs appear without F5: reload on multisig broadcast (+ delayed
  // re-checks while db-sync catches up) and on a slow background poll.
  useTreasuryAutoRefresh(load);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (txs === null) return <p className="text-sm text-neutral-500">{tr('Loading…')}</p>;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold">{tr('Treasury transactions')}</h3>
        <p className="text-xs text-neutral-500">
          {tr('Every on-chain transaction that touched a treasury address (the multisig + its buckets), newest first.')}{' '}
          <span className="text-emerald-700 dark:text-emerald-400">{tr('Incoming')}</span> {tr('in green,')}{' '}
          <span className="text-amber-700 dark:text-amber-400">{tr('internal')}</span> {tr('(between DAO wallets, incl. the hot wallet) in yellow,')}{' '}
          <span className="text-red-700 dark:text-red-400">{tr('outgoing')}</span> {tr('(funds leaving to an external address) in red.')}
          {isBoard ? ` ${tr('Board members can add context with Edit.')}` : ''}
        </p>
      </div>

      {/* Filter + search row. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
          {DIRECTION_TABS.map((d) => (
            <button
              key={d.key}
              onClick={() => { setDirection(d.key as typeof direction); setPage(1); }}
              className={`px-2.5 py-1 text-xs font-medium ${
                direction === d.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {tr(d.label)}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('Search address, tx hash, proposal ID (R1-P2) or title…')}
          className="min-w-64 flex-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span className="text-xs text-neutral-500">{total} {total === 1 ? tr('transaction') : tr('transactions')}</span>
      </div>

      {txs.length === 0 ? (
        <p className="text-sm text-neutral-500">{q || direction ? tr('No transactions match the filter.') : tr('No treasury transactions yet.')}</p>
      ) : (
        <ul className="space-y-2">
          {txs.map((t) => {
            const inbound = t.direction === 'IN';
            const internal = t.direction === 'INTERNAL';
            const displayLabel = t.annotationTitle || t.label;
            return (
              <li
                key={t.hash}
                className={`rounded-md border p-3 text-sm ${
                  inbound
                    ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
                    : internal
                      ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20'
                      : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        inbound
                          ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'
                          : internal
                            ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                            : 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100'
                      }`}
                    >
                      {inbound ? tr('Incoming') : internal ? tr('Internal') : tr('Outgoing')}
                    </span>
                    <span className="font-medium">{displayLabel}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`tabular-nums font-semibold ${
                        inbound
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : internal
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {/* Internal moves don't change what the DAO holds — no +/− sign. */}
                      {inbound ? '+' : internal ? '' : '−'}
                      {t.amountAda.toLocaleString(undefined, { maximumFractionDigits: 6 })} ₳
                    </span>
                    {isBoard ? (
                      <button
                        onClick={() => setEditing(editing === t.hash ? null : t.hash)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {editing === t.hash ? tr('Cancel') : tr('Edit')}
                      </button>
                    ) : null}
                  </span>
                </div>

                {/* Platform-derived context (proposal / submitter / destination). */}
                {t.proposalTitle || t.submitter || t.destAddress ? (
                  <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {t.proposalTitle ? (
                      <>
                        {tr('Proposal:')}{' '}
                        {t.proposalPublicId ? (
                          <span className="rounded bg-neutral-100 px-1 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            {t.proposalPublicId}
                          </span>
                        ) : null}{' '}
                        <span className="font-medium">{t.proposalTitle}</span>{' '}
                      </>
                    ) : null}
                    {t.submitter ? (
                      <>
                        · {tr('paid by')} <span className="font-medium">{t.submitter}</span>{' '}
                      </>
                    ) : null}
                    {t.destAddress ? (
                      <>
                        · {tr('to')} <span className="break-all font-mono text-[11px]">{t.destAddress}</span>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {/* §15 — the 3-of-5 board members whose signatures sent this tx. */}
                {t.signers && t.signers.length > 0 ? (
                  <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {tr('Signed by')}{' '}
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{t.signers.join(', ')}</span>
                  </div>
                ) : null}

                {/* Board-provided note + attribution. */}
                {t.annotationNote || t.annotatedBy ? (
                  <div className="mt-1 rounded border border-neutral-200 bg-white/60 px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
                    {t.annotationNote ? <span className="text-neutral-700 dark:text-neutral-300">{t.annotationNote}</span> : null}
                    {t.annotatedBy ? (
                      <span className="text-neutral-500"> — {tr('context by')} {t.annotatedBy}</span>
                    ) : null}
                  </div>
                ) : null}

                {/* Board edit form. */}
                {editing === t.hash ? (
                  <AnnotateForm tx={t} onDone={() => { setEditing(null); load(); }} />
                ) : null}

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  <span>{new Date(t.time * 1000).toLocaleString()}</span>
                  <span>·</span>
                  <span className="break-all font-mono">
                    {tr('tx')}{' '}
                    <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="underline">
                      {t.hash.slice(0, 16)}… ↗
                    </a>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pager — server returns max 50 per page. */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            ← {tr('Previous')}
          </button>
          <span className="text-neutral-500">{tr('Page')} {page} {tr('of')} {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {tr('Next')} →
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AnnotateForm({ tx, onDone }: { tx: TreasuryTx; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(tx.annotationTitle ?? '');
  const [description, setDescription] = useState(tx.annotationNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await treasuryApi.annotateTx(tx.hash, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('Failed to save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
      <div>
        <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          {t('Title (overrides')} &ldquo;{tx.label}&rdquo;)
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tx.label}
          maxLength={120}
          className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">{t('Note / context')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('e.g. "Intersect transaction for Milestone 1"')}
          rows={2}
          maxLength={2000}
          className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        />
      </div>
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? t('Saving…') : t('Save context')}
        </button>
        <span className="text-[11px] text-neutral-500">{t('Clear both fields and save to remove.')}</span>
      </div>
    </div>
  );
}
