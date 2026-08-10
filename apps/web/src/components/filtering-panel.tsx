'use client';

import { useCallback, useEffect, useState } from 'react';
import { filteringApi, matchesProposalSearch, type FilterAssignment, type ReviewMode } from '@/lib/api';
import { BackButton } from './round-ui';
import { ProposalDetail } from './proposal-detail';
import { MarkdownEditor } from './markdown';
import { useT } from '@/lib/prefs-context';

/** §7 — a DRep's filtering review assignments, with a full rationale editor + the proposal. */
export function FilteringPanel({ mode = 'pending', query }: { mode?: ReviewMode; query?: string }) {
  const t = useT();
  const [all, setAll] = useState<FilterAssignment[]>([]);
  // When a proposal is opened, we show ONLY that one (its detail + its own vote box),
  // not the other assignments — a reviewer votes on one proposal at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    filteringApi.myAssignments(mode).then(setAll).catch(() => setAll([]));
  }, [mode]);
  useEffect(load, [load]);

  const assignments = all.filter((a) => matchesProposalSearch(query, { title: a.title, proposer: a.proposer, publicId: a.publicId }));
  if (assignments.length === 0) return null;
  const openRow = openId ? assignments.find((a) => a.proposalId === openId) ?? null : null;
  // §7 — History = rounds past FILTERING: the filtering stage is over, so votes are FINAL and
  // shown read-only (no Edit vote / vote box). To do / Recent stay editable while filtering is live.
  const readOnly = mode === 'history';
  const heading = mode === 'history' ? t('all past assignments (read-only)') : mode === 'recent' ? t('voted — in the active filtering stage') : t('your assignments');

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{t('Filtering')} — {heading} ({assignments.length})</h3>
      <p className="text-xs text-neutral-500">{t('1 person = 1 vote · a NO requires a written rationale. Rationale supports Markdown.')}</p>
      {openRow ? (
        <div className="mt-3">
          <FilterAssignmentRow a={openRow} open readOnly={readOnly} onToggle={() => setOpenId(null)} onVoted={load} />
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {assignments.map((a) => (
            <FilterAssignmentRow key={a.proposalId} a={a} open={false} readOnly={readOnly} onToggle={() => setOpenId(a.proposalId)} onVoted={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterAssignmentRow({
  a,
  open,
  readOnly = false,
  onToggle,
  onVoted,
}: {
  a: FilterAssignment;
  open: boolean;
  readOnly?: boolean;
  onToggle: () => void;
  onVoted: () => void;
}) {
  const t = useT();
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vote = async (choice: 'YES' | 'NO') => {
    setError(null);
    if (choice === 'NO' && !rationale.trim()) {
      setError(t('A NO vote requires a written rationale.'));
      return;
    }
    setBusy(choice);
    try {
      await filteringApi.vote(a.proposalId, choice, rationale.trim() || undefined);
      onVoted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('vote failed'));
    } finally {
      setBusy(null);
    }
  };

  // The rationale editor + YES/NO buttons — shared by the quick row and the open view.
  const voteBox = (
    <>
      <div className="mt-2">
        <MarkdownEditor
          value={rationale}
          onChange={setRationale}
          title={t('Rationale')}
          hint={t('required for a NO vote · formatting (bold, lists) supported')}
          placeholder={t('Your rationale — can be as long as you need.')}
          minRows={6}
        />
      </div>
      {error ? <div className="mt-1 text-sm text-red-600">{error}</div> : null}
      {/* §7.2 — filtering is YES / NO only (a NO needs a rationale); there is no abstain. */}
      <div className="mt-1 flex gap-2">
        {(['YES', 'NO'] as const).map((c) => (
          <button
            key={c}
            disabled={busy !== null}
            onClick={() => vote(c)}
            className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${
              c === 'YES'
                ? 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
                : 'border-red-500 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'
            }`}
          >
            {busy === c ? '…' : c}
          </button>
        ))}
      </div>
    </>
  );

  // Open: show ONLY this proposal — your vote for it, then its full detail.
  if (open) {
    return (
      <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
        <BackButton onBack={onToggle} label={t('back to your assignments')} />
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('Your filtering vote')} — {a.title}</span>
            {a.myVote ? (
              <span className={`text-xs ${a.myVote === 'NO' ? 'text-red-600' : 'text-emerald-600'}`}>{t('voted')} {a.myVote}</span>
            ) : null}
          </div>
          {/* Filtering is over (History) → the vote is final; show it read-only, no editor. */}
          {readOnly
            ? <p className="mt-1 text-xs text-neutral-500">{t('Filtering has ended — this vote is final and can no longer be changed.')}</p>
            : voteBox}
        </div>
        <div className="mt-3">
          <ProposalDetail id={a.proposalId} onBack={onToggle} />
        </div>
      </div>
    );
  }

  // Quick row: rationale + YES/NO collapsed by default — the user wants to see at a glance
  // that they voted, and only open the editor explicitly when they want to vote / change it.
  return <QuickFilterRow a={a} voteBox={voteBox} readOnly={readOnly} onToggle={onToggle} />;
}

/**
 * Collapsed-by-default row.
 * - Status chip on the right: 🟦 QUEUED (pre-assigned during SUBMISSION — vote
 *   opens when the round moves to FILTERING), 🟢 voted YES/NO, 🟡 not voted yet.
 * - A real <button>Vote</button> (or <button>Edit vote</button>) on the right
 *   that opens the rationale + YES/NO box below the row. Disabled when QUEUED
 *   with a tooltip explaining the wait.
 * - View full proposal → still available as a small text link.
 */
function QuickFilterRow({ a, voteBox, readOnly = false, onToggle }: { a: FilterAssignment; voteBox: React.ReactNode; readOnly?: boolean; onToggle: () => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const queued = !!a.queued;
  const label = a.myVote ? t('Edit vote') : t('Vote');
  return (
    <li className="rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{a.title}</span>
        <span className="flex items-center gap-2">
          {queued ? (
            <span
              title={t('Pre-assigned during SUBMISSION. Voting opens when the board moves the round to FILTERING.')}
              className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200"
            >
              {t('QUEUED')}
            </span>
          ) : a.myVote ? (
            <span
              className={
                a.myVote === 'NO'
                  ? 'rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300'
                  : 'rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }
            >
              {t('voted')} {a.myVote}
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {/* History (read-only) = filtering is over, so it can no longer be voted → "not voted". */}
              {readOnly ? t('not voted') : t('not voted yet')}
            </span>
          )}
          {/* Filtering over (History) → no Edit/Vote button; the chip above shows the final vote. */}
          {readOnly ? null : (
            <button
              onClick={() => setExpanded((v) => !v)}
              disabled={queued}
              title={queued
                ? t('Voting opens when the board moves the round to FILTERING.')
                : expanded ? t('Hide the vote box') : t('Open the vote box')}
              className={`rounded-md border px-3 py-1 text-sm font-medium ${
                queued
                  ? 'border-neutral-200 text-neutral-400 cursor-not-allowed dark:border-neutral-800'
                  : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
              }`}
            >
              {expanded ? `▾ ${t('Close')}` : `▸ ${label}`}
            </button>
          )}
          <button onClick={onToggle} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            {t('View full proposal →')}
          </button>
        </span>
      </div>
      {expanded && !queued && !readOnly ? voteBox : null}
      {queued && expanded ? (
        <div className="mt-2 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <strong>{t('Queued.')}</strong> {t('This proposal is pre-assigned to you but its round is still in SUBMISSION. The vote opens automatically when the board moves the round to FILTERING; you’ll see the Vote button enable here and the bell badge will bump up.')}
        </div>
      ) : null}
    </li>
  );
}
