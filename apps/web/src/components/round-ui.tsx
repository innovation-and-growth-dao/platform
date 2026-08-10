'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/prefs-context';

/** Shared presentation bits for rounds & proposals (badges, colors, formatting). */

/**
 * Shared "back to X" button — outlined pill, large enough to be obvious and clickable on
 * mobile, used at the top of every detail view (proposal, round, internal proposal,
 * filtering assignment, etc.). Pass `label` without the arrow ("rounds" / "proposals" / …);
 * the component renders the arrow itself.
 */
export function BackButton({ onBack, label = 'back' }: { onBack: () => void; label?: string }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-300"
    >
      <span aria-hidden className="text-base leading-none">←</span>
      <span>{label}</span>
    </button>
  );
}

export const ROUND_STATUS_CLS: Record<string, string> = {
  PREPARATION: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200',
  SUBMISSION: 'bg-amber-200 text-amber-900',
  FILTERING: 'bg-blue-200 text-blue-900',
  DV: 'bg-indigo-200 text-indigo-900',
  TALLY: 'bg-violet-200 text-violet-900',
  FUNDING: 'bg-emerald-200 text-emerald-900',
  CLOSED: 'bg-neutral-300 text-neutral-700',
};

// Proposal statuses. DRAFT/PENDING are surfaced as a count only (content stays private), so a
// round's overview shows how it is filling up.
export const PROPOSAL_STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ACTIVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  COMPLETE: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  FAILED: 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100',
  DRAFT: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};
// Order proposal-status chips consistently. The backend (both the round detail and the rounds
// list) sends counts for every status, including DRAFT/PENDING.
const STATUS_ORDER = ['DRAFT', 'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'];

export function StatusBadge({ status, cls }: { status: string; cls?: Record<string, string> }) {
  const t = useT();
  const map = cls ?? ROUND_STATUS_CLS;
  return <span className={`rounded px-2 py-0.5 text-xs ${map[status] ?? 'bg-neutral-200 text-neutral-700'}`}>{t(status)}</span>;
}

/**
 * Per-status proposal count chips, e.g. "2 ACTIVE (1 filtering · 1 D&V) · 1 APPROVED".
 * When `activeStage` is supplied (a breakdown of ACTIVE by stage), the ACTIVE chip is
 * suffixed with the stage breakdown so the reader sees what's currently in motion.
 */
const ACTIVE_STAGE_LABEL: Record<string, string> = {
  FILTERING: 'filtering',
  DEBATE_VOTE: 'D&V',
  FUNDING: 'funding',
};
export function ProposalCounts({ counts, activeStage }: { counts?: Record<string, number>; activeStage?: Record<string, number> }) {
  const t = useT();
  const c = counts ?? {};
  const entries = STATUS_ORDER.filter((s) => (c[s] ?? 0) > 0).map((s) => [s, c[s]] as const);
  if (entries.length === 0) return <span className="text-xs text-neutral-400">{t('no proposals yet')}</span>;
  const activeParts = activeStage
    ? Object.entries(activeStage)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([stage, n]) => `${n} ${ACTIVE_STAGE_LABEL[stage] ?? stage.toLowerCase()}`)
    : [];
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([s, n]) => (
        <span key={s} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PROPOSAL_STATUS_CLS[s] ?? ''}`}>
          {n} {s.toLowerCase()}
          {s === 'ACTIVE' && activeParts.length > 0 ? <span className="ml-1 font-normal opacity-70">({activeParts.join(' · ')})</span> : null}
        </span>
      ))}
    </div>
  );
}

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** A ticking "now" (ms) that updates every `intervalMs` — for live countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Human countdown for a remaining-ms value: "2d 3h", "1h 23m", "4m 12s", "9s", "0s". */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
/** Same as fmtDateTime but date only — used wherever the time isn't meaningful (board install date, etc.). */
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium' }) : '—';

/** Convert an ISO string to the value a <input type="datetime-local"> expects. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

/**
 * Voting rationale with a visible **shrink/expand toggle** on every row, so the reader can
 * always collapse the rationale away — short rationales default to expanded, longer ones
 * (>50 chars or multi-line) default to collapsed. Preserves original line breaks when expanded.
 */
export function RationaleText({ text }: { text: string | null | undefined }) {
  const t = useT();
  const trimmed = (text ?? '').trim();
  const long = trimmed.length > 50 || trimmed.includes('\n');
  const [open, setOpen] = useState(!long);
  if (!trimmed) return null;
  return (
    <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-emerald-700 hover:underline dark:text-emerald-400"
      >
        {open ? t('▾ rationale (hide)') : `▸ ${t('rationale')} (${trimmed.length} char${trimmed.length === 1 ? '' : 's'} — ${t('show')})`}
      </button>
      {open ? <div className="mt-0.5 whitespace-pre-wrap">{trimmed}</div> : null}
    </div>
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Date / datetime-local picker that shows the **month as a name** (a <select> of "January…
 * December") + numeric day + numeric year + (for datetime) a time input. Native
 * `<input type="datetime-local">` always shows MM/DD/YYYY (or DD/MM/YYYY in non-en locales),
 * which is easy to mis-read, so this custom widget makes the month unambiguous in every browser.
 * `min` is accepted for API compatibility but not enforced per-field; submit-time validation
 * (and inline warnings the caller renders) cover the constraint.
 */
function parseValue(value: string, withTime: boolean) {
  if (!value) return { y: '', m: '', d: '', t: withTime ? '00:00' : '' };
  const [datePart, timePart] = value.split('T');
  const [yy = '', mm = '', dd = ''] = (datePart ?? '').split('-');
  return {
    y: yy,
    m: mm ? String(parseInt(mm, 10)) : '',
    d: dd ? String(parseInt(dd, 10)) : '',
    t: (timePart ?? '').slice(0, 5) || (withTime ? '00:00' : ''),
  };
}

export function DateField({
  value,
  onChange,
  type = 'datetime-local',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  min,
  required,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: 'date' | 'datetime-local';
  min?: string;
  required?: boolean;
  className?: string;
}) {
  const tr = useT();
  const withTime = type === 'datetime-local';
  // Sub-fields keep their own state so the user can fill them in any order — the parent's
  // `value` only updates once month + day + year are all set (otherwise the partial entry
  // would clear right back to empty and the user couldn't type anything individually).
  const initial = parseValue(value, withTime);
  const [y, setY] = useState(initial.y);
  const [m, setM] = useState(initial.m);
  const [d, setD] = useState(initial.d);
  const [t, setT] = useState(initial.t);

  // Re-sync when the parent value changes externally (e.g. form reset, default).
  useEffect(() => {
    const p = parseValue(value, withTime);
    setY(p.y); setM(p.m); setD(p.d); setT(p.t);
  }, [value, withTime]);

  const commit = (yy: string, mm: string, dd: string, tt: string) => {
    if (yy && mm && dd) {
      const date = `${yy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      onChange(withTime ? `${date}T${(tt || '00:00').slice(0, 5)}` : date);
    } else if (value) {
      // A sub-field was cleared — reset parent so the form treats it as empty/invalid.
      onChange('');
    }
  };

  const update = (next: Partial<{ y: string; m: string; d: string; t: string }>) => {
    const yy = next.y ?? y, mm = next.m ?? m, dd = next.d ?? d, tt = next.t ?? t;
    if (next.y !== undefined) setY(next.y);
    if (next.m !== undefined) setM(next.m);
    if (next.d !== undefined) setD(next.d);
    if (next.t !== undefined) setT(next.t);
    commit(yy, mm, dd, tt);
  };

  const cell = 'rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <select
        value={m}
        required={required}
        onChange={(e) => update({ m: e.target.value })}
        className={`${cell} min-w-[8.5rem]`}
      >
        <option value="">{tr('Month')}</option>
        {MONTHS.map((label, i) => (
          <option key={i + 1} value={String(i + 1)}>{label}</option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={31}
        placeholder={tr('Day')}
        value={d}
        required={required}
        onChange={(e) => update({ d: e.target.value.replace(/\D/g, '') })}
        className={`${cell} w-16`}
      />
      <input
        type="number"
        min={2024}
        max={2100}
        placeholder={tr('Year')}
        value={y}
        required={required}
        onChange={(e) => update({ y: e.target.value.replace(/\D/g, '') })}
        className={`${cell} w-24`}
      />
      {withTime ? (
        <input
          type="time"
          value={t || '00:00'}
          onChange={(e) => update({ t: e.target.value })}
          className={`${cell} w-28`}
        />
      ) : null}
    </div>
  );
}

/**
 * §4.4 — YES / NO / abstain as balanced voting power, scaled to total power, with a
 * threshold marker. Shared by the proposal detail's Debate & Vote section and the
 * round's Voting Result tab so both render an identical bar. `no` should already
 * include implicit NO (total − yes − abstain). `thresholdPosPct` is the threshold's
 * position on the total-power scale; compute it with `thresholdMarkerPct`.
 */
export function PowerBar({ yes, no, abstain, total, thresholdPosPct, thresholdPct }: { yes: number; no: number; abstain: number; total: number; thresholdPosPct: number; thresholdPct: number }) {
  const t = useT();
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  // Share of TOTAL power (so YES/NO/abstain sum to 100% and match the bar segment widths).
  const pctLabel = (v: number) => (total > 0 ? ` (${Math.round(pct(v))}%)` : '');
  const tpos = Math.min(100, Math.max(0, thresholdPosPct));
  return (
    <div className="mt-6">
      <div className="relative h-5 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="absolute inset-0 overflow-hidden rounded">
          <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(yes)}%` }} />
          <div className="absolute inset-y-0 bg-red-400" style={{ left: `${pct(yes)}%`, width: `${pct(no)}%` }} />
          <div className="absolute inset-y-0 bg-neutral-400" style={{ left: `${pct(yes + no)}%`, width: `${pct(abstain)}%` }} />
        </div>
        {/* §6 — threshold marker with a labelled percentage above the line. */}
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-300" style={{ left: `${tpos}%` }}>
          {t('threshold')} {thresholdPct}%
        </div>
        <div className="absolute -top-1.5 bottom-0 w-0.5 bg-neutral-900 dark:bg-white" style={{ left: `${tpos}%` }} title={`${t('threshold')} ${thresholdPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />{t('YES')} {fmt(yes)}{pctLabel(yes)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />{t('NO')} {fmt(no)}{pctLabel(no)}</span>
        {abstain > 0 ? <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-400" />{t('abstain')} {fmt(abstain)}{pctLabel(abstain)}</span> : null}
        <span className="tabular-nums">{t('total power')} {fmt(total)} · {t('threshold')} {thresholdPct}%</span>
      </div>
    </div>
  );
}

/** Threshold marker position on the total-power scale (%): threshold is a % of the
 *  denominator (total − abstain), placed relative to total power. */
export function thresholdMarkerPct(total: number, abstain: number, thresholdPct: number): number {
  const denom = total - abstain;
  return total > 0 ? (((thresholdPct / 100) * denom) / total) * 100 : 0;
}
