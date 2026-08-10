import { describe, it, expect } from 'vitest';
import { voteRatio, classifyBudgetOutcome } from './dv-results';

describe('voteRatio — YES share of the decisive (non-abstain) power', () => {
  it('measures YES against total minus abstentions, not the raw total', () => {
    // 60 YES, 20 NO, 20 abstain → decisive power 80 → 75%.
    const r = voteRatio(60, 20, 100, 51);
    expect(r.denom).toBe(80);
    expect(r.ratioPct).toBeCloseTo(75);
    expect(r.passedThreshold).toBe(true);
  });

  it('fails the threshold when YES is below it', () => {
    const r = voteRatio(40, 0, 100, 51); // 40% YES
    expect(r.passedThreshold).toBe(false);
  });

  it('treats a YES share exactly at the threshold as passing', () => {
    const r = voteRatio(51, 0, 100, 51);
    expect(r.ratioPct).toBeCloseTo(51);
    expect(r.passedThreshold).toBe(true);
  });

  it('has no decisive power (and so cannot pass) when everyone abstained', () => {
    const r = voteRatio(0, 100, 100, 51);
    expect(r.denom).toBe(0);
    expect(r.ratioPct).toBe(0);
    expect(r.passedThreshold).toBe(false);
  });

  it('has no decisive power when nobody voted', () => {
    const r = voteRatio(0, 0, 0, 51);
    expect(r.denom).toBe(0);
    expect(r.passedThreshold).toBe(false);
  });
});

describe('classifyBudgetOutcome — why a proposal landed where it did', () => {
  it('APPROVED → funded (the budget covered it)', () => {
    expect(classifyBudgetOutcome('APPROVED', true, 80)).toBe('funded');
  });

  it('PENDING → tie (a tie-break quick poll still decides it)', () => {
    expect(classifyBudgetOutcome('PENDING', true, 80)).toBe('tie');
  });

  it('REJECTED but passed the vote → cut (budget ran out at Tally)', () => {
    expect(classifyBudgetOutcome('REJECTED', true, 80)).toBe('cut');
  });

  it('REJECTED with no decisive voting power → nopower', () => {
    expect(classifyBudgetOutcome('REJECTED', false, 0)).toBe('nopower');
  });

  it('REJECTED below the threshold but with real votes → votes', () => {
    expect(classifyBudgetOutcome('REJECTED', false, 80)).toBe('votes');
  });

  it('separates a no-power rejection from a below-threshold one (the budget was never the factor)', () => {
    // Same REJECTED outcome, same failed threshold — distinguished only by whether any
    // decisive vote was cast.
    expect(classifyBudgetOutcome('REJECTED', false, 0)).toBe('nopower');
    expect(classifyBudgetOutcome('REJECTED', false, 50)).toBe('votes');
  });
});
