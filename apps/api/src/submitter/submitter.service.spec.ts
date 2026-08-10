import { describe, it, expect, vi } from 'vitest';

// Avoid loading the CSL / merit heavy modules — we only test pure resolution logic.
vi.mock('../cardano/anchor.service', () => ({ AnchorService: class {} }));
vi.mock('../merit/merit.service', () => ({ MeritService: class {} }));

import { SubmitterService } from './submitter.service';

// Minimal fake Prisma exposing just what resolveLinkedMember touches.
function svcWith(drepFindFirst: ReturnType<typeof vi.fn>) {
  const prisma = { drep: { findFirst: drepFindFirst } };
  return new SubmitterService(prisma as never);
}

describe('SubmitterService — cross-wallet link resolution (§2)', () => {
  it('resolves an explicit forward link (submitter declared a DAO member) as cross-wallet', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({
      drepIdOnchain: 'drep1member', userId: 'u-member', user: { displayName: 'Alice' },
    });
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-submitter', 'drep1member');
    expect(res).toEqual({ drepIdOnchain: 'drep1member', name: 'Alice', crossWallet: true });
    // Explicit hit short-circuits — the same-wallet query is never run.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to the same-wallet member when there is no explicit link', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null) // explicit
      .mockResolvedValueOnce({ drepIdOnchain: 'drep1self', user: { displayName: 'Bob' } }); // same account
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-bob', null);
    expect(res).toEqual({ drepIdOnchain: 'drep1self', name: 'Bob', crossWallet: false });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('marks an explicit link as same-wallet when it points back at the same account', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({
      drepIdOnchain: 'drep1self', userId: 'u-same', user: { displayName: 'Cara' },
    });
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<{ crossWallet: boolean }> })
      .resolveLinkedMember('u-same', null);
    expect(res.crossWallet).toBe(false);
  });

  it('returns null when neither an explicit nor a same-wallet member exists', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const res = await (svcWith(findFirst) as never as { resolveLinkedMember: (u: string, l: string | null) => Promise<unknown> })
      .resolveLinkedMember('u-x', null);
    expect(res).toBeNull();
  });
});

describe('SubmitterService.submitterPortfolio — headline stats (§2.1)', () => {
  const ADA = 1_000_000n;
  // One proposal per status we care about: a rejected one, a funded-in-progress one
  // (1 of 2 milestones paid), a completed one, and a second rejected one.
  const rows = [
    { id: 'p1', publicId: 'R1-P1', title: 'A', status: 'REJECTED', stage: 'FILTERING',
      requestedAmountAda: 1000n * ADA, round: { number: 1, name: 'R1' }, milestones: [] },
    { id: 'p2', publicId: 'R1-P2', title: 'B', status: 'APPROVED', stage: 'FUNDING',
      requestedAmountAda: 2000n * ADA, round: { number: 1, name: 'R1' },
      milestones: [{ amountAda: 1000n * ADA, paidAt: new Date() }, { amountAda: 1000n * ADA, paidAt: null }] },
    { id: 'p3', publicId: 'R1-P3', title: 'C', status: 'COMPLETE', stage: 'FUNDING',
      requestedAmountAda: 500n * ADA, round: { number: 1, name: 'R1' },
      milestones: [{ amountAda: 500n * ADA, paidAt: new Date() }] },
    { id: 'p4', publicId: 'R1-P4', title: 'D', status: 'REJECTED', stage: null,
      requestedAmountAda: 300n * ADA, round: { number: 1, name: 'R1' }, milestones: [] },
  ];

  function portfolioSvc() {
    const prisma = {
      submitterApplication: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
      proposal: { findMany: vi.fn().mockResolvedValue(rows) },
    };
    return new SubmitterService(prisma as never);
  }

  it('counts rejected proposals separately from completed / in-progress, and sums ADA correctly', async () => {
    const { stats } = await portfolioSvc().submitterPortfolio('app-1');
    expect(stats.submitted).toBe(4);
    expect(stats.rejected).toBe(2);          // p1 + p4
    expect(stats.completed).toBe(1);         // p3
    expect(stats.inProgress).toBe(1);        // p2 (APPROVED, not yet COMPLETE)
    expect(stats.missingMilestones).toBe(1); // p2 has 1 unpaid milestone
    expect(stats.requestedAda).toBe(3800);   // 1000 + 2000 + 500 + 300
    expect(stats.approvedAda).toBe(2500);    // APPROVED + COMPLETE → 2000 + 500
    expect(stats.paidAda).toBe(1500);        // 1000 (p2) + 500 (p3)
  });
});
