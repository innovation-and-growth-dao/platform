'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardProposalsApi, boardMilestoneApi, matchesProposalSearch, type PendingReviewerAssignment } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';

/**
 * §11 — board to-do: proposals awaiting a review jury, both stages (filtering draw + milestone
 * reviewers). One-click random assignment (expertise-matched, load-balanced, random tiebreak) or
 * open the proposal to pick manually.
 */
export function ReviewerAssignments({ onChange, query }: { onChange?: () => void; query?: string }) {
  const [all, setAll] = useState<PendingReviewerAssignment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const { setParams } = useUrlNav();
  const t = useT();
  const load = useCallback(() => { boardProposalsApi.pendingReviewerAssignment().then(setAll).catch(() => setAll([])); }, []);
  useEffect(load, [load]);

  const items = all.filter((it) => matchesProposalSearch(query, { title: it.title, proposer: it.submitter, publicId: it.publicId }));
  if (items.length === 0) return null;

  const assign = async (it: PendingReviewerAssignment) => {
    const key = `${it.kind}:${it.proposalId}`;
    setBusy(key); setErr((e) => ({ ...e, [key]: '' }));
    try {
      if (it.kind === 'FILTERING') await boardProposalsApi.drawReviewers(it.proposalId);
      else await boardMilestoneApi.draw(it.proposalId);
      load(); onChange?.();
    } catch (e) {
      setErr((m) => ({ ...m, [key]: e instanceof Error ? e.message : t('assignment failed') }));
    } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-base font-semibold">{t('Reviewers to assign')} ({items.length})</h3>
      <p className="text-xs text-neutral-500">
        {t('§11 — assign a review jury. Use the random draw (expertise-matched, load-balanced) or open the proposal to pick reviewers manually.')}
      </p>
      <ul className="space-y-2">
        {items.map((it) => {
          const key = `${it.kind}:${it.proposalId}`;
          return (
            <li key={key} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{it.publicId ? `${it.publicId} · ` : ''}{it.title}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${it.kind === 'FILTERING' ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'}`}>
                    {it.kind === 'FILTERING' ? t('Filtering reviewers') : t('Milestone reviewers')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => assign(it)} disabled={busy === key} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === key ? t('Assigning…') : `${t('Assign')} ${it.targetCount} ${t('(random)')}`}
                  </button>
                  <button onClick={() => setParams({ proposal: it.proposalId })} className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
                    {t('Open proposal')}
                  </button>
                </div>
              </div>
              <div className="text-xs text-neutral-500">{t('by')} {it.submitter ?? '—'}{it.roundNumber != null ? ` · ${t('Round')} #${it.roundNumber}` : ''}</div>
              {err[key] ? <div className="mt-1 text-xs text-red-600">{err[key]}</div> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
