/**
 * Pure proposal-state classifiers shared by stats/category roll-ups. A REJECTED proposal can be
 * rejected at three different points, all worth telling apart — and two of them share `stage == null`:
 *   - fee/submission stage → never entered the round (fee unpaid / board-rejected): stage null,
 *     result NOT finalized. Counts as "Not accepted".
 *   - Debate & Vote        → lost the ballot: stage null, result finalized.
 *   - filtering            → stage 'FILTERING'.
 */
export function isFeeStageReject(
  status: string,
  stage: string | null,
  resultFinalizedAt: Date | null,
): boolean {
  return status === 'REJECTED' && stage == null && resultFinalizedAt == null;
}

/**
 * §8.1/§12 — during DEBATE the team may revise milestone CONTENT but not the budget: the number of
 * milestones and each milestone's amount must match the current plan (budget changes go through
 * "Request a budget change"). Returns an error message if the proposed amounts break that rule, or
 * null if only content changed. Amounts are compared in lovelace (exact integers).
 */
/**
 * §3 — DATA-LOSS SAFEGUARD for the milestone-recreation paths (edit + budget change). Those paths
 * delete + re-create milestones from the request, so a client that forgets to send a field would
 * blank it. When the structure is UNCHANGED (same count → milestones align by index), this carries
 * forward the EXISTING title / description / acceptance criteria for any field the request left
 * empty — so submitter content can never be silently lost by a partial payload. A genuine
 * restructure (different count → add/remove/reorder) uses the incoming values as-is.
 *
 * Pure (no Prisma) so it's unit-testable; amounts pass through untouched.
 */
export interface IncomingMilestone { title?: string | null; description?: string | null; acceptanceCriteria?: string | null; amountAda: number; }
export interface ExistingMilestoneContent { title: string | null; description: string | null; acceptanceCriteria: string | null; }

export function preserveMilestoneContent<T extends IncomingMilestone>(incoming: T[], existing: ExistingMilestoneContent[]): T[] {
  if (incoming.length !== existing.length) return incoming;
  const keep = (next: string | null | undefined, prev: string | null): string | null | undefined =>
    next != null && String(next).trim() !== '' ? next : (prev ?? next);
  return incoming.map((m, i) => ({
    ...m,
    title: keep(m.title, existing[i].title),
    description: keep(m.description, existing[i].description),
    acceptanceCriteria: keep(m.acceptanceCriteria, existing[i].acceptanceCriteria),
  }));
}

export function debateMilestoneEditError(
  proposedAmountsLovelace: bigint[],
  currentAmountsLovelace: bigint[],
): string | null {
  if (proposedAmountsLovelace.length !== currentAmountsLovelace.length) {
    return 'milestones can’t be added or removed during Debate — request a budget change';
  }
  if (proposedAmountsLovelace.some((a, i) => a !== currentAmountsLovelace[i])) {
    return 'milestone budgets are locked during Debate — request a budget change';
  }
  return null;
}
