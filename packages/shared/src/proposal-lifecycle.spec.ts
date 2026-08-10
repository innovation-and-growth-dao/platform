import { describe, it, expect } from 'vitest';
import { matchesDvMode } from './proposal-lifecycle';

describe('matchesDvMode (§7/§8 — Debate & Vote To do / Recent / History)', () => {
  // rVote: round in VOTE (ballots open). rDebate: round in DEBATE (voting not open yet).
  // rFilter: round still in FILTERING. rClosed: round CLOSED.
  const ctx = { voteRoundIds: new Set(['rVote']), closedRoundIds: new Set(['rClosed']) };

  it('To do = votable + NOT voted; Recent = votable + voted (they never overlap)', () => {
    const notVoted = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote', myDvVote: null };
    expect(matchesDvMode(notVoted, 'pending', ctx)).toBe(true);
    expect(matchesDvMode(notVoted, 'recent', ctx)).toBe(false);

    const voted = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote', myDvVote: 'YES' };
    expect(matchesDvMode(voted, 'pending', ctx)).toBe(false);
    expect(matchesDvMode(voted, 'recent', ctx)).toBe(true);
  });

  it('shows NOTHING during DEBATE — ballots are not open, so there is nothing to do or change', () => {
    const debating = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rDebate' };
    expect(matchesDvMode(debating, 'pending', ctx)).toBe(false);
    expect(matchesDvMode(debating, 'recent', ctx)).toBe(false);
  });

  it('does NOT double-list a proposal whose round is still in FILTERING (it lives in the Filtering panel)', () => {
    const passedButFilteringRound = { stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rFilter' };
    expect(matchesDvMode(passedButFilteringRound, 'recent', ctx)).toBe(false);
    expect(matchesDvMode(passedButFilteringRound, 'pending', ctx)).toBe(false);
    expect(matchesDvMode(passedButFilteringRound, 'history', ctx)).toBe(false);
  });

  it('Recent never includes finished proposals', () => {
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'REJECTED', roundId: 'rVote' }, 'recent', ctx)).toBe(false);
  });

  it('a proposal rejected at the FILTERING stage never appears in D&V History', () => {
    const filteringRejected = { stage: 'FILTERING', status: 'REJECTED', roundId: 'rFilter' };
    expect(matchesDvMode(filteringRejected, 'history', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'recent', ctx)).toBe(false);
    expect(matchesDvMode(filteringRejected, 'pending', ctx)).toBe(false);
  });

  it('History = finished proposals that actually reached D&V', () => {
    expect(matchesDvMode({ stage: null, status: 'REJECTED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'FUNDING', status: 'APPROVED', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'FUNDING', status: 'COMPLETE', roundId: 'rVote' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rClosed' }, 'history', ctx)).toBe(true);
    expect(matchesDvMode({ stage: 'DEBATE_VOTE', status: 'ACTIVE', roundId: 'rVote' }, 'history', ctx)).toBe(false);
  });
});
