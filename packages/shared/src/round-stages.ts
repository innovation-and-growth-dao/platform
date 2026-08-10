import { RoundStatus } from './enums';

/**
 * §5/§9 — the canonical round-stage chronology, in execution order. The deprecated
 * `DV` alias is folded onto `VOTE`. `TALLY` sits between VOTE and FUNDING: voting is
 * closed and the result is published, but only tie-break quick polls run and the
 * funding mechanics (pledge clock, milestone reviewers, revenue sharing) are not yet
 * active — those switch on when the round reaches FUNDING.
 */
export const ROUND_STAGE_ORDER: string[] = [
  RoundStatus.PREPARATION,
  RoundStatus.SUBMISSION,
  RoundStatus.FILTERING,
  RoundStatus.DEBATE,
  RoundStatus.VOTE,
  RoundStatus.TALLY,
  RoundStatus.FUNDING,
  RoundStatus.CLOSED,
];

/** Position of a round status in the chronology (DV treated as VOTE); -1 if unknown. */
export function roundStageIndex(status: string): number {
  return ROUND_STAGE_ORDER.indexOf(status === RoundStatus.DV ? RoundStatus.VOTE : status);
}

/** True once the round has reached TALLY (i.e. the Vote stage is over) — drives the Tally tab,
 *  which appears then and remains forever after. */
export function roundReachedTally(status: string): boolean {
  return roundStageIndex(status) >= roundStageIndex(RoundStatus.TALLY);
}

/**
 * §9 — the state of the "Debate & Vote" results for a round, used to label the
 * category breakdown:
 *  - 'pending' — the round hasn't reached Debate & Vote yet (nothing to show).
 *  - 'live'    — ballots are open (DEBATE / VOTE); proposals are still "in voting".
 *  - 'tally'   — voting closed, results published, but tie-break quick polls may still
 *                run: approved → APPROVED, still-in-poll → TO VOTING, rejected → REJECTED.
 *  - 'final'   — round advanced to FUNDING/CLOSED: APPROVED + REJECTED only, none TO VOTING.
 */
export type DvPhase = 'pending' | 'live' | 'tally' | 'final';
export function dvDisplayPhase(status: string): DvPhase {
  const idx = roundStageIndex(status);
  if (idx < roundStageIndex(RoundStatus.DEBATE)) return 'pending';
  if (idx <= roundStageIndex(RoundStatus.VOTE)) return 'live';
  if (idx === roundStageIndex(RoundStatus.TALLY)) return 'tally';
  return 'final';
}
