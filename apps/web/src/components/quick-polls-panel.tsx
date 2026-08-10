'use client';

import { useCallback, useEffect, useState } from 'react';
import { quickPollApi, type QuickPollView, type ReviewMode } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';

const STATUS_CLS: Record<string, string> = {
  PENDING_BOARD: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ACTIVE: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

/**
 * §9.2 — Quick Poll tie-break panel (per round). Auto-created when equal scores collide at the
 * budget cliff: the board launches with one click; eligible DReps pick which proposal gets the
 * remaining budget. Self-hides when the round has no polls.
 */
/**
 * §9.2 — tie-break polls of a round.
 * `mode` filters the list by the To do / Recent / History selector. With no mode (the Tally
 * tab) every poll is shown. `perspective` decides what "to do" means:
 *   - 'board' (Actions launch queue): To do = not yet launched (PENDING_BOARD) → Recent = launched (ACTIVE).
 *   - 'voter' (Voting & reviews):     To do = launched & awaiting MY vote → Recent = launched & I voted.
 * History (both) = resolved / failed.
 */
export function QuickPollsPanel({ roundId, mode, perspective = 'board' }: { roundId: string; mode?: ReviewMode; perspective?: 'board' | 'voter' }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [polls, setPolls] = useState<QuickPollView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { quickPollApi.forRound(roundId).then(setPolls).catch(() => setPolls([])); }, [roundId]);
  useEffect(() => { load(); }, [load]);

  const visible = !mode ? polls : polls.filter((p) => {
    const done = p.status === 'RESOLVED' || p.status === 'FAILED';
    if (mode === 'history') return done;
    if (perspective === 'voter') {
      const canVote = p.status === 'ACTIVE' && p.iAmEligible;
      const voted = p.myRanking != null && p.myRanking.length > 0;
      return mode === 'pending' ? canVote && !voted : canVote && voted;
    }
    // board launch queue: PENDING_BOARD is the to-do; once launched it's ACTIVE (Recent).
    return mode === 'pending' ? p.status === 'PENDING_BOARD' : p.status === 'ACTIVE';
  });
  if (visible.length === 0) return null;

  const launch = async (id: string) => {
    setBusy(id); setErr(null);
    try { await quickPollApi.launch(id); load(); } catch (e) { setErr(e instanceof Error ? e.message : t('failed')); } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{t('Quick polls — tie-break')} ({visible.length})</h3>
      <p className="text-xs text-neutral-500">
        {t('§9.2 — proposals with equal scores at the budget cliff. Rank them by priority; the remaining category budget is filled top-down, funding as many as fit. 48 h window, 51% participation (extended up to 3× when too low).')}
      </p>
      {err ? <div className="text-xs text-red-600">{err}</div> : null}
      {visible.map((p) => (
        <QuickPollCard key={p.id} poll={p} isBoard={isBoard} launching={busy === p.id} onLaunch={() => void launch(p.id)} onChange={load} />
      ))}
    </section>
  );
}

function QuickPollCard({ poll, isBoard, launching, onLaunch, onChange }: {
  poll: QuickPollView;
  isBoard: boolean;
  launching: boolean;
  onLaunch: () => void;
  onChange: () => void;
}) {
  const t = useT();
  const canVote = poll.status === 'ACTIVE' && poll.iAmEligible;
  // The voter's working priority order. Seeded from their existing ranking, else the current
  // aggregate order. Kept in local state so reordering survives background refreshes.
  const [order, setOrder] = useState<string[]>(() => poll.myRanking ?? poll.candidates.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleById = new Map(poll.candidates.map((c) => [c.id, c]));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await quickPollApi.vote(poll.id, order); onChange(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('failed')); }
    finally { setBusy(false); }
  };
  const resolveNow = async () => {
    setBusy(true); setErr(null);
    try { await quickPollApi.resolve(poll.id); onChange(); }
    catch (e) { setErr(e instanceof Error ? e.message : t('failed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{poll.categoryName ?? t('category')} {t('· tie of')} {poll.candidates.length}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[poll.status]}`}>{poll.status}</span>
          {poll.status === 'ACTIVE' && poll.endsAt ? <span className="text-xs text-neutral-500">{t('ends')} {new Date(poll.endsAt).toLocaleString()}{poll.extensions > 0 ? ` · ${t('extended')} ${poll.extensions}×` : ''}</span> : null}
          {poll.status === 'PENDING_BOARD' && isBoard ? (
            <button onClick={onLaunch} disabled={launching} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {launching ? '…' : t('Launch poll')}
            </button>
          ) : null}
          {poll.status === 'ACTIVE' && isBoard ? (
            <button onClick={() => void resolveNow()} disabled={busy} title={t('Finalise this poll now with the votes cast so far')} className="rounded border border-emerald-500 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
              {busy ? '…' : t('Resolve now')}
            </button>
          ) : null}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {poll.votedCount}/{poll.eligibleCount} {t('voted')} · {poll.remainingAda.toLocaleString()} ₳ {t('budget for this tie')}
      </div>

      {/* Live standing: candidates in aggregate-priority order with the projected outcome. */}
      <ul className="mt-2 space-y-1">
        {poll.candidates.map((c, i) => {
          const funded = poll.status === 'RESOLVED' || poll.status === 'FAILED' ? poll.winnerId === c.id || (poll.status === 'RESOLVED' && c.projectedFunded) : c.projectedFunded;
          const mark = poll.status === 'FAILED' ? { t: t('✗ not funded'), cls: 'text-red-600' }
            : funded ? { t: t('✓ funded'), cls: 'text-emerald-600' }
            : c.projectedTie ? { t: t('≈ tie — needs a follow-up poll'), cls: 'text-amber-600' }
            : { t: poll.status === 'PENDING_BOARD' || poll.status === 'ACTIVE' ? t('projected: not funded') : t('✗ not funded'), cls: 'text-neutral-400' };
          return (
            <li key={c.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${funded ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
              <span>
                <span className="text-neutral-400">{i + 1}.</span>{' '}
                <span className="font-medium">{c.publicId ? `${c.publicId} · ` : ''}{c.title}</span>
                <span className="ml-2 text-neutral-500">{c.requestedAmountAda.toLocaleString()} ₳</span>
                <span className={`ml-2 ${mark.cls}`}>{mark.t}</span>
              </span>
              <span className="tabular-nums text-neutral-500" title={t('Aggregate priority score (power-weighted)')}>{t('score')} {c.score.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>

      {/* Ranking editor — only for eligible DReps while the poll is open. */}
      {canVote ? (
        <div className="mt-3 rounded-md border border-blue-300 bg-blue-50/50 p-2 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t('Your priority order')} {poll.myRanking ? t('(submitted — reorder to change)') : t('(highest first)')}</div>
          <ul className="mt-1 space-y-1">
            {order.map((id, i) => {
              const c = titleById.get(id);
              return (
                <li key={id} className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                  <span><span className="text-neutral-400">{i + 1}.</span> <span className="font-medium">{c?.publicId ? `${c.publicId} · ` : ''}{c?.title ?? id}</span> <span className="ml-1 text-neutral-500">{(c?.requestedAmountAda ?? 0).toLocaleString()} ₳</span></span>
                  <span className="flex items-center gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-neutral-300 px-1.5 leading-5 disabled:opacity-30 dark:border-neutral-700" title={t('Move up')}>▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="rounded border border-neutral-300 px-1.5 leading-5 disabled:opacity-30 dark:border-neutral-700" title={t('Move down')}>▼</button>
                  </span>
                </li>
              );
            })}
          </ul>
          {err ? <div className="mt-1 text-xs text-red-600">{err}</div> : null}
          <button onClick={() => void submit()} disabled={busy} className="mt-2 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('Saving…') : poll.myRanking ? t('Update my ranking') : t('Submit my ranking')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
