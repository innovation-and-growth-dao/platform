/**
 * §9 — pure maths for a funding proposal's Debate & Vote result. Kept free of Prisma so the
 * "did it pass, and if not why" logic (which the Voting Result tab reports) is unit-testable
 * in isolation.
 */

export type DvOutcome = 'APPROVED' | 'PENDING' | 'REJECTED';
export type BudgetOutcome = 'funded' | 'cut' | 'tie' | 'votes' | 'nopower';

/**
 * YES share of the *decisive* power (total minus abstentions), and whether it cleared the
 * approval threshold. Abstentions never count for or against — they only shrink the
 * denominator. With no decisive power at all the ratio is 0 and the threshold can't be met.
 */
export function voteRatio(
  yesPower: number,
  abstainPower: number,
  totalPower: number,
  thresholdPct: number,
): { denom: number; ratioPct: number; passedThreshold: boolean } {
  const denom = Math.max(0, totalPower - abstainPower);
  const ratioPct = denom > 0 ? (yesPower / denom) * 100 : 0;
  const passedThreshold = denom > 0 && ratioPct >= thresholdPct;
  return { denom, ratioPct, passedThreshold };
}

/**
 * Why a proposal landed where it did — the budget only decides the fate of proposals that
 * actually passed the vote:
 *  funded  — APPROVED: won funding within the category budget.
 *  tie     — PENDING: tied at the budget cliff, a tie-break quick poll decides.
 *  cut     — REJECTED but passed the vote → the category budget ran out (budget-cut at Tally).
 *  nopower — REJECTED with no decisive voting power (no YES/NO vote cast, or all abstained),
 *            so the threshold could never be met.
 *  votes   — REJECTED on the vote → had decisive votes but YES power fell below the threshold.
 */
export function classifyBudgetOutcome(outcome: DvOutcome, passedThreshold: boolean, denom: number): BudgetOutcome {
  if (outcome === 'APPROVED') return 'funded';
  if (outcome === 'PENDING') return 'tie';
  if (passedThreshold) return 'cut';
  if (denom <= 0) return 'nopower';
  return 'votes';
}
