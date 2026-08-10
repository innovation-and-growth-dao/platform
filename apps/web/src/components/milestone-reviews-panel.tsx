'use client';

import { useCallback, useEffect, useState } from 'react';
import { milestonesApi, matchesProposalSearch, type MilestoneAssignmentView } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';

/**
 * §11.3 — the DRep's milestone-review assignments awaiting a vote. The review itself happens on
 * the proposal's detail page (POA + vote), so each row links there. Self-hides when empty.
 */
export function MilestoneReviewsPanel({ history = false, query }: { history?: boolean; query?: string }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [all, setAll] = useState<MilestoneAssignmentView[]>([]);
  const load = useCallback(() => {
    milestonesApi.myAssignments(history).then(setAll).catch(() => setAll([]));
  }, [history]);
  useEffect(load, [load]);

  const items = all.filter((m) => matchesProposalSearch(query, { title: m.proposalTitle, proposer: m.proposer, publicId: m.proposalPublicId }));
  if (items.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{t('Milestone reviews')} — {history ? t('all past assignments') : t('your assignments')} ({items.length})</h3>
      <p className="text-xs text-neutral-500">{t('1 person = 1 vote · review the Proof of Achievement on the proposal page. A NO vote requires feedback.')}</p>
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.milestoneId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <span>
              <span className="font-medium">{m.proposalTitle}</span>
              <span className="ml-2 text-xs text-neutral-500">{t('milestone')} #{m.milestoneIdx + 1}</span>
              {m.milestoneStatus && history ? <span className="ml-2 text-[11px] text-neutral-500">[{m.milestoneStatus}]</span> : null}
            </span>
            <span className="flex items-center gap-2">
              {m.myVote ? (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {t('voted')} {m.myVote}
                </span>
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {t('not voted yet')}
                </span>
              )}
              <button
                onClick={() => setParams({ proposal: m.proposalId })}
                className="rounded-md border border-emerald-500 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
              >
                {m.myVote ? t('▸ Edit vote') : t('▸ Vote')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
