/**
 * §9.2 — pure maths for ranked tie-break quick polls. Kept free of Prisma so the
 * allocation logic (which decides real funding) is unit-testable in isolation.
 */

export interface RankedVote {
  ranking: string[];      // candidate ids, highest priority first
  choice: string | null;  // legacy single pick (back-compat); ranks that one top
  power: number;          // the voter's balanced voting power
}

/**
 * Power-weighted Borda: a candidate ranked i-th of N (0 = top) scores (N-1-i) × the
 * voter's power, summed over all voters. A legacy single `choice` vote ranks that one top.
 */
export function bordaScores(candidates: string[], votes: RankedVote[]): Map<string, number> {
  const n = candidates.length;
  const score = new Map<string, number>(candidates.map((c) => [c, 0]));
  for (const v of votes) {
    const order = v.ranking && v.ranking.length ? v.ranking : v.choice ? [v.choice] : [];
    order.forEach((cand, i) => {
      if (score.has(cand)) score.set(cand, (score.get(cand) ?? 0) + v.power * (n - 1 - i));
    });
  }
  return score;
}

export interface BudgetCandidate {
  id: string;
  amount: bigint; // requested budget (lovelace)
  score: number;  // aggregate priority score
}

export interface BudgetWalk {
  funded: string[];    // candidates that fit, in priority order
  rejected: string[];  // budget-cut (didn't fit, or below the cliff)
  tieGroup: string[];  // equal-score candidates that partially fit — need a follow-up poll
}

/**
 * Walk the remaining budget over candidates pre-sorted by score desc (then earliest
 * submission). Equal-score candidates form a group: the whole group is funded if it fits;
 * if only some fit it's a genuine tie (→ follow-up poll); a single candidate that doesn't
 * fit is budget-cut. Once the budget is exhausted everything below is budget-cut — priority
 * is respected, there is no cheaper-candidate skip-ahead.
 */
export function walkBudget(sorted: BudgetCandidate[], remaining: bigint): BudgetWalk {
  const funded: string[] = [];
  const rejected: string[] = [];
  let tieGroup: string[] = [];
  const EPS = 1e-9;
  let i = 0;
  let cliff = false;
  let rem = remaining;
  while (i < sorted.length) {
    const group = [sorted[i]];
    while (i + group.length < sorted.length && Math.abs(sorted[i + group.length].score - sorted[i].score) < EPS) {
      group.push(sorted[i + group.length]);
    }
    const groupCost = group.reduce((s, g) => s + g.amount, 0n);
    if (!cliff && groupCost <= rem) {
      for (const g of group) funded.push(g.id);
      rem -= groupCost;
    } else if (!cliff && group.length > 1 && group.some((g) => g.amount <= rem)) {
      tieGroup = group.map((g) => g.id);
      cliff = true;
    } else {
      for (const g of group) rejected.push(g.id);
      cliff = true;
    }
    i += group.length;
  }
  return { funded, rejected, tieGroup };
}
