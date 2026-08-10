/**
 * §7.4/§16 — the red "progress" chip shown on a REJECTED proposal in the submitter's My-proposals
 * list. A still-revisable rejection's label contains "resubmit" — that's what the My-proposals
 * notification badge counts (`useTodoCounts`) — while a final rejection reads plainly "rejected …".
 *
 * Kept as a pure function (no Prisma) so it can be unit-tested directly.
 *   - stage 'FILTERING'                 → rejected by the filtering jury; revisable while the round
 *                                         is still in FILTERING (otherwise final).
 *   - stage null + fee fb, NOT finalized → rejected at the fee review; revisable while SUBMISSION.
 *   - otherwise (incl. a finalized loss) → rejected in Debate & Vote (final).
 *
 * `resultFinalizedAt` disambiguates the two stage-null cases: a Debate & Vote loss (incl. a
 * budget-cut) has the result finalized and keeps its admission fee note, so it must NOT be read
 * as a fee rejection just because feeReviewFeedback is set.
 */
export type ProgressChip = { stage: string; label: string; tone: 'red' };

export function rejectedProgress(
  stage: string | null,
  roundStatus: string | null,
  feeReviewFeedback: string | null | undefined,
  resultFinalizedAt?: Date | null,
): ProgressChip {
  if (stage === 'FILTERING') {
    return roundStatus === 'FILTERING'
      ? { stage: 'FILTERING', label: 'rejected at filtering — revise & resubmit', tone: 'red' }
      : { stage: 'FILTERING', label: 'rejected at filtering', tone: 'red' };
  }
  if (stage == null && feeReviewFeedback && !resultFinalizedAt) {
    return roundStatus === 'SUBMISSION'
      ? { stage: 'FEE', label: 'fee rejected — fix & resubmit', tone: 'red' }
      : { stage: 'FEE', label: 'fee rejected by the board', tone: 'red' };
  }
  return { stage: 'DV', label: 'rejected in Debate & Vote', tone: 'red' };
}
