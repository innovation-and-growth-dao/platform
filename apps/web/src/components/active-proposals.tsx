'use client';

import { useEffect, useMemo, useState } from 'react';
import { roundsApi, type RoundSummary } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { ProposalList } from './proposal-list';

/**
 * §11 — proposals of the active round, with a horizontal submenu to switch between
 * the active round and older rounds. The selected round lives in the URL (?round=),
 * defaulting to the active round when one isn't specified — so links are shareable.
 */
export function ActiveProposals() {
  const t = useT();
  const { get, setParams } = useUrlNav();
  const roundParam = get('round');
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);

  useEffect(() => {
    roundsApi.list().then(setRounds).catch(() => setRounds([]));
  }, []);

  // Newest first.
  const ordered = useMemo(() => (rounds ? [...rounds].sort((a, b) => b.number - a.number) : []), [rounds]);

  // The URL's round if valid ('all' = every round); else default to the latest round still in
  // the SUBMISSION phase (where proposals are being submitted), then the latest active round,
  // then the most recent.
  const selected = useMemo(() => {
    if (!rounds) return null;
    if (roundParam === 'all') return 'all';
    if (roundParam && rounds.some((r) => r.id === roundParam)) return roundParam;
    return (
      ordered.find((r) => r.status === 'SUBMISSION')?.id ??
      ordered.find((r) => r.active)?.id ??
      ordered[0]?.id ??
      null
    );
  }, [rounds, ordered, roundParam]);

  if (!rounds) return <p className="text-sm text-neutral-500">{t('Loading…')}</p>;
  if (rounds.length === 0)
    return (
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('Proposals')}</h2>
        <p className="text-sm text-neutral-500">{t('No rounds yet — proposals appear once a round opens.')}</p>
      </div>
    );

  const hasActive = rounds.some((r) => r.active);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t('Proposals')}</h2>
        <p className="text-sm text-neutral-500">
          {hasActive ? t('Proposals in the active round. Switch rounds to browse earlier ones.') : t('No active round right now — browse proposals from earlier rounds.')}
        </p>
      </div>

      {/* Round picker — a combo box (scales to many rounds, unlike a horizontal row). */}
      <div className="flex items-center gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <label htmlFor="round-picker" className="text-sm text-neutral-600 dark:text-neutral-400">{t('Round')}</label>
        <select
          id="round-picker"
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          value={selected ?? ''}
          onChange={(e) => setParams({ round: e.target.value, proposal: null })}
        >
          {/* §26.2 — every proposal ever processed in the DAO, across all rounds. */}
          <option value="all">{t('All rounds')}</option>
          {ordered.map((r) => (
            <option key={r.id} value={r.id}>
              {t('Round')} #{r.number}
              {r.name ? ` — ${r.name}` : ''}
              {r.status === 'SUBMISSION' ? ` · ${t('submission')}` : r.active ? ` · ${t('active')}` : ''}
            </option>
          ))}
        </select>
      </div>

      {selected ? <ProposalList roundId={selected} /> : null}
    </div>
  );
}
