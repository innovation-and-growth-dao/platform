import { describe, expect, it } from 'vitest';
import { PLATFORM_CONFIG_DEFAULTS, PLATFORM_CONFIG_META, type PlatformConfigKey } from './config';

/**
 * §20 — these guard the board-facing parameter screen. It is generated from
 * PLATFORM_CONFIG_DEFAULTS, and each row shows PLATFORM_CONFIG_META as its explanation, so a
 * parameter added without a description would silently ship as an unlabelled toggle.
 */
describe('platform parameters', () => {
  const keys = Object.keys(PLATFORM_CONFIG_DEFAULTS) as PlatformConfigKey[];

  it('describes every parameter for the board', () => {
    const undocumented = keys.filter((k) => !PLATFORM_CONFIG_META[k]?.trim());
    expect(undocumented).toEqual([]);
  });

  it('gives each description enough substance to be useful', () => {
    // A bare word ("Open membership.") tells the board nothing about what flipping it does.
    const tooShort = keys.filter((k) => PLATFORM_CONFIG_META[k].trim().length < 25);
    expect(tooShort).toEqual([]);
  });

  it('has no description for a parameter that no longer exists', () => {
    const orphans = Object.keys(PLATFORM_CONFIG_META).filter((k) => !(k in PLATFORM_CONFIG_DEFAULTS));
    expect(orphans).toEqual([]);
  });

  it('only uses types the board UI + updateParam can round-trip', () => {
    // governance.updateParam coerces against the default's type; anything else would be stringified.
    const bad = keys.filter((k) => !['boolean', 'number', 'string'].includes(typeof PLATFORM_CONFIG_DEFAULTS[k]));
    expect(bad).toEqual([]);
  });

  describe('§14 admission policy', () => {
    it('ships with membership OPEN, so DReps can join and vote without a board', () => {
      // The whole point: DReps join freely and can pass the proposal that installs the board.
      expect(PLATFORM_CONFIG_DEFAULTS.DREP_OPEN_ADMISSION).toBe(true);
    });

    it('explains both states and the no-board exception', () => {
      const d = PLATFORM_CONFIG_META.DREP_OPEN_ADMISSION.toLowerCase();
      expect(d).toContain('enabled');
      expect(d).toContain('disabled');
      expect(d).toContain('no board');
    });
  });
});
