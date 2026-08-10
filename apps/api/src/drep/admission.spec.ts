import { describe, expect, it } from 'vitest';
import { isAutoAdmitted } from './admission';

describe('isAutoAdmitted (§14 — open membership vs board approval)', () => {
  it('admits immediately while membership is open, even once a board is seated', () => {
    expect(isAutoAdmitted(true, 5)).toBe(true);
  });

  it('admits immediately when no board is seated, even with open membership off', () => {
    // Nobody could run the admission vote — and DReps must be able to join and vote in the
    // proposal that elects the first board.
    expect(isAutoAdmitted(false, 0)).toBe(true);
  });

  it('defers to the board once one is seated and open membership is switched off', () => {
    expect(isAutoAdmitted(false, 5)).toBe(false);
    expect(isAutoAdmitted(false, 1)).toBe(false);
  });

  it('is open by default (open membership on, no board yet)', () => {
    expect(isAutoAdmitted(true, 0)).toBe(true);
  });
});
