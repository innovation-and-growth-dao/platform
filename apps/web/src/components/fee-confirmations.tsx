'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardFeeApi, boardProposalsApi, matchesProposalSearch, type FeeHistoryPage, type FeeHistoryRow, type PendingFee } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { fmtDateTime } from './round-ui';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';

const HISTORY_PAGE = 20;

/**
 * §16 — board reviews submission-fee payments. The submitter pays the fee to the dedicated
 * address and provides the tx hash (they may have entered several — all are shown, each
 * verified on-chain). The reviewer **Approves** (→ Filtering, public) or **Rejects** (→
 * REJECTED) with feedback the submitter sees in a red FEEDBACK box.
 *
 * With `history` enabled, also renders the **decided** fee reviews (approved + fee-rejected)
 * with a pager (default 20/page, newest first) — so the board can look back at past
 * decisions without scrolling the live proposal pages.
 */
export function FeeConfirmations({ onChange, history = false, query }: { onChange?: () => void; history?: boolean; query?: string }) {
  const t = useT();
  const [all, setAll] = useState<PendingFee[]>([]);

  const load = useCallback(() => {
    boardFeeApi.pending().then(setAll).catch(() => setAll([]));
  }, []);
  useEffect(load, [load]);

  // PendingFee carries no public id, so search matches title + proposer here.
  const pending = all.filter((p) => matchesProposalSearch(query, { title: p.title, proposer: p.submitter }));
  if (pending.length === 0 && !history) return null;

  return (
    <>
      {pending.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <h3 className="text-base font-semibold">{t('Submission fees to confirm')}</h3>
          <p className="text-xs text-neutral-500">
            {t('The platform checks each fee tx')} <strong>{t('on-chain')}</strong> {t('(did the paid amount reach the fee address?).')}
            <strong> {t('Approve')}</strong> {t('to admit the proposal into Filtering (public), or')} <strong>{t('Reject')}</strong> {t('with a reason the submitter will see.')}
          </p>
          <ul className="space-y-2">
            {pending.map((p) => (
              <PendingFeeRow key={p.id} p={p} onReviewed={() => { load(); onChange?.(); }} />
            ))}
          </ul>
        </section>
      ) : null}
      {history ? <FeeHistory query={query} /> : null}
    </>
  );
}

/**
 * Paginated history of decided fee reviews (approved + fee-rejected). Default
 * page size is 20 (matches the user's request); pager appears once total > 20.
 */
function FeeHistory({ query }: { query?: string }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const { txUrl } = useExplorer();
  const [page, setPage] = useState<FeeHistoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    boardFeeApi.history(HISTORY_PAGE, offset).then(setPage).catch(() => setPage(null));
  }, [offset]);
  if (!page) return null;

  // Search filters the rows currently loaded on this page (history is paged server-side).
  const rows = page.rows.filter((r) => matchesProposalSearch(query, { title: r.title, proposer: r.submitter, publicId: r.publicId }));
  const start = page.rows.length === 0 ? 0 : page.offset + 1;
  const end = page.offset + page.rows.length;
  const last = Math.floor((page.total - 1) / HISTORY_PAGE) * HISTORY_PAGE;

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('Submission-fee history')}</h3>
        <span className="text-xs text-neutral-500">
          {page.total === 0 ? t('No decisions yet.') : `${t('Showing')} ${start}–${end} ${t('of')} ${page.total}`}
        </span>
      </div>
      {rows.length === 0 ? null : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <HistoryRow
              key={r.id}
              r={r}
              onOpen={() => setParams({ proposal: r.id })}
              onChanged={() => boardFeeApi.history(HISTORY_PAGE, offset).then(setPage).catch(() => undefined)}
            />
          ))}
        </ul>
      )}
      {page.total > HISTORY_PAGE ? (
        <div className="flex items-center justify-between text-xs">
          <div className="flex gap-1">
            <button onClick={() => setOffset(0)} disabled={offset === 0} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">{t('⏮ First')}</button>
            <button onClick={() => setOffset(Math.max(0, offset - HISTORY_PAGE))} disabled={offset === 0} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">{t('◀ Previous')}</button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setOffset(Math.min(last, offset + HISTORY_PAGE))} disabled={offset >= last} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">{t('Next ▶')}</button>
            <button onClick={() => setOffset(last)} disabled={offset >= last} className="rounded border border-neutral-300 px-2 py-0.5 disabled:opacity-40 dark:border-neutral-700">{t('Last ⏭')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PendingFeeRow({ p, onReviewed }: { p: PendingFee; onReviewed: () => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError(t('A reason is required to reject — the submitter will see it.'));
      return;
    }
    setBusy(true);
    try {
      await boardProposalsApi.reviewFee(p.id, decision, feedback.trim() || undefined);
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('review failed'));
    } finally {
      setBusy(false);
    }
  };

  // A fee may be split across several txs (none alone reaches the amount, but
  // together they do). Sum what reached the fee address across all confirmed txs.
  const foundTxs = p.txs.filter((tx) => tx.found);
  const foundTotal = foundTxs.reduce((s, tx) => s + tx.paidAda, 0);
  const aggregateCovers = !p.feeVerified.paid && foundTotal >= p.submissionFeeAda;

  return (
    <li className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{p.title}</span>
        <span className="text-xs text-neutral-500">
          {t('round')} #{p.roundNumber} · {p.isCommercial ? t('commercial') : t('open-source')}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {t('fee')} {p.submissionFeeAda.toLocaleString()} ₳ {t('of')} {p.requestedAmountAda.toLocaleString()} ₳ {t('requested')}
        {p.submitter ? ` · ${t('by')} ${p.submitter}` : ''}
      </div>

      {/* All tx hashes the submitter entered, each verified on-chain (latest last). */}
      <div className="mt-2 space-y-1">
        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          {t('Submission fee tx')}{p.txs.length > 1 ? `s (${p.txs.length} ${t('entered')})` : ''}:
        </div>
        {p.txs.length === 0 ? (
          <div className="text-xs text-amber-600">{t('no tx hash provided')}</div>
        ) : (
          p.txs.map((tx, i) => (
            <div key={tx.hash} className="text-xs">
              <a href={txUrl(tx.hash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
                {tx.hash} ↗
              </a>
              {i === p.txs.length - 1 ? <span className="ml-1 text-[10px] uppercase text-neutral-400">{t('latest')}</span> : null}
              <span className="ml-1 font-medium">
                {tx.paid ? (
                  <span className="text-emerald-600">{t('✓ paid')} {tx.paidAda.toLocaleString()} ₳</span>
                ) : tx.found ? (
                  <span className="text-red-600">{t('✗ only')} {tx.paidAda.toLocaleString()} ₳ {t('to the fee address')}</span>
                ) : (
                  <span className="text-amber-600">{t('⏳ not found on-chain')}</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Aggregate across all txs — a fee paid in several transactions still counts. */}
      {p.txs.length > 1 && !p.feeVerified.paid ? (
        <div
          className={`mt-2 rounded px-2 py-1 text-xs font-medium ${
            aggregateCovers
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
          }`}
        >
          {aggregateCovers
            ? `${t('✓ Paid across')} ${foundTxs.length} ${foundTxs.length === 1 ? t('transaction') : t('transactions')}: ${foundTotal.toLocaleString()} ₳ ${t('total reached the fee address — this covers the')} ${p.submissionFeeAda.toLocaleString()} ₳ ${t('fee.')}`
            : `${t('Across')} ${foundTxs.length} ${foundTxs.length === 1 ? t('confirmed tx') : t('confirmed txs')}: ${foundTotal.toLocaleString()} ₳ ${t('of')} ${p.submissionFeeAda.toLocaleString()} ₳ ${t('reached the fee address — short by')} ${(p.submissionFeeAda - foundTotal).toLocaleString()} ₳.`}
        </div>
      ) : null}

      {/* Feedback shown to the submitter (red FEEDBACK box). Required to reject, optional to approve. */}
      <textarea
        className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        rows={2}
        placeholder={t('Feedback for the submitter (required to reject, optional to approve)')}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => review('APPROVE')}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? t('Working…') : p.feeVerified.paid ? t('Approve — fee verified') : aggregateCovers ? t('Approve — fee covered (across txs)') : t('Approve anyway')}
        </button>
        <button
          disabled={busy}
          onClick={() => review('REJECT')}
          className="rounded border border-red-500 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
        >
          {t('Reject')}
        </button>
      </div>
    </li>
  );
}

/**
 * One decided fee-review row. While `canChange` (round still in SUBMISSION) the
 * board can flip the decision: an approved row gets an "Undo / change to REJECT"
 * action that opens a reason textarea; a rejected row gets "Approve now" that
 * lets through an optional note. Backend re-anchors on each APPROVE so the
 * latest on-chain proof matches the latest decision.
 */
function HistoryRow({ r, onOpen, onChanged }: { r: FeeHistoryRow; onOpen: () => void; onChanged: () => void }) {
  const t = useT();
  const { txUrl } = useExplorer();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !feedback.trim()) {
      setError(t('A reason is required when rejecting.'));
      return;
    }
    setBusy(true);
    try {
      await boardProposalsApi.reviewFee(r.id, decision, feedback.trim() || undefined);
      setOpen(false);
      setFeedback('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-md border p-3 text-sm ${
      r.decision === 'APPROVED'
        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
        : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          {r.title}
        </button>
        <span className="flex items-center gap-2 text-xs text-neutral-500">
          {r.publicId ? <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{r.publicId}</span> : null}
          {r.roundNumber != null ? <span>{t('round')} #{r.roundNumber}</span> : null}
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            r.decision === 'APPROVED'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
          }`}>
            {r.decision === 'APPROVED' ? t('✓ APPROVED') : t('✗ REJECTED')}
          </span>
          {r.canChange ? (
            <button
              type="button"
              onClick={() => { setOpen((v) => !v); setError(null); }}
              className="rounded-md border border-neutral-400 px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title={r.decision === 'APPROVED'
                ? t('Round is still in SUBMISSION — you can undo this approval (changes to REJECTED).')
                : t('Round is still in SUBMISSION — you can change this rejection to APPROVED.')}
            >
              {open ? t('Cancel change') : r.decision === 'APPROVED' ? t('↩ Undo / change to REJECT') : t('✓ Change to APPROVE')}
            </button>
          ) : (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" title={t('Round has moved past SUBMISSION — decisions are now frozen.')}>{t('locked')}</span>
          )}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {t('fee')} {r.submissionFeeAda.toLocaleString()} ₳ · {r.isCommercial ? t('commercial') : t('open-source')}
        {r.submitter ? ` · ${t('by')} ${r.submitter}` : ''}
        {r.submittedAt ? ` · ${t('submitted')} ${fmtDateTime(r.submittedAt)}` : ''}
      </div>
      {r.submissionFeeTxHash ? (
        <div className="mt-1 text-xs">
          <span className="text-neutral-500">{t('tx:')} </span>
          <a href={txUrl(r.submissionFeeTxHash)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">
            {r.submissionFeeTxHash} ↗
          </a>
        </div>
      ) : null}
      {r.feedback ? (
        <div className="mt-2 rounded border border-neutral-200 bg-white/60 p-1.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            {r.decision === 'APPROVED' ? t('Approval note') : t('Rejection reason')}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{r.feedback}</div>
        </div>
      ) : null}
      {open && r.canChange ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <div className="font-semibold text-amber-800 dark:text-amber-200">
            {r.decision === 'APPROVED' ? t('Change this approval to a REJECTION?') : t('Change this rejection to an APPROVAL?')}
          </div>
          <p className="mt-0.5 text-amber-700 dark:text-amber-300">
            {t('The proposal will move')} {r.decision === 'APPROVED' ? t('back to REJECTED (stage cleared)') : t('into FILTERING (the public stage)')}. {t('A fresh on-chain acceptance anchor is written on every approval so the latest decision is what shows on-chain. Allowed only while the round hasn\'t moved past SUBMISSION.')}
          </p>
          <textarea
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            rows={2}
            placeholder={r.decision === 'APPROVED' ? t('Reason for changing to REJECTED (required)') : t('Optional approval note')}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          {error ? <div className="mt-1 text-red-600">{error}</div> : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => flip(r.decision === 'APPROVED' ? 'REJECT' : 'APPROVE')}
              className={`rounded border px-2.5 py-1 disabled:opacity-40 ${
                r.decision === 'APPROVED'
                  ? 'border-red-500 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'
                  : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'
              }`}
            >
              {busy ? t('Working…') : r.decision === 'APPROVED' ? t('Reject now') : t('Approve now')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
