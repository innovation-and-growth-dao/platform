import { describe, it, expect } from 'vitest';
import { isStageDueToAutoStart } from './stage-schedule';

describe('isStageDueToAutoStart (§8 — scheduler auto-advance trigger)', () => {
  const now = new Date('2026-06-16T23:51:00Z');

  it('is due when confirmed + auto-start and the planned start has arrived (incl. exactly now)', () => {
    expect(isStageDueToAutoStart({ autoStart: true, confirmedAt: new Date('2026-06-16T20:00:00Z'), startsAt: new Date('2026-06-16T23:50:00Z') }, now)).toBe(true);
    expect(isStageDueToAutoStart({ autoStart: true, confirmedAt: new Date(), startsAt: new Date('2026-06-16T23:51:00Z') }, now)).toBe(true);
  });

  it('is NOT due before the planned start (auto-start fires at the planned time, not before)', () => {
    expect(isStageDueToAutoStart({ autoStart: true, confirmedAt: new Date(), startsAt: new Date('2026-06-16T23:52:00Z') }, now)).toBe(false);
  });

  it('is NOT due when auto-start is off or the stage is unconfirmed (board must launch manually)', () => {
    expect(isStageDueToAutoStart({ autoStart: false, confirmedAt: new Date('2026-06-16T20:00:00Z'), startsAt: new Date('2026-06-16T23:00:00Z') }, now)).toBe(false);
    expect(isStageDueToAutoStart({ autoStart: true, confirmedAt: null, startsAt: new Date('2026-06-16T23:00:00Z') }, now)).toBe(false);
  });
});
