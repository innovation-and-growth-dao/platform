import { randomInt } from 'crypto';

/**
 * §7.1/§11.1 — the ONE reviewer-draw ranking used by both filtering and milestone draws:
 * expertise match first (subcategory overlap), then equal participation (least drawn/loaded
 * in the round), then a random tiebreak.
 */
export function rankReviewerCandidates<T extends { expertiseMatch: boolean; loadInRound: number }>(cands: T[]): T[] {
  return cands
    .map((c) => ({ c, rnd: randomInt(1_000_000) }))
    .sort((a, b) =>
      Number(b.c.expertiseMatch) - Number(a.c.expertiseMatch) ||
      a.c.loadInRound - b.c.loadInRound ||
      a.rnd - b.rnd,
    )
    .map((x) => x.c);
}
