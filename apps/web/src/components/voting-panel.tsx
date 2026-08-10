'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import {
  boardProposalsApi,
  dvApi,
  matchesDvMode,
  matchesProposalSearch,
  proposalsApi,
  roundsApi,
  type DvResult,
  type ProposalSummary,
  type ReviewMode,
} from '@/lib/api';
import { ProposalDetail } from './proposal-detail';
import { MarkdownEditor } from './markdown';
import { BackButton } from './round-ui';

// Per-DRep vote flag shown in the card's top-right corner.
const VOTE_FLAG: Record<string, string> = {
  YES: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  NO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  ABSTAIN: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export function VotingPanel({ mode = 'pending', query }: { mode?: ReviewMode; query?: string }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const isDrep = profile?.roles.includes('DREP') ?? false;
  const [items, setItems] = useState<ProposalSummary[]>([]);

  const load = useCallback(async () => {
    const rounds = await roundsApi.list().catch(() => []);
    const lists = await Promise.all(rounds.map((r) => proposalsApi.byRound(r.id).catch(() => [])));
    // Bucketing rules (To do / Recent / History) live in matchesDvMode — see
    // @drep-dao/shared/proposal-lifecycle. To do + Recent require ballots OPEN (round in VOTE), so
    // the panel is empty during DEBATE; History excludes filtering-rejected proposals.
    const voteRoundIds = new Set(rounds.filter((r) => r.status === 'VOTE' || r.status === 'DV').map((r) => r.id));
    const closedRoundIds = new Set(rounds.filter((r) => r.status === 'CLOSED').map((r) => r.id));
    const all = lists.flat();
    setItems(all.filter((p) =>
      matchesDvMode(p, mode, { voteRoundIds, closedRoundIds })
      && matchesProposalSearch(query, { title: p.title, proposer: p.submitter, publicId: p.publicId })));
  }, [mode, query]);
  useEffect(() => {
    void load();
  }, [load]);

  // When a proposal is opened to read + vote, show ONLY that one (its single vote box + the full
  // proposal) — not the other proposals' boxes — to avoid the "which box do I fill?" confusion.
  const [openId, setOpenId] = useState<string | null>(null);
  // Switching To do / Recent / History always returns to the collapsed list — a proposal you opened
  // (and voted) in To do shouldn't still be sitting open when you land on Recent.
  useEffect(() => { setOpenId(null); }, [mode]);
  if (items.length === 0) return null;
  const openRow = openId ? items.find((p) => p.id === openId) ?? null : null;
  const heading = mode === 'history' ? t(' — past decisions') : mode === 'recent' ? t(' — open for your vote') : '';

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{t('Debate & Vote')} ({items.length}){heading}</h3>
      <p className="text-xs text-neutral-500">{t('Balanced voting power (§4); rationale ≥ 200 chars.')}</p>
      {openRow ? (
        <div className="mt-2">
          <VoteCard proposal={openRow} isBoard={isBoard} isDrep={isDrep} open onToggle={() => setOpenId(null)} onChange={load} />
        </div>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((p) => (
            <VoteCard key={p.id} proposal={p} isBoard={isBoard} isDrep={isDrep} open={false} onToggle={() => setOpenId(p.id)} onChange={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function VoteCard({
  proposal,
  isBoard,
  isDrep,
  open,
  onToggle,
  onChange,
}: {
  proposal: ProposalSummary;
  isBoard: boolean;
  isDrep: boolean;
  /** true = the only card shown (read the full proposal + vote here). */
  open: boolean;
  /** open → go back to the list; list → open this proposal. */
  onToggle: () => void;
  onChange: () => void;
}) {
  const t = useT();
  const [r, setR] = useState<DvResult | null>(null);
  const [choice, setChoice] = useState<'YES' | 'NO' | 'ABSTAIN'>('YES');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In the list, the vote box stays collapsed behind a Vote/Edit-vote toggle so the list isn't a
  // wall of rationale boxes; in the open view it's always shown.
  const [expanded, setExpanded] = useState(false);

  const loadResult = useCallback(() => {
    dvApi.result(proposal.id).then(setR).catch(() => setR(null));
  }, [proposal.id]);
  useEffect(loadResult, [loadResult]);
  // Pre-fill the box with the DRep's current rationale so a re-vote starts from what they wrote.
  useEffect(() => {
    if (r?.myRationale) setRationale(r.myRationale);
  }, [r?.myRationale]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      loadResult();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  // Vote flag (DReps only): their own choice once cast, else PENDING while voting is open.
  const flag = isDrep ? r?.myChoice ?? (r?.open ? 'PENDING' : null) : null;

  const tally = r?.open ? (
    <div className="mt-1 text-xs text-neutral-500">
      {r.cast}/{r.eligible} {t('voted')} · YES {r.yesPower} / {t('denom')} {r.denominator} ={' '}
      <strong>{r.ratioPct}%</strong> ({t('threshold')} {r.thresholdPct}%) ·{' '}
      <span className={r.approved ? 'text-emerald-600' : 'text-red-600'}>{r.approved ? t('passing') : t('failing')}</span>
    </div>
  ) : (
    <div className="mt-1 text-xs text-neutral-500">{t('Voting not open yet.')}</div>
  );

  // §8 — the single, BLUE vote box (radio + rich rationale + history + cast button). Shared by the
  // open view and the list's expanded toggle, so there's exactly one rationale box per proposal.
  const voteBox = isDrep && r?.open ? (
    <div className="mt-2 space-y-1 rounded-md border border-blue-300 bg-blue-50/50 p-2 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t('Your vote & rationale')}</div>
      <div className="flex gap-3 text-xs">
        {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => (
          <label key={c} className="flex items-center gap-1">
            <input type="radio" checked={choice === c} onChange={() => setChoice(c)} /> {c}
          </label>
        ))}
      </div>
      <MarkdownEditor
        value={rationale}
        onChange={setRationale}
        title={t('Rationale')}
        hint={t('min 200 chars · published with your vote')}
        placeholder={t('Explain your reasoning — formatting (bold, lists) supported.')}
        minRows={8}
      />
      {r?.myRationaleHistory && r.myRationaleHistory.length > 0 ? (
        <details className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
          <summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
            {t('Previous rationales')} ({r.myRationaleHistory.length}) {t('— view only')}
          </summary>
          <ul className="mt-1 space-y-1">
            {r.myRationaleHistory.map((h, i) => (
              <li key={i} className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="mb-0.5 flex items-center gap-2 text-[10px]">
                  <span className={`font-bold uppercase ${h.choice === 'NO' ? 'text-red-600' : h.choice === 'YES' ? 'text-emerald-600' : 'text-neutral-500'}`}>{h.choice}</span>
                  <span className="text-neutral-400">{new Date(h.castAt).toLocaleString()}</span>
                </div>
                <div className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{h.rationale}</div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <button
        disabled={busy || rationale.trim().length < 200}
        onClick={() => act(() => dvApi.vote(proposal.id, choice, rationale))}
        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {rationale.trim().length < 200
          ? `${r?.myChoice ? t('Update vote') : t('Cast vote')} (${rationale.trim().length}/200)`
          : r?.myChoice ? t('Update vote') : t('Cast vote')}
      </button>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </div>
  ) : null;

  const boardNote = isBoard ? (
    <div className="mt-2 text-xs text-neutral-500">
      {r?.open ? t('Tally finalizes automatically when the round advances to TALLY (after the Vote stage ends).') : t('Voting opens automatically when the round enters VOTE.')}
    </div>
  ) : null;

  // Open: ONLY this proposal — the single blue vote box, then the full proposal to read.
  if (open) {
    return (
      <li className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <BackButton onBack={onToggle} label={t('back to your votes')} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{proposal.title}</span>
          {flag ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${VOTE_FLAG[flag]}`}>{flag}</span> : null}
        </div>
        {tally}
        {voteBox}
        {boardNote}
        <div className="mt-3">
          <ProposalDetail id={proposal.id} onBack={onToggle} />
        </div>
      </li>
    );
  }

  // Collapsed list row: flag + tally + a Vote/Edit-vote toggle (opens the one blue box) and the
  // "View full proposal" link. So a DRep can vote straight from the list, or open to read first.
  return (
    <li className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{proposal.title}</span>
        <span className="flex items-center gap-3">
          {flag ? (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${VOTE_FLAG[flag]}`} title={flag === 'PENDING' ? t("You haven't voted yet") : `${t('You voted')} ${flag}`}>{flag}</span>
          ) : null}
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{proposal.requestedAmountAda.toLocaleString()} ₳</span>
          {isDrep && r?.open ? (
            <button onClick={() => setExpanded((v) => !v)} className="rounded-md border border-blue-500 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950">
              {expanded ? `▾ ${t('Close')}` : r?.myChoice ? `▸ ${t('Edit vote')}` : `▸ ${t('Vote')}`}
            </button>
          ) : null}
          <button onClick={onToggle} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('View full proposal →')}</button>
        </span>
      </div>
      {tally}
      {boardNote}
      {expanded ? voteBox : null}
    </li>
  );
}
