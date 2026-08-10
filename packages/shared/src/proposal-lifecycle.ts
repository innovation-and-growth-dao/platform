/** Minimal proposal shape the Debate & Vote lifecycle rules read. */
export interface DvProposalLike {
  stage?: string | null;
  status: string;
  roundId?: string | null;
  /** The viewing DRep's own D&V choice (null = not voted yet) — splits To do vs Recent. */
  myDvVote?: string | null;
}

/**
 * §7/§8 — whether a proposal belongs in the Debate & Vote panel under the given mode. The D&V panel
 * is about CASTING/CHANGING a ballot, so both To do and Recent require the round to actually be in
 * VOTE (ballots open). During DEBATE the DRep debates/comments but can't vote, so D&V shows nothing
 * there — and a proposal that just passed filtering while its round is still in FILTERING stays in
 * the Filtering panel, never double-listed here.
 *   - pending (To do): votable now (in DEBATE_VOTE, round in VOTE) AND the DRep hasn't voted yet.
 *   - recent:          votable now AND the DRep HAS voted (they can still change it while VOTE is open).
 *   - history:         FINISHED **and** the proposal actually reached D&V.
 *
 * So before voting everything sits in To do; once the DRep votes a proposal it moves to Recent;
 * when all are voted, To do is empty and Recent holds them all.
 *
 * The history gate: a proposal rejected at the FILTERING stage keeps `stage='FILTERING'` (a D&V-vote
 * rejection clears the stage to null; an approval sets it to FUNDING) — only proposals that truly
 * reached Debate & Vote appear in D&V History.
 *
 * `voteRoundIds` = rounds in VOTE (ballots open); `closedRoundIds` = rounds CLOSED.
 */
export function matchesDvMode(
  p: DvProposalLike,
  mode: 'pending' | 'recent' | 'history',
  ctx: { voteRoundIds: Set<string>; closedRoundIds: Set<string> },
): boolean {
  const terminal = ['APPROVED', 'REJECTED', 'COMPLETE', 'FAILED'].includes(p.status);
  const finished = terminal || (!!p.roundId && ctx.closedRoundIds.has(p.roundId));
  const reachedDV =
    p.stage === 'DEBATE_VOTE' || p.stage === 'FUNDING' || (terminal && p.stage !== 'FILTERING');
  if (mode === 'history') return finished && reachedDV;
  // Both modes require ballots OPEN (round in VOTE) and the proposal still active; the DRep's vote
  // then splits them: To do = not voted yet, Recent = already voted (still changeable).
  const votableNow = p.stage === 'DEBATE_VOTE' && !!p.roundId && ctx.voteRoundIds.has(p.roundId) && !finished;
  if (!votableNow) return false;
  return mode === 'recent' ? !!p.myDvVote : !p.myDvVote;
}
