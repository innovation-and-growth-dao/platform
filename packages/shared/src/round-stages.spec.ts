import { describe, expect, it } from 'vitest';
import { dvDisplayPhase, roundReachedTally, roundStageIndex } from './round-stages';

describe('round-stages', () => {
  it('orders TALLY between VOTE and FUNDING', () => {
    expect(roundStageIndex('VOTE')).toBeLessThan(roundStageIndex('TALLY'));
    expect(roundStageIndex('TALLY')).toBeLessThan(roundStageIndex('FUNDING'));
  });

  it('treats the deprecated DV alias as VOTE', () => {
    expect(roundStageIndex('DV')).toBe(roundStageIndex('VOTE'));
  });

  it('returns -1 for an unknown status', () => {
    expect(roundStageIndex('NOPE')).toBe(-1);
  });

  describe('roundReachedTally — the Tally tab appears once the Vote stage is over and stays', () => {
    it('is false before TALLY', () => {
      for (const s of ['PREPARATION', 'SUBMISSION', 'FILTERING', 'DEBATE', 'VOTE', 'DV']) {
        expect(roundReachedTally(s)).toBe(false);
      }
    });
    it('is true from TALLY onward (and remains so through CLOSED)', () => {
      for (const s of ['TALLY', 'FUNDING', 'CLOSED']) {
        expect(roundReachedTally(s)).toBe(true);
      }
    });
  });

  describe('dvDisplayPhase — Debate & Vote result state', () => {
    it('is "pending" before Debate & Vote opens', () => {
      expect(dvDisplayPhase('PREPARATION')).toBe('pending');
      expect(dvDisplayPhase('SUBMISSION')).toBe('pending');
      expect(dvDisplayPhase('FILTERING')).toBe('pending');
    });
    it('is "live" while ballots are open (Debate / Vote / legacy DV)', () => {
      expect(dvDisplayPhase('DEBATE')).toBe('live');
      expect(dvDisplayPhase('VOTE')).toBe('live');
      expect(dvDisplayPhase('DV')).toBe('live');
    });
    it('is "tally" once voting closed but tie-breaks may still run', () => {
      expect(dvDisplayPhase('TALLY')).toBe('tally');
    });
    it('is "final" once the round reaches funding', () => {
      expect(dvDisplayPhase('FUNDING')).toBe('final');
      expect(dvDisplayPhase('CLOSED')).toBe('final');
    });
  });
});
