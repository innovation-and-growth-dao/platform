'use client';

import { useCallback, useEffect, useState } from 'react';
import { meritApi, type MeritInfo, type AvoidPeriod } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

// §13 — human labels for merit reason codes.
const REASON_LABEL: Record<string, string> = {
  DV_VOTE: 'Voted in Debate & Vote',
  DV_VOTE_INTERNAL: 'Voted on an internal proposal',
  FILTER_COMPLETE: 'Completed a filtering review',
  MILESTONE_CHECK: 'Checked a milestone',
  INTERNAL_SUBMIT: 'Submitted an internal proposal',
  QUICK_POLL_VOTE: 'Voted in a quick poll',
  BOARD_ROUND_START: 'Board: started a round',
  BOARD_ROUND_END: 'Board: ended a round',
  BOARD_ROUND_CONFIGURE: 'Board: configured a round',
  BOARD_REWARD_DISTRIBUTE: 'Board: distributed rewards',
  BOARD_LEDGER_MONTHLY: 'Board: kept the DAO ledger',
  BOARD_PAYOUT_SIGNED: 'Board: paid a milestone in time',
  MISSED_DV: 'Missed a Debate & Vote ballot',
  MISSED_FILTER: 'Missed a filtering review',
  MISSED_MILESTONE: 'Missed a milestone check',
  MISSED_QUICK_POLL: 'Missed a quick poll',
  BOARD_REWARD_LATE: 'Board: late reward distribution',
  BOARD_PAYOUT_LATE: 'Board: missed a milestone payout deadline',
};

const inputCls =
  'rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900';

/** §13 — the DRep's merit points + ledger, and avoid-period ("vacancy") signalling. */
export function MeritPanel() {
  const t = useT();
  const [info, setInfo] = useState<MeritInfo | null>(null);
  const [avoid, setAvoid] = useState<AvoidPeriod[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    meritApi.me().then(setInfo).catch(() => undefined);
    meritApi.avoidPeriods().then(setAvoid).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr(null);
    setBusy(true);
    try {
      await meritApi.setAvoid(new Date(start).toISOString(), new Date(end).toISOString(), reason.trim() || undefined);
      setStart('');
      setEnd('');
      setReason('');
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return null;
  const pts = info.points;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">{t('Merit points')}</h3>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`text-3xl font-bold tabular-nums ${pts > 0 ? 'text-emerald-600' : pts < 0 ? 'text-red-600' : 'text-neutral-500'}`}>
            {pts > 0 ? '+' : ''}
            {pts}
          </span>
          <span className="text-xs text-neutral-500">
            {t('range −200…+200 · voting power ×')}{(1 + pts / 200).toFixed(2)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          {t('Earn points for voting and reviewing on time; lose them for missing. Your merit scales your voting power.')}
        </p>
        {info.ledger.length ? (
          <ul className="mt-2 space-y-1 text-xs">
            {info.ledger.slice(0, 8).map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="text-neutral-700 dark:text-neutral-300">{REASON_LABEL[l.reason] ? t(REASON_LABEL[l.reason]) : l.reason}</span>
                <span className="flex items-center gap-2 whitespace-nowrap text-neutral-400">
                  <span className="tabular-nums">{new Date(l.at).toLocaleDateString()}</span>
                  <span className={`tabular-nums font-semibold ${l.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {l.delta >= 0 ? '+' : ''}
                    {l.delta}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-neutral-400">{t('No merit changes yet.')}</p>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold">{t('Availability (avoid periods)')}</h4>
        <p className="text-xs text-neutral-500">
          {t('Signal time off — while an avoid period is active you won’t be assigned to filtering/milestone reviews, and missed Debate & Vote ballots won’t cost you merit.')}
        </p>
        {avoid.length ? (
          <ul className="mt-2 space-y-1 text-xs">
            {avoid.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-800"
              >
                <span>
                  {new Date(a.startsAt).toLocaleDateString()} → {new Date(a.endsAt).toLocaleDateString()}
                  {a.reason ? ` · ${a.reason}` : ''}
                </span>
                <button onClick={() => meritApi.removeAvoid(a.id).then(load)} className="text-red-600 hover:underline">
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] text-neutral-500">
            {t('From')}
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-neutral-500">
            {t('To')}
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-neutral-500">
            {t('Reason (optional)')}
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={inputCls} />
          </label>
          <button
            onClick={add}
            disabled={busy || !start || !end}
            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? t('Saving…') : t('Add')}
          </button>
        </div>
        {err ? <div className="mt-1 text-xs text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}
