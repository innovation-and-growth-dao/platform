'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardRoundsApi, roundsApi, type RoundDetail } from '@/lib/api';
import { ProposalCounts, StatusBadge, fmtDateTime, toLocalInput, DateField, useNow } from './round-ui';
import { CreateRoundForm } from './rounds-section';
import { ConfirmDialog } from './confirm-dialog';
import { useAuth } from '@/lib/auth-context';
import { notifyTodoChanged } from '@/lib/use-todo-counts';
import { useT } from '@/lib/prefs-context';

/** "1 day and 5 hours" / "5 hours and 12 minutes" / "8 minutes" from a ms delta. */
function untilLabel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (days > 0) return `${u(days, 'day')} and ${u(hours, 'hour')}`;
  if (hours > 0) return `${u(hours, 'hour')} and ${u(mins, 'minute')}`;
  return u(mins, 'minute');
}

/** Stage length from a start→end ms span: "10 days", "3 weeks (21 days)", "2 months (64 days)". */
function durationLabel(startMs: number, endMs: number): string | null {
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  const hours = Math.round((endMs - startMs) / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round((endMs - startMs) / 86_400_000);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks (${days} days)`;
  return `${Math.round(days / 30)} months (${days} days)`;
}

const STAGE_LABEL: Record<string, string> = {
  SUBMISSION: 'Submission',
  FILTERING: 'Filtering',
  DEBATE: 'Debate & Vote — Debate',
  VOTE: 'Debate & Vote — Vote',
  DV: 'Debate & Vote (legacy)', // deprecated alias
  FUNDING: 'Funding',
  CLOSED: 'Close round',
};

/**
 * §8 — board controls for advancing a round's stages. Each transition is confirmed
 * by a board member: choose auto-start at the planned date or launch early by hand;
 * the final stage (Funding) is closed manually. Self-hides when no round is open.
 */
export function RoundStageControls() {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [rounds, setRounds] = useState<RoundDetail[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    roundsApi
      .list()
      .then((list) => Promise.all(list.filter((r) => r.status !== 'CLOSED').map((r) => roundsApi.get(r.id))))
      .then(setRounds)
      .catch(() => setRounds([]));
  }, []);
  useEffect(load, [load]);

  // Non-board members with no open round have nothing to act on here.
  if (!isBoard && rounds.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{t('Round stage controls')}</h3>
          <p className="text-xs text-neutral-500">
            {t('Confirm each next stage before it begins. Check the proposals are ready, then let it auto-start at the planned time or launch it early. Delays shift the new stage to start now and keep its planned length.')}
          </p>
        </div>
        {/* §5/§6 — board members can start a new funding round straight from here
            (same control as the Rounds section). */}
        {isBoard ? (
          <button
            onClick={() => setCreating((v) => !v)}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {creating ? t('Cancel') : t('+ Create round')}
          </button>
        ) : null}
      </div>

      {creating ? <CreateRoundForm onDone={() => { setCreating(false); load(); }} /> : null}

      {rounds.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('No open round. Create one to get started.')}</p>
      ) : (
        rounds.map((r) => <RoundControl key={r.id} round={r} onChange={load} />)
      )}
    </section>
  );
}

// Stage chronology — every stage with a schedule row, in execution order.
// `status` is the round status the stage corresponds to (used to compare against
// round.status). The board sees ALL of these in the round-control panel: past
// ones are read-only, the current one allows end-date edits, the immediate
// next allows confirm/launch, and any stages beyond that can be re-planned.
const ALL_STAGES: { key: string; status: string; label: string }[] = [
  { key: 'submission', status: 'SUBMISSION', label: 'Submission' },
  { key: 'filtering',  status: 'FILTERING',  label: 'Filtering' },
  { key: 'debate',     status: 'DEBATE',     label: 'Debate' },
  { key: 'vote',       status: 'VOTE',       label: 'Vote' },
  { key: 'tally',      status: 'TALLY',      label: 'Tally' },
  { key: 'funding',    status: 'FUNDING',    label: 'Funding' },
];
// Legacy 'debate_vote' rows fall back to "Vote" semantically (the deprecated
// alias was treated as VOTE everywhere else).
const STAGE_LABEL_BY_KEY: Record<string, string> = {
  submission: 'Submission',
  filtering: 'Filtering',
  debate: 'Debate',
  vote: 'Vote',
  tally: 'Tally',
  debate_vote: 'Debate & Vote (legacy)',
  funding: 'Funding',
};
// Map of round.status → the stageKey corresponding to the currently-running stage.
// (Kept for the back-compat DV path that the schedule may still hold as 'debate_vote'.)
const CURRENT_STAGE_KEY: Record<string, string | null> = {
  PREPARATION: null,
  SUBMISSION: 'submission',
  FILTERING: 'filtering',
  DEBATE: 'debate',
  VOTE: 'vote',
  DV: 'debate_vote',
  TALLY: 'tally',
  FUNDING: 'funding',
  CLOSED: null,
};

function RoundControl({ round, onChange }: { round: RoundDetail; onChange: () => void }) {
  const t = useT();
  const next = round.nextStage;
  // The "next stage" status — for legacy DV the next is FUNDING (rare).
  const nextStatus = next?.status ?? null;
  // Where we are in the chronology.
  const currentIdx = ALL_STAGES.findIndex((s) => s.status === round.status);
  // Map from stage key → schedule row (legacy debate_vote also gets mapped under
  // 'vote' so a pre-split round still shows a Vote control).
  const scheduleByKey = new Map(round.schedule.map((s) => [s.stageKey, s]));
  const legacyDv = round.schedule.find((s) => s.stageKey === 'debate_vote');
  // §6 — the header badge names the stage that's actually running. A stage stays the round's
  // status until the next one starts, so between stages (current window ended, next not yet
  // launched) no stage is truly active — say so instead of naming the stale stage.
  const now = useNow(30_000);
  const currentStageKey = CURRENT_STAGE_KEY[round.status];
  const currentRow = currentStageKey ? scheduleByKey.get(currentStageKey) : undefined;
  const betweenStages = !!currentRow && new Date(currentRow.endsAt).getTime() <= now;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // §6 — two sub-views: the stage timeline (advance the round) and the round setup
  // (edit name / budget / categories / settings). Horizontal submenu, like My-area.
  const [subTab, setSubTab] = useState<'stages' | 'setup'>('stages');
  const [confirmClose, setConfirmClose] = useState(false);
  // A round's fields (name, budget, categories, settings) are editable until review starts.
  const canEdit = round.status === 'PREPARATION' || round.status === 'SUBMISSION';

  const run = async (action: () => Promise<unknown>, tag: string) => {
    setError(null);
    setBusy(tag);
    try {
      await action();
      onChange();
      // §8 — confirming/launching/saving a stage changes the Round-control to-do count;
      // refresh the badges right away (a now-confirmed next stage drops off the count).
      notifyTodoChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('action failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          Round #{round.number}
          {round.name ? ` — ${round.name}` : ''}
        </span>
        {betweenStages ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t('No active stage')}
          </span>
        ) : (
          <StatusBadge status={round.status} />
        )}
      </div>

      {/* §6 — horizontal submenu: stage timeline vs. round setup. */}
      <div className="mt-2 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {([['stages', 'Round stage control'], ['setup', 'Round setup']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setSubTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${subTab === k ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
          >
            {t(l)}
          </button>
        ))}
      </div>

      {/* §6 — round setup: the full form is always editable (board is trusted); a caution banner
          appears once review has started since changes can affect in-flight decisions. */}
      {subTab === 'setup' ? (
        <div className="mt-3 space-y-2">
          {!canEdit ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {t('⚠ Review has started. You can still edit everything here, but changes now can affect decisions already in flight — fees already paid, votes already cast, reward maths. Edit with care. (The schedule is adjusted under')}{' '}<strong>{t('Round stage control')}</strong>{t('.)')}
            </p>
          ) : null}
          <CreateRoundForm initial={round} roundId={round.id} onDone={onChange} />
        </div>
      ) : null}

      {subTab === 'stages' ? (
      <>
      <div className="mt-2">
        <div className="text-xs text-neutral-500">{t('Proposals (verify readiness before advancing):')}</div>
        <div className="mt-1"><ProposalCounts counts={round.proposalCounts} /></div>
      </div>

      {/* §6/§8 — full schedule for the round: every stage in execution order with
          the controls that make sense for its kind (past / current / next / future). */}
      <div className="mt-3 space-y-2">
        {(() => {
          // Track the previous stage's stored end so each row can flag a start set before it.
          let prevEndsAt: string | undefined;
          return ALL_STAGES.map((stage, idx) => {
            // Resolve the schedule row — fall back to legacy 'debate_vote' for the Vote slot
            // (the Vote sub-stage inherited from the pre-split design when nothing was migrated).
            const row = scheduleByKey.get(stage.key)
              ?? (stage.key === 'vote' && legacyDv ? legacyDv : undefined);
            const kind: 'past' | 'current' | 'next' | 'future' =
              idx < currentIdx ? 'past'
              : idx === currentIdx ? 'current'
              : stage.status === nextStatus ? 'next'
              : 'future';
            const prev = prevEndsAt;
            if (row) prevEndsAt = row.endsAt; // becomes the lower bound for the next stage
            return (
              <StageRow
                key={stage.key}
                kind={kind}
                label={stage.label}
                stageKey={stage.key}
                row={row}
                nextStage={kind === 'next' ? next : null}
                prevEndsAt={prev}
                roundId={round.id}
                busy={busy}
                onRun={run}
              />
            );
          });
        })()}
        {/* §8 — Funding → CLOSED is always manual; surface a dedicated control once we're there. */}
        {round.status === 'FUNDING' ? (
          <div className="rounded border border-red-200 p-2 text-xs dark:border-red-900">
            <div className="font-medium text-red-800 dark:text-red-200">{t('Closing the round')}</div>
            <div className="mt-0.5 text-neutral-500">
              {t('Close manually once funding is complete; delays expected.')}
            </div>
            <button
              onClick={() => setConfirmClose(true)}
              disabled={busy !== null}
              className="mt-1 rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
            >
              {busy === 'close' ? t('Closing…') : t('Close round')}
            </button>
            <ConfirmDialog
              open={confirmClose}
              title={`${t('Close round #')}${round.number}?`}
              message={t('This ends the round. New milestone POAs / votes will no longer be accepted.')}
              confirmLabel={t('Close round')}
              tone="danger"
              onConfirm={() => { setConfirmClose(false); void run(() => boardRoundsApi.close(round.id), 'close'); }}
              onCancel={() => setConfirmClose(false)}
            />
          </div>
        ) : null}
        {!next && round.status !== 'FUNDING' ? (
          <div className="text-xs text-neutral-500">{t('Round complete.')}</div>
        ) : null}
      </div>
      </>
      ) : null}
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}

/**
 * One row in the per-round schedule strip. Behaviour per `kind`:
 *   past    — read-only summary; the stage has already happened.
 *   current — start frozen, end editable + Save.
 *   next    — full confirm-or-launch UI for the immediate next stage.
 *   future  — start/end editable + Save plan (no transition).
 */
function StageRow({
  kind,
  label,
  stageKey,
  row,
  nextStage,
  prevEndsAt,
  roundId,
  busy,
  onRun,
}: {
  kind: 'past' | 'current' | 'next' | 'future';
  label: string;
  stageKey: string;
  row: { stageKey: string; startsAt: string; endsAt: string; autoStart?: boolean; confirmedAt?: string | null } | undefined;
  nextStage: RoundDetail['nextStage'];
  // §6 — the end of the previous stage (stored); a stage may not start before it.
  prevEndsAt: string | undefined;
  roundId: string;
  busy: string | null;
  onRun: (action: () => Promise<unknown>, tag: string) => Promise<void>;
}) {
  const t = useT();
  const tag = `${kind}-${stageKey}`;
  const [startsAt, setStartsAt] = useState(toLocalInput(row?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(row?.endsAt));
  const [autoStart, setAutoStart] = useState(row?.autoStart ?? false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  // Live clock for the stage countdowns (minute granularity → days/hours). Ticks while the page is
  // open so "Ends in / Starts in" and the overdue state update without a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  // §6 — re-sync the editable inputs to the SAVED schedule whenever it changes underneath us (e.g.
  // after confirming/launching a stage reloads the round). Keyed on the saved values so it clears
  // "Not saved" + stale edits after a save, but never clobbers an in-progress edit on a no-op poll.
  useEffect(() => {
    setStartsAt(toLocalInput(row?.startsAt));
    setEndsAt(toLocalInput(row?.endsAt));
    setAutoStart(row?.autoStart ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.startsAt, row?.endsAt, row?.autoStart]);
  const startMs = startsAt ? new Date(startsAt).getTime() : NaN;
  const endMs = endsAt ? new Date(endsAt).getTime() : NaN;
  // §6 — a stage can't start before the previous stage's (stored) end. Flags the start red.
  const prevEndMs = prevEndsAt ? new Date(prevEndsAt).getTime() : NaN;
  const startsBeforePrev = !Number.isNaN(startMs) && !Number.isNaN(prevEndMs) && startMs < prevEndMs;
  // Live stage-length label from the (editable) start→end, recomputed as the inputs change.
  const editDuration = durationLabel(startMs, endMs);
  // §6 — "dirty" = the inputs differ from the saved schedule row. Drives the Saved / Not-saved
  // badge and disables the save button once everything is persisted (re-enables on any edit).
  const savedStart = toLocalInput(row?.startsAt);
  const savedEnd = toLocalInput(row?.endsAt);
  const planDirty = startsAt !== savedStart || endsAt !== savedEnd || autoStart !== (row?.autoStart ?? false);
  const endDirty = endsAt !== savedEnd;
  // Small reusable validation-problem list renderer.
  const Problems = ({ items }: { items: string[] }) =>
    items.length ? (
      <ul className="mt-1 list-disc pl-4 text-[11px] text-red-600 dark:text-red-400">
        {items.map((p) => <li key={p}>{p}</li>)}
      </ul>
    ) : null;
  // Saved / Not-saved indicator shown next to a save button.
  const SavedBadge = ({ dirty }: { dirty: boolean }) =>
    dirty
      ? <span className="text-xs font-medium text-red-600 dark:text-red-400">{t('● Not saved')}</span>
      : <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('✓ Saved')}</span>;
  if (kind === 'past') {
    if (!row) {
      return <PastRow label={label} note={t('no schedule row')} />;
    }
    const lasted = durationLabel(new Date(row.startsAt).getTime(), new Date(row.endsAt).getTime());
    return (
      <PastRow
        label={label}
        note={`${fmtDateTime(row.startsAt)} → ${fmtDateTime(row.endsAt)}${lasted ? ` · ${t('lasted')} ${lasted}` : ''}`}
      />
    );
  }
  if (kind === 'current') {
    if (!row) return <PastRow label={label} note={t('no schedule row')} />;
    // Start is frozen; only the end is editable. Length runs from the frozen start.
    const frozenStartMs = new Date(row.startsAt).getTime();
    const curDuration = durationLabel(frozenStartMs, endMs);
    const problems: string[] = [];
    if (!endsAt) problems.push(t('Set an end date.'));
    else if (Number.isNaN(endMs)) problems.push(t('The end date is invalid.'));
    // Only a real error when the board is actively EXTENDING the end (edited it to a past time).
    // An UNCHANGED end date that has simply passed isn't a mistake to fix — the stage is just
    // overdue to hand off, which the next stage / auto-start handles. So don't nag in red then.
    else if (endMs <= now && endDirty) problems.push(t('The end date must be in the future.'));
    else if (endMs <= frozenStartMs) problems.push(t('The end date must be after the start date.'));
    const valid = problems.length === 0;
    // §6 — once the window has passed the stage is no longer "current": no stage is active
    // until the round advances. Mirrors the read-only Schedule view's "No stage active right now".
    const ended = !Number.isNaN(endMs) && endMs <= now;
    return (
      <div className={`rounded border p-2 ${ended ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20' : 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'}`}>
        <div className="text-xs">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ended ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100' : 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100'}`}>
            {ended ? t('ended') : t('current')}
          </span>{' '}
          <span className="font-medium">{label}</span>
          {' · '}
          <span className="text-neutral-500">{t('started')} {fmtDateTime(row.startsAt)} {t('(frozen)')}</span>
          {curDuration ? <span className="text-neutral-500"> · {t('planned length')} {curDuration}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            {t('ends')}
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <button
            onClick={() => onRun(() => boardRoundsApi.updateCurrentStage(roundId, new Date(endsAt).toISOString()), tag)}
            disabled={busy !== null || !valid || !endDirty}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === tag ? t('Saving…') : t('Save new end date')}
          </button>
          <SavedBadge dirty={endDirty} />
        </div>
        {/* §6 — live countdown to the planned end (mirrors the next stage's "Starts in"). Once it
            passes, the stage doesn't auto-close — the round advances when the NEXT stage starts
            (auto-start) or the board launches it; so we say "Ended … ago" and point there. */}
        {!Number.isNaN(endMs) ? (
          endMs > now ? (
            <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {t('Ends in:')} <span className="font-semibold text-emerald-700 dark:text-emerald-400">{untilLabel(endMs - now)}</span> <span className="text-xs text-neutral-500">({fmtDateTime(endsAt ? new Date(endsAt).toISOString() : row.endsAt)})</span>
            </div>
          ) : (
            <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {t('Ended')} <strong>{untilLabel(now - endMs)}</strong> {t('ago — no stage is active right now. The round advances when you launch the next stage below (or it auto-starts at its planned time). Set a later end above only to extend this stage.')}
            </div>
          )
        ) : null}
        <Problems items={problems} />
      </div>
    );
  }
  if (kind === 'next') {
    const confirmed = !!nextStage?.confirmed;
    // §6/§8 — overdue + the countdown track the EDITABLE start in the inputs (startMs), not the
    // server's last-confirmed value, so editing the start into the future immediately clears the
    // warning (and "Starts in" previews the new time) before the board even confirms.
    const overdue = !Number.isNaN(startMs) && startMs < now;
    const startLabel = startsAt ? fmtDateTime(new Date(startsAt).toISOString()) : fmtDateTime(nextStage?.planned?.startsAt);
    // Relational/format problems — a broken state for BOTH buttons (Launch keeps the stage's
    // planned length, so an end-before-start is nonsensical for it too).
    const relProblems: string[] = [];
    if (!startsAt) relProblems.push(t('Set a start date.'));
    else if (Number.isNaN(startMs)) relProblems.push(t('The start date is invalid.'));
    if (!endsAt) relProblems.push(t('Set an end date.'));
    else if (Number.isNaN(endMs)) relProblems.push(t('The end date is invalid.'));
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs) relProblems.push(t('The end date must be after the start date.'));
    if (startsBeforePrev) relProblems.push(`${label} ${t("can't start before the previous stage ends")} (${fmtDateTime(prevEndsAt)}).`);
    // "Dirty" for the next stage = either the dates/auto-start were edited, or the stage isn't
    // confirmed yet. When it's already confirmed AND unchanged, there's nothing to confirm.
    const nextDirty = planDirty || !confirmed;
    // An overdue stage that's already confirmed with auto-start needs NO board action — the
    // scheduler advances it on its next check. So only nag "the start must be in the future" when
    // there's actually something to confirm (the board edited the plan, or it isn't confirmed yet).
    const autoStartHandlesIt = confirmed && autoStart && !planDirty;
    // "Confirm date" additionally needs the start in the future (auto/planned start). To start a
    // stage right now regardless of the planned start, use "Launch … now".
    const confirmProblems = [...relProblems];
    if (nextDirty && !Number.isNaN(startMs) && startMs <= now) confirmProblems.push(t('The start date must be in the future (or use “Launch now” to start immediately).'));
    const launchValid = relProblems.length === 0;
    const confirmValid = confirmProblems.length === 0;
    return (
      <div className={`rounded border p-2 ${overdue && !autoStartHandlesIt ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20'}`}>
        <div className="text-xs">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {t('next')}
          </span>{' '}
          <span className="font-medium">{label}</span>
          {' · '}
          {confirmed ? (
            <span className="text-emerald-600">
              {t('confirmed')} ({nextStage?.autoStart ? t('auto-start') : t('manual')}, {t('planned')} {fmtDateTime(nextStage?.planned?.startsAt)})
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">{t('not yet confirmed')}</span>
          )}
        </div>
        {/* §6/§8 — overdue handling. Auto-start + confirmed: NO board action needed — the scheduler
            advances it on its next check (≤1 min); offer "Launch now" only as a shortcut. Manual /
            unconfirmed: a loud red call to action (pick a future date or launch now). */}
        {overdue && autoStartHandlesIt ? (
          <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t('Planned start')} ({startLabel}) {t('has passed —')} <strong>{t('auto-start')}</strong> {t('advances it on the next scheduled check (within a minute). No action needed; use')} <strong>{t('Launch')} {label} {t('now')}</strong> {t('to start immediately.')}
          </div>
        ) : overdue ? (
          <div className="mt-1.5 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {t('⚠ The start')} ({startLabel}) {t('is in the past. Launch')} {label} {t('now, or move the start date into the future and confirm.')}
          </div>
        ) : !Number.isNaN(startMs) ? (
          <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
            {t('Starts in:')} <span className="font-semibold text-emerald-700 dark:text-emerald-400">{untilLabel(startMs - now)}</span> <span className="text-xs text-neutral-500">({startLabel})</span>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            {t('starts')}
            <span className={startsBeforePrev ? 'rounded ring-1 ring-red-400 dark:ring-red-700' : ''}>
              <DateField value={startsAt} onChange={setStartsAt} />
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            {t('ends')}
            <DateField value={endsAt} onChange={setEndsAt} />
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            {t('auto-start at the planned time')}
          </label>
          {editDuration ? <span className="text-xs text-neutral-500">· {t('will last')} {editDuration}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() =>
              onRun(
                () => boardRoundsApi.confirmStage(roundId, nextStage?.stageKey ?? stageKey, {
                  autoStart,
                  startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                  endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                }),
                `${tag}-confirm`,
              )
            }
            disabled={busy !== null || !confirmValid || !nextDirty}
            className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
          >
            {busy === `${tag}-confirm` ? t('Saving…') : t('Confirm date')}
          </button>
          <button
            onClick={() => setConfirmLaunch(true)}
            disabled={busy !== null || !launchValid}
            className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            {busy === `${tag}-launch` ? t('Launching…') : `${t('Launch')} ${label} ${t('now')}`}
          </button>
          <SavedBadge dirty={nextDirty} />
        </div>
        <Problems items={confirmProblems} />
        <ConfirmDialog
          open={confirmLaunch}
          title={`${t('Launch')} ${label} ${t('now?')}`}
          message={`${t('This starts the')} ${label} ${t("stage immediately (instead of at the planned time). The stage keeps its planned length and any later stages shift accordingly. This can't be undone.")}`}
          confirmLabel={`${t('Launch')} ${label} ${t('now')}`}
          cancelLabel={t('Cancel')}
          onConfirm={() => { setConfirmLaunch(false); void onRun(() => boardRoundsApi.launchNext(roundId), `${tag}-launch`); }}
          onCancel={() => setConfirmLaunch(false)}
        />
      </div>
    );
  }
  // FUTURE — beyond next. Re-plannable dates; no transition controls.
  const planProblems: string[] = [];
  if (!startsAt) planProblems.push(t('Set a start date.'));
  else if (Number.isNaN(startMs)) planProblems.push(t('The start date is invalid.'));
  else if (startMs <= now) planProblems.push(t('The start date must be in the future.'));
  if (!endsAt) planProblems.push(t('Set an end date.'));
  else if (Number.isNaN(endMs)) planProblems.push(t('The end date is invalid.'));
  else if (!Number.isNaN(startMs) && endMs <= startMs) planProblems.push(t('The end date must be after the start date.'));
  if (startsBeforePrev) planProblems.push(`${label} ${t("can't start before the previous stage ends")} (${fmtDateTime(prevEndsAt)}).`);
  const planValid = planProblems.length === 0;
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs">
        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          {t('planned')}
        </span>{' '}
        <span className="font-medium">{label}</span>
        {' · '}
        <span className="text-neutral-500">{t('re-plan ahead')}</span>
        {editDuration ? <span className="text-neutral-500"> · {t('will last')} {editDuration}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          {t('starts')}
          <span className={startsBeforePrev ? 'rounded ring-1 ring-red-400 dark:ring-red-700' : ''}>
            <DateField value={startsAt} onChange={setStartsAt} />
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          {t('ends')}
          <DateField value={endsAt} onChange={setEndsAt} />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          {t('auto-start at the planned time')}
        </label>
        <button
          onClick={() =>
            onRun(
              () => boardRoundsApi.updatePlannedStage(roundId, stageKey, {
                autoStart,
                startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
              }),
              tag,
            )
          }
          disabled={busy !== null || !planValid || !planDirty}
          className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800"
        >
          {busy === tag ? t('Saving…') : t('Save plan')}
        </button>
        <SavedBadge dirty={planDirty} />
      </div>
      <Problems items={planProblems} />
    </div>
  );
}

function PastRow({ label, note }: { label: string; note: string }) {
  const t = useT();
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50/40 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
      <span className="rounded bg-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
        {t('past')}
      </span>{' '}
      <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
      {' · '}
      {note}
    </div>
  );
}
