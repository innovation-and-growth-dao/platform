import { describe, it, expect, vi } from 'vitest';

// Avoid loading the heavy on-chain / merit modules — we only test the To do / Recent / History
// partition logic in myAssignments, which touches nothing but Prisma.
vi.mock('@drep-dao/cardano', () => ({ GovSubject: {}, VotingStyle: {} }));
vi.mock('../cardano/anchor.service', () => ({ AnchorService: class {} }));
vi.mock('../merit/merit.service', () => ({ MeritService: class {} }));

import { FilteringService } from './filtering.service';

// One assignment the reviewer voted on (pA) and one they haven't (pB) — both in an active
// filtering-stage round. The DB-level `where` is mode-specific but our fake returns the full set;
// the To do / Recent split we assert is the post-query `myVote` filter that this test pins down.
function svc() {
  const prop = (id: string) => ({
    id, title: id, publicId: id, status: 'ACTIVE', stage: 'FILTERING',
    round: { status: 'FILTERING' }, submitterUser: { displayName: 'X' }, submitterDrep: null,
  });
  const prisma = {
    drep: { findUnique: vi.fn().mockResolvedValue({ id: 'd1' }) },
    filterAssignment: {
      findMany: vi.fn().mockResolvedValue([
        { proposalId: 'pA', assignedAt: new Date(), proposal: prop('pA') },
        { proposalId: 'pB', assignedAt: new Date(), proposal: prop('pB') },
      ]),
    },
    vote: { findMany: vi.fn().mockResolvedValue([{ proposalId: 'pA', choice: 'YES' }]) },
  };
  return new FilteringService(prisma as never, {} as never);
}

describe('FilteringService.myAssignments — To do / Recent partition (§7)', () => {
  it('To do (pending) holds only the NOT-yet-voted assignment', async () => {
    const rows = await svc().myAssignments('u1', 'pending');
    expect(rows.map((r) => r.proposalId)).toEqual(['pB']);
    expect(rows.every((r) => r.myVote == null)).toBe(true);
  });

  it('Recent holds only the VOTED assignment — never a "not voted yet" one', async () => {
    const rows = await svc().myAssignments('u1', 'recent');
    expect(rows.map((r) => r.proposalId)).toEqual(['pA']);
    expect(rows.every((r) => r.myVote != null)).toBe(true);
  });

  it('To do and Recent are disjoint and together cover every active assignment', async () => {
    const todo = await svc().myAssignments('u1', 'pending');
    const recent = await svc().myAssignments('u1', 'recent');
    const ids = [...todo, ...recent].map((r) => r.proposalId).sort();
    expect(ids).toEqual(['pA', 'pB']);
    expect(todo.some((t) => recent.find((r) => r.proposalId === t.proposalId))).toBe(false);
  });
});
