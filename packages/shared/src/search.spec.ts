import { describe, it, expect } from 'vitest';
import { matchesProposalSearch } from './search';

describe('matchesProposalSearch (§UI — Title / Proposer / public ID search)', () => {
  const p = { title: "Dave's great tool", proposer: 'Alice', publicId: 'R1-P12' };

  it('matches everything when the query is empty or blank', () => {
    expect(matchesProposalSearch('', p)).toBe(true);
    expect(matchesProposalSearch('   ', p)).toBe(true);
    expect(matchesProposalSearch(undefined, p)).toBe(true);
  });

  it('matches on title, proposer, and public id (case-insensitive)', () => {
    expect(matchesProposalSearch('great', p)).toBe(true);
    expect(matchesProposalSearch('alice', p)).toBe(true);
    expect(matchesProposalSearch('r1-p12', p)).toBe(true);
    expect(matchesProposalSearch('nope', p)).toBe(false);
  });

  it('requires every whitespace-separated term to match some field (so word order is free)', () => {
    expect(matchesProposalSearch('tool great', p)).toBe(true); // both terms in the title
    expect(matchesProposalSearch('great alice', p)).toBe(true); // one in title, one in proposer
    expect(matchesProposalSearch('great missing', p)).toBe(false); // "missing" matches nothing
  });

  it('searches extra fields and tolerates null/undefined values', () => {
    expect(matchesProposalSearch('payout', { title: null, extra: ['REWARD_PAYOUT to Bob'] })).toBe(true);
    expect(matchesProposalSearch('bob', { title: null, proposer: null, publicId: null, extra: ['paid Bob'] })).toBe(true);
    expect(matchesProposalSearch('x', { title: null, proposer: null, publicId: null })).toBe(false);
  });
});
