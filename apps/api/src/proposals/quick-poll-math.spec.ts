import { describe, expect, it } from 'vitest';
import { bordaScores, walkBudget } from './quick-poll-math';

describe('quick-poll-math', () => {
  describe('bordaScores — power-weighted', () => {
    it('top of N scores (N-1)×power, last scores 0', () => {
      const s = bordaScores(['a', 'b', 'c'], [{ ranking: ['a', 'b', 'c'], choice: 'a', power: 10 }]);
      expect(s.get('a')).toBe(20); // (3-1-0)=2 × 10
      expect(s.get('b')).toBe(10); // (3-1-1)=1 × 10
      expect(s.get('c')).toBe(0);
    });

    it('sums across voters and reflects disagreement', () => {
      const s = bordaScores(['a', 'b'], [
        { ranking: ['a', 'b'], choice: 'a', power: 6 }, // a:6 b:0
        { ranking: ['b', 'a'], choice: 'b', power: 9 }, // b:9 a:0
      ]);
      expect(s.get('a')).toBe(6);
      expect(s.get('b')).toBe(9); // b wins despite a getting the first ballot
    });

    it('falls back to a legacy single choice as a top rank', () => {
      const s = bordaScores(['a', 'b', 'c'], [{ ranking: [], choice: 'b', power: 4 }]);
      expect(s.get('b')).toBe(8); // ranked top of 3 → 2 × 4
      expect(s.get('a')).toBe(0);
    });
  });

  describe('walkBudget — fund top-down while it fits', () => {
    const C = (id: string, amount: number, score: number) => ({ id, amount: BigInt(amount), score });

    it('funds as many distinct-score candidates as fit, rejects the rest', () => {
      // budget 1700; priorities a(800) > b(800) > c(800): two fit (1600), third is budget-cut.
      const r = walkBudget([C('a', 800, 30), C('b', 800, 20), C('c', 800, 10)], 1700n);
      expect(r.funded).toEqual(['a', 'b']);
      expect(r.rejected).toEqual(['c']);
      expect(r.tieGroup).toEqual([]);
    });

    it('funds a whole equal-score group when it fits', () => {
      const r = walkBudget([C('a', 500, 10), C('b', 500, 10)], 1000n);
      expect(r.funded.sort()).toEqual(['a', 'b']);
      expect(r.tieGroup).toEqual([]);
    });

    it('flags a genuine tie when an equal-score group only partially fits', () => {
      // two tied at 800 each, only 1000 left → one fits → follow-up poll for the pair.
      const r = walkBudget([C('a', 800, 10), C('b', 800, 10)], 1000n);
      expect(r.funded).toEqual([]);
      expect(r.tieGroup.sort()).toEqual(['a', 'b']);
      expect(r.rejected).toEqual([]);
    });

    it('funds the clear winner, then ties the contested last slot', () => {
      // a(score 30, 600) funded → 400 left; b,c tied (score 10) at 800 each, neither fits alone? 400<800
      // → neither fits → both rejected (not a tie, since none fits).
      const cut = walkBudget([C('a', 600, 30), C('b', 800, 10), C('c', 800, 10)], 1000n);
      expect(cut.funded).toEqual(['a']);
      expect(cut.rejected.sort()).toEqual(['b', 'c']);
      expect(cut.tieGroup).toEqual([]);
      // Same but 1300 budget → 700 left after a; b,c tied at 800 each — wait 800>700 so neither fits.
      // Use 350-cost ties to show the partial-fit tie after a winner:
      const tie = walkBudget([C('a', 600, 30), C('b', 350, 10), C('c', 350, 10)], 1000n);
      expect(tie.funded).toEqual(['a']);            // 400 left
      expect(tie.tieGroup.sort()).toEqual(['b', 'c']); // 350 fits one, not both → tie
    });

    it('rejects everything when nothing fits', () => {
      const r = walkBudget([C('a', 900, 10)], 500n);
      expect(r.funded).toEqual([]);
      expect(r.rejected).toEqual(['a']);
      expect(r.tieGroup).toEqual([]);
    });

    it('respects priority — no skip-ahead to a cheaper lower-priority candidate', () => {
      // a(score 30, 900) doesn't fit 800 budget; b(score 10, 500) would fit, but priority stops at a.
      const r = walkBudget([C('a', 900, 30), C('b', 500, 10)], 800n);
      expect(r.funded).toEqual([]);
      expect(r.rejected).toEqual(['a', 'b']);
    });

    it('funds a candidate that costs exactly the remaining budget', () => {
      // Off-by-one guard: the walk uses <=, so an exact fit must be funded, not cut.
      const r = walkBudget([C('a', 800, 20), C('b', 200, 10)], 1000n);
      expect(r.funded).toEqual(['a', 'b']); // 800 then exactly 200
      expect(r.rejected).toEqual([]);
    });

    it('funds an equal-score group that costs exactly the remaining budget', () => {
      const r = walkBudget([C('a', 500, 10), C('b', 500, 10)], 1000n);
      expect(r.funded.sort()).toEqual(['a', 'b']);
      expect(r.tieGroup).toEqual([]);
    });

    it('cuts everything when the budget is already spent', () => {
      const r = walkBudget([C('a', 100, 20), C('b', 100, 10)], 0n);
      expect(r.funded).toEqual([]);
      expect(r.rejected).toEqual(['a', 'b']);
      expect(r.tieGroup).toEqual([]);
    });

    it('cuts everything when the category is overspent (negative remainder)', () => {
      const r = walkBudget([C('a', 100, 10)], -50n);
      expect(r.funded).toEqual([]);
      expect(r.rejected).toEqual(['a']);
    });

    it('is not a tie when an equal-score group fits none of its members', () => {
      // Both tied at 900 with only 500 left → nobody could be funded, so no follow-up poll.
      const r = walkBudget([C('a', 900, 10), C('b', 900, 10)], 500n);
      expect(r.tieGroup).toEqual([]);
      expect(r.rejected.sort()).toEqual(['a', 'b']);
    });

    it('handles an empty candidate list', () => {
      expect(walkBudget([], 1000n)).toEqual({ funded: [], rejected: [], tieGroup: [] });
    });
  });

  describe('borda + walk together — voting power decides the allocation', () => {
    it('funds the candidate the higher-power voters ranked first', () => {
      // Two voters disagree; b's backer carries more power, so b outranks a and takes the budget.
      const scores = bordaScores(['a', 'b'], [
        { ranking: ['a', 'b'], choice: 'a', power: 3 },
        { ranking: ['b', 'a'], choice: 'b', power: 9 },
      ]);
      const sorted = [
        { id: 'b', amount: 800n, score: scores.get('b')! },
        { id: 'a', amount: 800n, score: scores.get('a')! },
      ];
      const r = walkBudget(sorted, 1000n);
      expect(r.funded).toEqual(['b']);
      expect(r.rejected).toEqual(['a']);
    });

    it('leaves an unvoted poll as a dead-even tie the budget cannot split', () => {
      // No ballots → every score is 0 → one equal-score group; only one fits → follow-up poll.
      const scores = bordaScores(['a', 'b'], []);
      expect([...scores.values()]).toEqual([0, 0]);
      const r = walkBudget([
        { id: 'a', amount: 800n, score: 0 },
        { id: 'b', amount: 800n, score: 0 },
      ], 1000n);
      expect(r.tieGroup.sort()).toEqual(['a', 'b']);
    });
  });
});
