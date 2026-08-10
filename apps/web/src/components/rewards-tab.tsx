'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { roundsApi, rewardsApi, treasuryApi, type RoundSummary, type RewardCalcView, type ExpertRewardRow, type RewardSourceBucket } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';
import { useT } from '@/lib/prefs-context';

const KIND_LABEL: Record<string, string> = {
  FILTER: 'Filtering rewards',
  DV_FIXED: 'Debate & Vote — fixed',
  DV_BONUS: 'Debate & Vote — bonus',
  MILESTONE: 'Milestone review',
  BOARD_MONTHLY: 'Board monthly',
};
// Order the reward cards by stage: filtering → D&V fixed → D&V bonus → milestone → experts/board.
const KIND_ORDER: Record<string, number> = { FILTER: 0, DV_FIXED: 1, DV_BONUS: 2, MILESTONE: 3, EXPERT: 4, BOARD_MONTHLY: 5 };
// "2026-06" → "June 2026"
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const DAY_MS = 86_400_000;
const inputCls = 'w-24 rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900';

export function RewardsTab() {
  const t = useT();
  const [sub, setSub] = useState<'overview' | 'experts' | 'setup'>('overview');
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [roundId, setRoundId] = useState<string>('');
  useEffect(() => {
    roundsApi.list().then((rs) => { setRounds(rs); if (rs.length && !roundId) setRoundId(rs.reduce((a, b) => (b.number > a.number ? b : a)).id); }).catch(() => undefined);
  }, [roundId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Rewards')}</h2>
        <p className="text-sm text-neutral-500">{t('Calculate per-DRep rewards for filtering, Debate & Vote and milestone review, adjust amounts, and pay them out via the multisig (default source: the Rewards bucket).')}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
          {([['overview', t('Round DRep Rewards')], ['experts', t('Expert rewards')], ['setup', t('Board rewards')]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSub(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${sub === k ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-neutral-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {sub !== 'setup' ? (
        <label className="flex items-center gap-2 text-sm">{t('Round')}
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)} className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900">
            {rounds.map((r) => <option key={r.id} value={r.id}>#{r.number}{r.name ? ` — ${r.name}` : ''}</option>)}
          </select>
        </label>
      ) : null}

      {sub === 'overview' && roundId ? <Overview roundId={roundId} /> : null}
      {sub === 'experts' && roundId ? <Experts roundId={roundId} /> : null}
      {sub === 'setup' ? <Setup /> : null}
    </div>
  );
}

function Overview({ roundId }: { roundId: string }) {
  const t = useT();
  const [calcs, setCalcs] = useState<RewardCalcView[] | null>(null);
  const [buckets, setBuckets] = useState<RewardSourceBucket[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { rewardsApi.overview(roundId).then(setCalcs).catch(() => setCalcs([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { rewardsApi.sourceBuckets().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([])); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); load(); } catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => run(() => rewardsApi.computeFiltering(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">{t('Compute filtering rewards')}</button>
        <button onClick={() => run(() => rewardsApi.computeDv(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">{t('Compute D&V rewards')}</button>
        <button onClick={() => run(() => rewardsApi.computeMilestone(roundId))} className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">{t('Compute milestone rewards (monthly)')}</button>
      </div>
      {msg ? <div className="text-xs text-red-600">{msg}</div> : null}
      {calcs && calcs.length === 0 ? <p className="text-sm text-neutral-500">{t('Nothing computed yet — use the buttons above.')}</p> : null}
      {calcs?.slice().sort((a, b) => (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99)).map((c) => <CalcCard key={c.id} calc={c} buckets={buckets} onChange={load} />)}
    </div>
  );
}

function CalcCard({ calc, buckets, onChange, seq }: { calc: RewardCalcView; buckets: RewardSourceBucket[]; onChange: () => void; seq?: number }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  // Total = what can actually be sent (recipients with a reward address). Entries without one are
  // held back — their ADA stays in the treasury until they set an address.
  const total = calc.entries.filter((e) => e.recipient.address).reduce((s, e) => s + e.amountAda, 0);
  const heldEntries = calc.entries.filter((e) => !e.recipient.address && !e.paid);
  const heldBack = heldEntries.reduce((s, e) => s + e.amountAda, 0);
  const allPaid = calc.entries.length > 0 && calc.entries.every((e) => e.paid);
  // Once any payout has gone out, split the footer into what was SENT vs what STAYS in the
  // treasury (the unpaid remainder, payable in a follow-up), and lock the unpaid rows.
  const anyPaid = calc.entries.some((e) => e.paid);
  const sentSum = calc.entries.filter((e) => e.paid).reduce((s, e) => s + e.amountAda, 0);
  const unpaidSum = calc.entries.filter((e) => !e.paid).reduce((s, e) => s + e.amountAda, 0);
  // §12 — default source by stage: filtering draws from the Submission-fee bucket, everything
  // else from Rewards (fall back to the primary). The board can override before preparing.
  const defaultBucketId = useMemo(() => {
    const pick = calc.kind === 'FILTER'
      ? (b: RewardSourceBucket) => b.isDefaultSubmissionFees
      : (b: RewardSourceBucket) => b.isDefaultRewards;
    return (buckets.find(pick) ?? buckets.find((b) => b.isPrimary) ?? buckets[0])?.id ?? '';
  }, [buckets, calc.kind]);
  const [src, setSrc] = useState('');
  useEffect(() => { setSrc(defaultBucketId); }, [defaultBucketId]);
  const pay = async () => {
    setBusy(true); setMsg(null);
    try { const r = await rewardsApi.preparePayout(calc.id, src || undefined); setMsg(`${t('Queued')} ${r.recipients} ${r.recipients === 1 ? t('payout') : t('payouts')} (${r.totalAda.toLocaleString()} ₳) — ${t('review & sign under Actions.')}${r.skipped > 0 ? ` ${r.skipped} ${t('skipped — no payment address set; pay them later once they add one.')}` : ''}`); onChange(); }
    catch (e) {
      const m = e instanceof Error ? e.message : t('failed');
      // Insufficient-funds gets a styled warning dialog; other errors stay inline.
      if (/insufficient funds/i.test(m)) setWarning(m);
      else { setMsg(m); if (/calculation not found/i.test(m)) onChange(); } // refresh a stale card
    } finally { setBusy(false); }
  };
  // §15.4 — cancel a prepared (not-yet-confirmed) payout so the calc re-opens and can be
  // recomputed / re-prepared. Cancelling unlinks the entries + voids any signatures collected.
  const cancelPayout = async () => {
    if (!calc.payout) return;
    setConfirmingCancel(false);
    setBusy(true); setMsg(null);
    try { await treasuryApi.cancelAction(calc.payout.actionId, 'Cancelled from Rewards to redo the payout'); onChange(); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); } finally { setBusy(false); }
  };
  // Recompute this calc in place from the latest votes (so the board doesn't have to find
  // the compute buttons up top). Only offered before a payout is prepared.
  const recompute = async () => {
    setBusy(true); setMsg(null);
    try {
      const rid = calc.roundId ?? '';
      if (calc.kind === 'FILTER') await rewardsApi.computeFiltering(rid);
      else if (calc.kind === 'DV_FIXED' || calc.kind === 'DV_BONUS') await rewardsApi.computeDv(rid);
      else if (calc.kind === 'MILESTONE') await rewardsApi.computeMilestone(rid);
      else if (calc.kind === 'BOARD_MONTHLY') await rewardsApi.computeBoardMonthly();
      onChange();
    } catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {calc.periodKey
            ? `${seq != null ? `${seq}. ` : ''}${t('Board pay')} · ${monthLabel(calc.periodKey)}`
            : `${KIND_LABEL[calc.kind] ? t(KIND_LABEL[calc.kind]) : calc.kind} · ${t('pool')} ${calc.poolAda.toLocaleString()} ₳`}
        </h3>
        <div className="flex items-center gap-2">
        {!calc.payout && calc.kind !== 'BOARD_MONTHLY' ? (
          <button onClick={recompute} disabled={busy} title={t('Recalculate this reward from the latest votes')} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700">
            {busy ? '…' : `↻ ${t('Recompute')}`}
          </button>
        ) : null}
        {!calc.payable ? (
          <span className="text-xs text-neutral-400">{t('payable once the stage ends')}</span>
        ) : calc.pending > 0 ? (
          // Recipients with a reward address are still owed → offer the payout (covers the first
          // batch AND paying anyone who only added their address after an earlier partial batch).
          <div className="flex items-center gap-2">
            {buckets.length > 0 ? (
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                {t('from')}
                <select
                  value={src}
                  onChange={(e) => setSrc(e.target.value)}
                  title={t('Source address the payout spends from')}
                  className="max-w-[14rem] rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} · {b.balanceAda.toLocaleString()} ₳
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button onClick={pay} disabled={busy} className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300">
              {busy ? t('Preparing…') : t('Prepare bulk payout')}
            </button>
          </div>
        ) : calc.payout ? (
          calc.payout.status === 'CONFIRMED' || calc.payout.status === 'BROADCASTED' ? (
            <span className="text-xs text-emerald-600">✓ {t('paid')}{calc.payout.paidAt ? ` ${t('on')} ${new Date(calc.payout.paidAt).toLocaleDateString()}` : ` ${t('on-chain')}`}</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-xs text-amber-600">⏳ {t('payout prepared — review & sign under Actions')}</span>
              <button onClick={() => setConfirmingCancel(true)} disabled={busy} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400">
                {busy ? '…' : t('Cancel')}
              </button>
            </span>
          )
        ) : allPaid ? (
          <span className="text-xs text-emerald-600">✓ {t('all paid')}</span>
        ) : (
          <span className="text-xs text-amber-600">{t('waiting on reward addresses')}</span>
        )}
        </div>
      </div>
      {msg ? <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{msg}</div> : null}
      <table className="mt-2 w-full text-xs">
        <thead><tr className="text-left text-neutral-400"><th className="font-normal">{t('Recipient')}</th>{calc.kind !== 'BOARD_MONTHLY' ? <th className="font-normal">{calc.kind === 'MILESTONE' ? t('Checks') : t('Votes')}</th> : null}{calc.kind === 'DV_BONUS' ? <th className="font-normal" title={t('Final voting power used to weight the bonus')}>{t('Power')}</th> : null}<th className="font-normal">{t('Computed')}</th><th className="font-normal">{t('Pay')}</th><th></th></tr></thead>
        <tbody>
          {calc.entries.map((e) => <EntryRow key={e.id} e={e} showUnits={calc.kind !== 'BOARD_MONTHLY'} showPower={calc.kind === 'DV_BONUS'} locked={anyPaid} onChange={onChange} />)}
          {calc.entries.length === 0 ? <tr><td colSpan={4} className="py-1 text-neutral-400">{t('No recipients.')}</td></tr> : null}
        </tbody>
        <tfoot>
          {anyPaid ? (
            <>
              <tr className="border-t border-neutral-200 font-medium dark:border-neutral-800"><td className="pt-1">{t('Sent')}</td>{calc.kind !== 'BOARD_MONTHLY' ? <td></td> : null}<td></td><td className="pt-1 tabular-nums text-emerald-700 dark:text-emerald-400">{sentSum.toLocaleString()} ₳</td><td></td></tr>
              {unpaidSum > 0 ? <tr><td className="pt-0.5 text-amber-600">{t('Stays in treasury (next payment)')}</td>{calc.kind !== 'BOARD_MONTHLY' ? <td></td> : null}<td></td><td className="pt-0.5 tabular-nums text-amber-600">{unpaidSum.toLocaleString()} ₳</td><td></td></tr> : null}
            </>
          ) : (
            <tr className="border-t border-neutral-200 font-medium dark:border-neutral-800"><td className="pt-1">{t('Total')}</td>{calc.kind !== 'BOARD_MONTHLY' ? <td className="pt-1 tabular-nums">{calc.entries.reduce((s, e) => s + (e.units ?? 0), 0)}</td> : null}<td></td><td className="pt-1 tabular-nums">{total.toLocaleString()} ₳</td><td></td></tr>
          )}
        </tfoot>
      </table>
      {!anyPaid && heldBack > 0 ? (
        <p className="mt-1 text-xs text-amber-600">
          ⚠ {heldBack.toLocaleString()} ₳ {t('will not be sent —')} {heldEntries.length} {heldEntries.length === 1 ? t('member') : t('members')} {t('without a payment address. It stays in the treasury until they set one.')}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmingCancel}
        title={t('Cancel this prepared payout?')}
        message={t('It unlinks the recipients and discards any signatures already collected, so you can edit, recompute, and prepare the payout again.')}
        confirmLabel={t('Cancel payout')}
        cancelLabel={t('Keep it')}
        tone="danger"
        onCancel={() => setConfirmingCancel(false)}
        onConfirm={cancelPayout}
      />
      <ConfirmDialog
        open={!!warning}
        title={t('Insufficient funds')}
        message={warning ?? ''}
        confirmLabel={t('OK')}
        hideCancel
        onCancel={() => setWarning(null)}
        onConfirm={() => setWarning(null)}
      />
    </section>
  );
}

function EntryRow({ e, showUnits = true, showPower = false, locked = false, onChange }: { e: RewardCalcView['entries'][number]; showUnits?: boolean; showPower?: boolean; locked?: boolean; onChange: () => void }) {
  const t = useT();
  const [val, setVal] = useState(String(e.amountAda));
  useEffect(() => { setVal(String(e.amountAda)); }, [e.amountAda]);
  const save = async () => {
    const n = Number(val);
    if (Number.isNaN(n)) return;
    await rewardsApi.setOverride(e.id, n === e.computedAda ? null : n).catch(() => undefined);
    onChange();
  };
  return (
    <tr className="border-t border-neutral-100 dark:border-neutral-900">
      <td className="py-1">{e.recipient.name} <span className="text-neutral-400">{e.recipient.type}</span></td>
      {showUnits ? <td className="py-1 tabular-nums text-neutral-600 dark:text-neutral-300">{e.units ?? '—'}</td> : null}
      {showPower ? <td className="py-1 tabular-nums text-neutral-500">{e.power != null ? e.power.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td> : null}
      <td className="py-1 tabular-nums text-neutral-500">{e.computedAda.toLocaleString()} ₳</td>
      <td className="py-1">
        {e.paid ? (
          <span className="text-emerald-600">{t('paid')}</span>
        ) : !e.recipient.address ? (
          <span className="text-red-600">{t('not paid — payment address not set')}</span>
        ) : locked ? (
          <span className="text-red-600">{t('not paid')}</span>
        ) : (
          <input value={val} onChange={(ev) => setVal(ev.target.value)} onBlur={save} className={inputCls} />
        )}
        {e.overridden && !e.paid && e.recipient.address && !locked ? <span className="ml-1 text-[10px] text-amber-600">{t('edited')}</span> : null}
      </td>
      <td></td>
    </tr>
  );
}

function Experts({ roundId }: { roundId: string }) {
  const t = useT();
  const [rows, setRows] = useState<ExpertRewardRow[] | null>(null);
  const load = useCallback(() => { rewardsApi.listExpertRewards(roundId).then(setRows).catch(() => setRows([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return null;
  if (rows.length === 0) return <p className="text-sm text-neutral-500">{t('No board-approved experts.')}</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">{t('Set each expert’s ADA reward for this round per stage. The milestone switch: ON = the expert also earns the per-check DRep reward (extra) on top; OFF = they get only the milestone amount.')}</p>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-neutral-400"><th className="font-normal">{t('Expert')}</th><th className="font-normal">{t('Filtering ₳')}</th><th className="font-normal">{t('D&V ₳')}</th><th className="font-normal">{t('Milestone ₳')}</th><th className="font-normal">{t('Like DRep')}</th></tr></thead>
        <tbody>{rows.map((r) => <ExpertRow key={r.expertId} roundId={roundId} row={r} onChange={load} />)}</tbody>
      </table>
    </div>
  );
}

function ExpertRow({ roundId, row, onChange }: { roundId: string; row: ExpertRewardRow; onChange: () => void }) {
  const [f, setF] = useState(String(row.filteringAda));
  const [d, setD] = useState(String(row.dvAda));
  const [m, setM] = useState(String(row.milestoneAda));
  const save = (dto: Partial<ExpertRewardRow>) => rewardsApi.setExpertReward(roundId, row.expertId, dto).then(onChange).catch(() => undefined);
  return (
    <tr className="border-t border-neutral-100 dark:border-neutral-900">
      <td className="py-1">{row.name}</td>
      <td className="py-1"><input value={f} onChange={(e) => setF(e.target.value)} onBlur={() => save({ filteringAda: Number(f) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input value={d} onChange={(e) => setD(e.target.value)} onBlur={() => save({ dvAda: Number(d) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input value={m} onChange={(e) => setM(e.target.value)} onBlur={() => save({ milestoneAda: Number(m) || 0 })} className={inputCls} /></td>
      <td className="py-1"><input type="checkbox" checked={row.milestoneLikeDrep} onChange={(e) => save({ milestoneLikeDrep: e.target.checked })} /></td>
    </tr>
  );
}

function Setup() {
  const t = useT();
  const [yearly, setYearly] = useState('');
  const [months, setMonths] = useState('12');
  const [list, setList] = useState<RewardCalcView[] | null>(null);
  const [buckets, setBuckets] = useState<RewardSourceBucket[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadList = useCallback(() => { rewardsApi.boardMonths().then(setList).catch(() => setList([])); }, []);
  useEffect(() => {
    rewardsApi.getBoardYearly().then((r) => setYearly(String(r.yearlyAda))).catch(() => undefined);
    rewardsApi.sourceBuckets().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([]));
    loadList();
  }, [loadList]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const save = async () => { setSaved(false); setMsg(null); try { await rewardsApi.setBoardYearly(Number(yearly) || 0); setSaved(true); } catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); } };
  const compute = async () => {
    setBusy(true); setMsg(null);
    try { const r = await rewardsApi.computeBoardMonths(Number(months) || 12); setList(r); setMsg(`${t('Computed')} ${r.length} ${r.length === 1 ? t('month') : t('months')} ${t('of board pay.')}`); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); } finally { setBusy(false); }
  };
  const reset = async () => {
    setConfirmingReset(false); setBusy(true); setMsg(null);
    try { const r = await rewardsApi.resetBoardMonths(); setList(r); setMsg(t('Reset — unpaid months cleared. Set the amount + months for the current board and compute again.')); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('failed')); } finally { setBusy(false); }
  };

  const items = list ?? [];
  const seqd = items.map((c, i) => ({ c, seq: i + 1 })); // global numbering across paid + unpaid
  // History = fully done (paid on-chain AND nobody still owed). A month with a pending recipient
  // (e.g. paid 4, 1 added their address later) stays in the active list so it can be topped up.
  const isPaid = (c: RewardCalcView) => !!c.payout && (c.payout.status === 'CONFIRMED' || c.payout.status === 'BROADCASTED') && c.pending === 0;
  const active = seqd.filter(({ c }) => !isPaid(c));
  const history = seqd.filter(({ c }) => isPaid(c));
  // §13 — monthly cadence: after a payout, the next month opens 30 days later (soft — can send sooner).
  const paidTimes = items.filter((c) => c.payout?.paidAt).map((c) => new Date(c.payout!.paidAt!).getTime());
  const lastPaidAt = paidTimes.length ? Math.max(...paidTimes) : null;
  const nextPayableAt = lastPaidAt != null ? lastPaidAt + 30 * DAY_MS : null;
  const daysLeft = nextPayableAt != null ? Math.ceil((nextPayableAt - Date.now()) / DAY_MS) : 0;
  // The cadence reminder belongs on the first month that hasn't been paid at all — not on a
  // partially-paid month (which just needs a same-month top-up via Prepare bulk payout).
  const firstFreshIdx = active.findIndex(({ c }) => !c.payout);
  const missingAddr = active.some(({ c }) => c.entries.some((e) => !e.recipient.address && !e.paid));

  return (
    <div className="space-y-4">
      <div className="max-w-lg space-y-3">
        <div>
          <label className="text-sm font-medium">{t('Yearly board reward (₳)')}</label>
          <p className="text-xs text-neutral-500">{t('Total board reward budget, split across the months you compute below (12 = a full year). Per member each month = budget ÷ months ÷ board seats.')}</p>
          <div className="mt-1 flex items-center gap-2">
            <input value={yearly} onChange={(e) => { setYearly(e.target.value); setSaved(false); }} className="w-40 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <button onClick={save} className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700">{t('Save new reward budget')}</button>
            {saved ? <span className="text-xs font-medium text-emerald-600">{t('Saved')} ✓</span> : null}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">{t('Months to compute')}</label>
          <p className="text-xs text-neutral-500">{t('Generates a board-pay calc per month (current month first), each payable separately.')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input value={months} onChange={(e) => setMonths(e.target.value)} className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            <button onClick={compute} disabled={busy} className="rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{busy ? t('Computing…') : t('Compute board pay')}</button>
            <button onClick={() => setConfirmingReset(true)} disabled={busy} className="rounded border border-red-300 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400" title={t('Clear unpaid months and start over for the current board')}>{t('Reset for new board')}</button>
          </div>
        </div>
        {msg ? <div className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</div> : null}
      </div>

      <p className="text-xs text-neutral-400">{t('One payout per month, sourced from Rewards (or another address you pick). After a payout, the next month opens 30 days later — you can still send it sooner if needed.')}</p>

      {missingAddr ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          ⚠ {t('Some board members haven’t set a reward payment address in their profile. They’ll be skipped when you pay (their ADA stays in the treasury) and can be paid later once they add one.')}
        </div>
      ) : null}

      <div className="space-y-3">
        {active.map(({ c, seq }, idx) => (
          <div key={c.id} className="space-y-1">
            {idx === firstFreshIdx && nextPayableAt != null ? (
              daysLeft <= 0 ? (
                <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                  ✓ {t('30 days have passed since the last board payout — this month is ready to send.')}
                </div>
              ) : (
                <div className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                  ⏳ {t('Next board payout opens in')} {daysLeft} {daysLeft === 1 ? t('day') : t('days')} — {t('you can send it now if needed.')}
                </div>
              )
            ) : null}
            <CalcCard calc={c} buckets={buckets} onChange={loadList} seq={seq} />
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-neutral-500">{t('No board pay computed yet — set the yearly amount, then Compute board pay.')}</p> : null}
        {items.length > 0 && active.length === 0 ? <p className="text-sm text-neutral-500">{t('All computed months have been paid — see history below.')}</p> : null}
      </div>

      {history.length > 0 ? (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="text-sm font-medium text-neutral-500">{t('Paid history')} ({history.length})</div>
          {history.map(({ c, seq }) => <CalcCard key={c.id} calc={c} buckets={buckets} onChange={loadList} seq={seq} />)}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingReset}
        title={t('Reset board pay?')}
        message={t('Clears all unpaid (and not-yet-signed) board-pay months so you can set a new amount and month count for the current board. Already-paid months are kept in history.')}
        confirmLabel={t('Reset')}
        cancelLabel={t('Keep')}
        tone="danger"
        onCancel={() => setConfirmingReset(false)}
        onConfirm={reset}
      />
    </div>
  );
}
