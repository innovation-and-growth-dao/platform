'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryBucketsApi, type TreasuryBucket } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';
import { ConfirmDialog } from './confirm-dialog';
import { useT } from '@/lib/prefs-context';

/**
 * §15.5 — labeled treasury buckets. Lists every bucket under the active
 * multisig with its live ₳ balance + a form (board-only) to add a new one.
 * Each bucket is a distinct on-chain address but spends with the same N
 * board signatures (see TreasuryBucketsService docstring).
 *
 * Self-hides until the multisig is assembled (no script to wrap).
 */
export function TreasuryBucketsPanel({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const [data, setData] = useState<{ multisigConfigured: boolean; buckets: TreasuryBucket[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    treasuryBucketsApi.list().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  if (!data) return null;
  if (!data.multisigConfigured) return null;

  const primary = data.buckets.find((b) => b.isPrimary);
  const labeled = data.buckets.filter((b) => !b.isPrimary);

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await treasuryBucketsApi.create(label.trim());
      setLabel('');
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
        <div className="font-semibold">{t('Treasury buckets')} ({data.buckets.length})</div>
        <span className="text-xs text-neutral-500">
          {t('Labeled sub-addresses of the same multisig — same 3-of-5 signing requirement, distinct on-chain addresses.')}
        </span>
      </div>

      {/* Primary (bare multisig) always shown. */}
      {primary ? (
        <BucketRow b={primary} isBoard={isBoard} onChange={load} />
      ) : null}

      {/* Labeled buckets — collapsible to keep the panel compact when many. */}
      {labeled.length > 0 ? (
        <div className="mt-2 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>{t('Labeled buckets')} ({labeled.length})</span>
            <span>{showHistory ? `▾ ${t('hide')}` : `▸ ${t('show')}`}</span>
          </button>
          {showHistory ? (
            <ul className="space-y-1 px-2 pb-2">
              {labeled.map((b) => <li key={b.id}><BucketRow b={b} isBoard={isBoard} onChange={load} /></li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Create form (board-only). */}
      {isBoard ? (
        <div className="mt-3 rounded border border-emerald-300 bg-emerald-50/40 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="font-semibold text-emerald-800 dark:text-emerald-200">{t('Add a new bucket')}</div>
          <p className="mt-0.5 text-neutral-700 dark:text-neutral-300">
            {t('Pick a clear label (e.g. "Submission fees", "Rewards", "Funding"). The platform derives a distinct on-chain address under the multisig.')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('e.g. Submission fees')}
              maxLength={64}
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              disabled={busy || label.trim().length < 2}
              onClick={submit}
              className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
            >
              {busy ? '…' : t('Create bucket')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </section>
  );
}

function BucketRow({ b, isBoard, onChange }: { b: TreasuryBucket; isBoard: boolean; onChange: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.label);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => { setDraft(b.label); setEditing(true); setError(null); };
  const saveRename = async () => {
    const v = draft.trim();
    if (v.length < 2 || v === b.label) { setEditing(false); return; }
    setBusy(true); setError(null);
    try { await treasuryBucketsApi.rename(b.id, v); setEditing(false); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'rename failed'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    setConfirmDel(false);
    setBusy(true); setError(null);
    try { await treasuryBucketsApi.remove(b.id); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'delete failed'); }
    finally { setBusy(false); }
  };

  // Rename is allowed for ANY bucket the board owns — including primary
  // (the label is cosmetic; the script address doesn't change). Delete is
  // refused for primary (it's the bare multisig) and for any bucket holding
  // funds; we surface the disable here so the button isn't a tease.
  const canRename = isBoard;
  const canDelete = isBoard && !b.isPrimary;
  const empty = b.balanceAda === 0;
  const toggleDefault = async (
    op: 'FUNDING' | 'REWARDS' | 'OPERATIONS' | 'SUBMISSION_FEES' | 'PLEDGE',
    value: boolean,
  ) => {
    setError(null); setBusy(true);
    try { await treasuryBucketsApi.setDefault(b.id, op, value); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`mt-1 rounded border p-2 text-xs ${
      b.isPrimary
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
        : 'border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-800/30'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          {editing ? (
            <>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditing(false); }}
                maxLength={64}
                className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button disabled={busy} onClick={saveRename} className="text-emerald-700 hover:underline dark:text-emerald-300">{t('save')}</button>
              <button disabled={busy} onClick={() => setEditing(false)} className="text-neutral-500 hover:underline">{t('cancel')}</button>
            </>
          ) : (
            <>
              {b.label}
              {b.isPrimary ? <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{t('primary')}</span> : null}
              {canRename ? (
                <button onClick={startEdit} className="text-[11px] text-neutral-500 hover:underline" title={t('Rename (label only — on-chain address stays the same)')}>{t('rename')}</button>
              ) : null}
            </>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-neutral-700 dark:text-neutral-300">{b.balanceAda.toLocaleString()} ₳ {t('on-chain')}</span>
          {canDelete ? (
            <button
              disabled={busy || !empty}
              onClick={() => setConfirmDel(true)}
              title={empty ? t('Delete this empty bucket') : t('Drain funds first — delete is only allowed when balance is 0 ₳')}
              className="rounded border border-red-400 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
            >
              {t('delete')}
            </button>
          ) : null}
        </span>
      </div>
      {/* §15.6 — per-operation default chips. Five ops in two groups so
          the strip stays readable.
            OUTBOUND (spend from): Funding, Rewards, Operations
            INBOUND (receive at):  Submission fees, Pledge
          Toggling one bucket clears the same op on others (single default
          per op per multisig). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">{t('default for:')}</span>
        {([
          ['FUNDING',         t('Funding'),         b.isDefaultFunding,         t('milestone payouts spend from this bucket')],
          ['REWARDS',         t('Rewards'),         b.isDefaultRewards,         t('DRep / board reward payouts spend from this bucket')],
          ['OPERATIONS',      t('Operations'),      b.isDefaultOperations,      t('hot-wallet top-ups spend from this bucket')],
          ['SUBMISSION_FEES', t('Submission fees'), b.isDefaultSubmissionFees,  t('submitters are told to pay submission fees here')],
          ['PLEDGE',          t('Pledge'),          b.isDefaultPledge,          t('submitters are told to pay skin-in-the-game pledges here')],
        ] as const).map(([op, label, on, hint]) => (
          <button
            key={op}
            disabled={busy || !isBoard}
            onClick={() => toggleDefault(op, !on)}
            title={isBoard ? hint : `${t('Default for')} ${label}: ${on ? t('yes') : t('no')}`}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              on
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-80'
                : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {on ? '✓ ' : ''}{label}
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{b.bech32Address}</div>
        <CopyButton text={b.bech32Address} label={t('Copy')} />
      </div>
      {b.createdBy ? <div className="mt-0.5 text-[10px] text-neutral-500">{t('created by')} {b.createdBy}</div> : null}
      {error ? <div className="mt-1 text-[11px] text-red-600">{error}</div> : null}
      <ConfirmDialog
        open={confirmDel}
        title={`${t('Delete bucket')} "${b.label}"?`}
        tone="danger"
        confirmLabel={t('Delete bucket')}
        cancelLabel={t('Keep it')}
        onCancel={() => setConfirmDel(false)}
        onConfirm={doDelete}
        message={
          <>
            {t('The bucket label + on-chain address are removed from the platform. Past actions that referenced this bucket stay in history (the reference is just nulled). The script address remains on-chain; anyone could still send funds to it — but the platform won\'t spend from it anymore.')}
          </>
        }
      />
    </div>
  );
}
