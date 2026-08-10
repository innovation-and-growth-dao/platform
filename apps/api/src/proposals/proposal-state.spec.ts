import { describe, it, expect } from 'vitest';
import { isFeeStageReject, debateMilestoneEditError, preserveMilestoneContent } from './proposal-state';

describe('preserveMilestoneContent (§3 — no milestone content is lost on recreate)', () => {
  const existing = [
    { title: 'M1', description: 'do A', acceptanceCriteria: 'A done' },
    { title: 'M2', description: 'do B', acceptanceCriteria: 'B done' },
  ];

  it('carries forward title/description/acceptanceCriteria a partial payload left blank (same count)', () => {
    // e.g. an old budget-change form that only sent description + amount.
    const incoming = [
      { description: 'do A', amountAda: 1000 },
      { description: 'do B', amountAda: 2000 },
    ];
    const merged = preserveMilestoneContent(incoming, existing);
    expect(merged[0]).toMatchObject({ title: 'M1', acceptanceCriteria: 'A done', amountAda: 1000 });
    expect(merged[1]).toMatchObject({ title: 'M2', acceptanceCriteria: 'B done', amountAda: 2000 });
  });

  it('keeps explicitly-provided new values (only blanks inherit)', () => {
    const incoming = [
      { title: 'M1 renamed', description: 'do A', acceptanceCriteria: '', amountAda: 1000 },
      { title: '', description: 'do B v2', acceptanceCriteria: 'B done v2', amountAda: 2000 },
    ];
    const merged = preserveMilestoneContent(incoming, existing);
    expect(merged[0].title).toBe('M1 renamed');         // provided → kept
    expect(merged[0].acceptanceCriteria).toBe('A done'); // blank → inherited
    expect(merged[1].title).toBe('M2');                  // blank → inherited
    expect(merged[1].description).toBe('do B v2');        // provided → kept
  });

  it('does NOT merge on a genuine restructure (different count) — uses incoming as-is', () => {
    const incoming = [{ description: 'only one now', amountAda: 3000 }];
    expect(preserveMilestoneContent(incoming, existing)).toEqual(incoming);
  });
});

describe('isFeeStageReject (§3 — category "Not accepted" count)', () => {
  it('is true for a fee/submission-stage rejection (stage null, result not finalized)', () => {
    expect(isFeeStageReject('REJECTED', null, null)).toBe(true);
  });

  it('is false for a Debate & Vote rejection — stage null but the tally was finalized', () => {
    expect(isFeeStageReject('REJECTED', null, new Date())).toBe(false);
  });

  it('is false for a filtering rejection (stage FILTERING)', () => {
    expect(isFeeStageReject('REJECTED', 'FILTERING', null)).toBe(false);
  });

  it('is false for non-rejected proposals', () => {
    expect(isFeeStageReject('PENDING', null, null)).toBe(false);
    expect(isFeeStageReject('ACTIVE', 'FILTERING', null)).toBe(false);
    expect(isFeeStageReject('APPROVED', 'FUNDING', null)).toBe(false);
  });
});

describe('debateMilestoneEditError (§8.1 — budget locked during Debate)', () => {
  it('allows a content-only edit (same count, same amounts)', () => {
    expect(debateMilestoneEditError([1000n, 2000n], [1000n, 2000n])).toBeNull();
  });

  it('blocks adding or removing a milestone', () => {
    expect(debateMilestoneEditError([1000n, 2000n, 500n], [1000n, 2000n])).toMatch(/added or removed/);
    expect(debateMilestoneEditError([1000n], [1000n, 2000n])).toMatch(/added or removed/);
  });

  it('blocks changing any milestone amount', () => {
    expect(debateMilestoneEditError([1500n, 2000n], [1000n, 2000n])).toMatch(/budgets are locked/);
  });
});
