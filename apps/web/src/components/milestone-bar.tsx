'use client';

import { useState } from 'react';
import type { MilestoneSegment } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

type TFn = (s: string) => string;

/**
 * §11 — milestone progress bar. One coloured part per milestone:
 *   grey   NOT_STARTED      — no POA submitted yet
 *   amber  UNDER_REVIEW     — POA submitted, reviewers voting
 *   orange REJECTED         — POA rejected, the team must resubmit
 *   blue   PAYMENT_PENDING  — POA approved, payment not sent yet
 *   green  PAID             — milestone delivered + paid (all green = done)
 *   red    LOST             — proposal cancelled, this milestone can't be paid
 *
 * `interactive` (detail view) makes each part clickable to reveal the full
 * milestone info below. In a list row the bar is static with hover tooltips.
 */
const STATE: Record<MilestoneSegment['state'], { bar: string; dot: string; label: string }> = {
  NOT_STARTED:     { bar: 'bg-neutral-300 dark:bg-neutral-700', dot: 'bg-neutral-400', label: 'Not started' },
  UNDER_REVIEW:    { bar: 'bg-amber-400',  dot: 'bg-amber-400',  label: 'Under review' },
  REJECTED:        { bar: 'bg-orange-500', dot: 'bg-orange-500', label: 'POA rejected — resubmit' },
  PAYMENT_PENDING: { bar: 'bg-blue-500',   dot: 'bg-blue-500',   label: 'Payment pending' },
  PAID:            { bar: 'bg-emerald-500', dot: 'bg-emerald-500', label: 'Paid' },
  LOST:            { bar: 'bg-red-500',    dot: 'bg-red-500',    label: 'Lost — not payable' },
};

const ada = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₳`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : null);

function tooltip(seg: MilestoneSegment, t: TFn): string {
  const parts = [`${t('Milestone')} #${seg.idx + 1}${seg.title ? ` — ${seg.title}` : ''}`, `${ada(seg.amountAda)} · ${t(STATE[seg.state].label)}`];
  if (seg.state === 'UNDER_REVIEW') parts.push(`${seg.reviewYes}/${seg.reviewThreshold} ${t('YES')}`);
  if (seg.poaAttempts > 1) parts.push(`${t('POA attempt')} ${seg.poaAttempts}`);
  if (seg.deadlineAt) parts.push(`${t('deadline')} ${fmtDate(seg.deadlineAt)}`);
  return parts.join(' · ');
}

export function MilestoneBar({ segments, interactive = false }: { segments: MilestoneSegment[]; interactive?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (!segments || segments.length === 0) return null;
  const total = segments.reduce((s, m) => s + m.amountAda, 0);
  const paid = segments.filter((m) => m.state === 'PAID').length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>{t('Milestones')} — {paid}/{segments.length} {t('paid')}</span>
        <span className="tabular-nums">{ada(total)} {t('total')}</span>
      </div>
      {/* The bar: equal parts, one per milestone. */}
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded">
        {segments.map((seg) => {
          const cls = `h-full flex-1 ${STATE[seg.state].bar} ${interactive ? 'cursor-pointer transition-opacity hover:opacity-80' : ''} ${open === seg.idx ? 'ring-2 ring-neutral-700 dark:ring-neutral-200' : ''}`;
          return interactive ? (
            <button key={seg.idx} type="button" title={tooltip(seg, t)} onClick={() => setOpen(open === seg.idx ? null : seg.idx)} className={cls} aria-label={tooltip(seg, t)} />
          ) : (
            <div key={seg.idx} title={tooltip(seg, t)} className={cls} />
          );
        })}
      </div>

      {/* Expanded milestone detail (detail view only). */}
      {interactive && open !== null ? (
        <MilestoneDetail seg={segments.find((s) => s.idx === open)!} />
      ) : interactive ? (
        <p className="text-[11px] text-neutral-400">{t('Click a milestone part for its budget, POA status, reviewers and deadline.')}</p>
      ) : null}
    </div>
  );
}

function MilestoneDetail({ seg }: { seg: MilestoneSegment }) {
  const t = useT();
  const st = STATE[seg.state];
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t('Milestone')} #{seg.idx + 1}{seg.title ? ` — ${seg.title}` : ''}</span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
          <span className="font-medium">{t(st.label)}</span>
        </span>
      </div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <Field label={t('Budget')} value={ada(seg.amountAda)} />
        <Field
          label={t('Proof of achievement')}
          value={
            seg.poaAttempts === 0 ? t('not submitted yet')
              : `${t('submitted')}${seg.poaSubmittedAt ? ` ${fmtDate(seg.poaSubmittedAt)}` : ''}${seg.poaAttempts > 1 ? ` · ${t('attempt')} ${seg.poaAttempts}` : ''}`
          }
        />
        <Field
          label={t('Review')}
          value={
            seg.state === 'UNDER_REVIEW' ? `${t('pending')} · ${seg.reviewYes}/${seg.reviewThreshold} ${t('YES')}`
              : seg.state === 'REJECTED' ? t('rejected — resubmit needed')
                : seg.state === 'PAYMENT_PENDING' || seg.state === 'PAID' ? t('approved')
                  : '—'
          }
        />
        <Field label={t('Planned until')} value={fmtDate(seg.deadlineAt) ?? t('no deadline set')} />
        <Field label={t('Reviewers')} value={seg.reviewers.length ? seg.reviewers.join(', ') : t('not assigned yet')} />
        <Field
          label={t('Payment')}
          value={
            seg.state === 'PAID' ? t('sent ✓')
              : seg.state === 'PAYMENT_PENDING' ? t('payment pending')
                : seg.state === 'LOST' ? t('not payable (proposal cancelled)')
                  : '—'
          }
        />
      </dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-neutral-700 dark:text-neutral-300">{value}</dd>
    </div>
  );
}
