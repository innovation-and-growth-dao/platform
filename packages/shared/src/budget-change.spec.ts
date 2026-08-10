import { describe, it, expect } from 'vitest';
import { roundFlagOn, budgetChangeSettlement, ROUND_SETTING_DEFAULTS } from './config';

describe('roundFlagOn (§12 — YES/NO round settings)', () => {
  it('uses the stored 1/0 value when present', () => {
    expect(roundFlagOn(1, 'requireFeeTopUp')).toBe(true);
    expect(roundFlagOn(0, 'requireFeeTopUp')).toBe(false);
  });
  it('falls back to the default when null/undefined', () => {
    expect(roundFlagOn(null, 'ignoreBudgetChange')).toBe(true);   // default YES
    expect(roundFlagOn(undefined, 'requireFeeTopUp')).toBe(false); // default NO
    expect(roundFlagOn(undefined, 'requireFeeReturn')).toBe(false); // default NO
  });
  it('the documented defaults are ignore=YES, top-up=NO, return=NO', () => {
    expect(ROUND_SETTING_DEFAULTS.ignoreBudgetChange).toBe(1);
    expect(ROUND_SETTING_DEFAULTS.requireFeeTopUp).toBe(0);
    expect(ROUND_SETTING_DEFAULTS.requireFeeReturn).toBe(0);
  });
});

describe('budgetChangeSettlement (§12 — which fee settlement on a budget change)', () => {
  it('increase → TOPUP, created only when requireTopUp is YES', () => {
    expect(budgetChangeSettlement(2, { requireTopUp: true, requireReturn: false })).toEqual({ kind: 'TOPUP', create: true });
    expect(budgetChangeSettlement(2, { requireTopUp: false, requireReturn: true })).toEqual({ kind: 'TOPUP', create: false });
  });
  it('decrease → REFUND, created only when requireReturn is YES', () => {
    expect(budgetChangeSettlement(-2, { requireTopUp: false, requireReturn: true })).toEqual({ kind: 'REFUND', create: true });
    expect(budgetChangeSettlement(-2, { requireTopUp: true, requireReturn: false })).toEqual({ kind: 'REFUND', create: false });
  });
  it('no fee change → no settlement', () => {
    expect(budgetChangeSettlement(0, { requireTopUp: true, requireReturn: true })).toBeNull();
  });
});
