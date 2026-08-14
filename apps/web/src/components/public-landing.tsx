'use client';

import { useEffect, useState } from 'react';
import { publicApi, type PublicOverview } from '@/lib/api';
import { usePrefs } from '@/lib/prefs-context';
import { brand } from '@/lib/brand';

/** ₳ with thousands separators; em-dash when the value is unknown (chain hiccup). */
function ada(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return '₳ ' + Math.round(n).toLocaleString();
}

// A funding round moves Submission → Filtering → Debate·Vote·Tally → Funding.
const STAGES = [
  { key: 'SUBMISSION', label: 'Submission' },
  { key: 'FILTERING', label: 'Filtering' },
  { key: 'DV', label: 'Debate · Vote · Tally' },
  { key: 'FUNDING', label: 'Funding' },
];
// A governance DAO runs a continuous cycle rather than budgeted rounds.
const GOV_FLOW = ['Join', 'Propose', 'Vote', 'Enact'];

export function PublicLanding({ onConnect, onExplore }: { onConnect: () => void; onExplore: () => void }) {
  const { t } = usePrefs();
  const [data, setData] = useState<PublicOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const governance = brand.kind === 'governance';

  useEffect(() => {
    let alive = true;
    publicApi
      .overview()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const round = data?.activeRound ?? null;
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.key === round?.status));
  const n = (v: number) => v.toLocaleString();

  // ---- hero copy differs by edition (values composed OUTSIDE t() so parts translate) ----
  const hero = governance
    ? {
        badge: data ? (data.board.elected ? `${t('Board elected')} · ${data.board.seats} ${t('seats')}` : t('No board yet — DReps can propose one')) : null,
        title: t('Govern Cardano, together.'),
        blurb: t('A community of DReps that debate, propose and vote on-chain. Anyone can watch; connect a wallet to join and vote — no gatekeeping.'),
        explore: t('Meet the DReps'),
      }
    : {
        badge: round ? `${t('Round')} ${round.number} — ${t('accepting proposals')}` : null,
        title: t('Fund the next wave of Cardano.'),
        blurb: t('A community treasury, governed by DReps, spent in the open. Explore everything here — connect a wallet when you’re ready to submit or vote.'),
        explore: t('Explore proposals'),
      };

  return (
    <div className="space-y-4">
      {/* ---- Hero banner ---- */}
      <section className="relative overflow-hidden rounded-2xl p-8 text-emerald-50 sm:p-10"
        style={{ background: 'radial-gradient(120% 140% at 100% 0, #0e6f73 0%, #0e7a4b 46%, #0b5f3b 100%)' }}>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.16), transparent 60%)' }} />
        <div className="relative">
          {hero.badge ? (
            <span className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#7dffc0' }} />
              {hero.badge}
            </span>
          ) : null}
          <h1 className="max-w-[18ch] text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl">{hero.title}</h1>
          <p className="mt-3 max-w-[52ch] text-[16.5px] text-emerald-100/90">{hero.blurb}</p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button onClick={onExplore}
              className="rounded-full bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-[#0b5f3b] transition hover:bg-white">
              {hero.explore}
            </button>
            <button onClick={onConnect}
              className="rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-white/25">
              {t('Connect wallet')}
            </button>
          </div>
        </div>
      </section>

      {/* ---- Stat tiles ---- */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {governance ? (
          <>
            <Tile bg="#0e7a4b" label={t('Voting DReps')} big={`${data?.members.votingDReps ?? 0}`}
              sub={data?.admissionOpen ? t('Open admission — join freely') : t('Board-gated admission')} />
            <Tile bg="#0e6f73" label={t('Governance proposals')} big={`${data?.internalProposals.total ?? 0}`}
              sub={`${data?.internalProposals.passed ?? 0} ${t('passed')} · ${data?.internalProposals.active ?? 0} ${t('in voting')}`} />
            <Tile bg="#4f8f2f" label={t('Board')} big={data ? (data.board.elected ? `${data.board.seats}` : '—') : '—'}
              sub={data?.board.elected ? t('seats elected') : t('not yet elected')} />
            <Tile bg="#173a2a" label={t('Governance')} big={data?.admissionOpen ? t('Open') : t('Gated')}
              sub={t('Any registered DRep can join & vote')} />
          </>
        ) : (
          <>
            <Tile bg="#0e7a4b" label={t('Treasury balance')} big={ada(data?.treasuryBalanceAda)}
              sub={round ? `₳ ${n(round.budgetAda)} ${t('committed to Round')} ${round.number}` : t('On-chain, live')} />
            <Tile bg="#0e6f73" label={round ? `${t('Round')} ${round.number} ${t('budget')}` : t('Round budget')}
              big={round ? ada(round.budgetAda) : '—'}
              sub={round ? `+ ₳ ${n(round.rewardsPoolAda)} ${t('rewards pool')}` : t('No active round')} />
            <Tile bg="#4f8f2f" label={t('Voting DReps')} big={`${data?.members.votingDReps ?? 0}`}
              sub={`${data?.members.experts ?? 0} ${t('experts advising')}`} />
            <Tile bg="#173a2a" label={t('Proposals')} big={`${data?.proposals.total ?? 0}`}
              sub={`${data?.proposals.approved ?? 0} ${t('approved')} · ${data?.proposals.inReview ?? 0} ${t('in review')}`} />
          </>
        )}
      </div>

      {/* ---- Bottom strip: round stages (funding) or governance flow (DRep) ---- */}
      {governance ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
          {GOV_FLOW.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              {i > 0 ? <span className="text-neutral-300 dark:text-neutral-700">→</span> : null}
              <span className="flex items-center gap-2 text-[13.5px]">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-emerald-600 text-[12px] font-bold text-white">{i + 1}</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{t(label)}</span>
              </span>
            </div>
          ))}
          <span className="ml-auto text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {data?.board.elected ? `${t('Board of')} ${data.board.seats} · ${t('DReps propose & vote on governance')}` : t('DReps can propose the founding board')}
          </span>
        </div>
      ) : round ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              {i > 0 ? <span className="text-neutral-300 dark:text-neutral-700">→</span> : null}
              <span className="flex items-center gap-2 text-[13.5px]">
                <span className={`grid h-[22px] w-[22px] place-items-center rounded-full text-[12px] font-bold ${
                  i === stageIdx ? 'bg-emerald-600 text-white' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                }`}>{i + 1}</span>
                <span className={i === stageIdx ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}>
                  {t(s.label)}
                </span>
              </span>
            </div>
          ))}
          <span className="ml-auto text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {t('Round')} {round.number} · {round.name} · {data?.admissionOpen ? t('open admission') : t('board-gated admission')}
          </span>
        </div>
      ) : null}

      {/* ---- Transparency footer note ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {t('Live on')} {data?.network ?? 'Preprod'}
        </span>
        <span>{t('Every vote & payment anchored on-chain')}</span>
        {data?.admissionOpen ? <span>{t('Open admission — any registered DRep can join & vote')}</span> : null}
        {failed ? <span className="text-amber-600 dark:text-amber-500">{t('Some live figures are temporarily unavailable.')}</span> : null}
      </div>
    </div>
  );
}

function Tile({ bg, label, big, sub }: { bg: string; label: string; big: string; sub: string }) {
  return (
    <div className="flex min-h-[118px] flex-col justify-between rounded-2xl p-4 text-white" style={{ backgroundColor: bg }}>
      <div className="text-[12.5px] opacity-90">{label}</div>
      <div>
        <div className="text-[30px] font-bold leading-none tracking-tight tabular-nums">{big}</div>
        <div className="mt-1 text-[12px] opacity-90">{sub}</div>
      </div>
    </div>
  );
}
