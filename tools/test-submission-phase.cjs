/**
 * §3/§5 — SUBMISSION-phase rules. Verifies the round-gated proposal flow:
 *   - Round in SUBMISSION: proposals can be drafted, submitted, fee-paid,
 *     reviewed by the board, edited; reviewers can be PRE-ASSIGNED. But:
 *     filtering vote is BLOCKED, and votingTasksCount = 0 (no DRep pings).
 *   - Round moves to FILTERING: any DRAFT / unpaid PENDING / unconfirmed PENDING
 *     proposals are auto-REJECTED with a clear feeReviewFeedback reason.
 *     ACTIVE proposals advance; their pre-assigned reviewers can now vote and
 *     votingTasksCount picks them up.
 *
 * Self-cleaning (deletes its throwaway round + proposals + child rows).
 *   node tools/test-submission-phase.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC;

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { FilteringService } = require(root + '/apps/api/dist/proposals/filtering.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {

  // §2.1 — proposal creation now requires an APPROVED submitter role; grant it to every test user.
  const { prisma: __sdb } = require(root + '/packages/db/dist/index.js');
  const __approveSubmitter = async (userId) => __sdb.submitterApplication.upsert({
    where: { userId },
    update: { status: 'APPROVED' },
    create: { userId, status: 'APPROVED', displayName: 'Test Submitter', description: 'test', socialLinks: [], country: 'Testland' },
  });
  for (const au of await __sdb.appUser.findMany({ select: { id: true } })) await __approveSubmitter(au.id);
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const anchor = new AnchorService(config, prisma, cardano);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, cardano);
  const filtering = new FilteringService(prisma, anchor);

  const seats = await prisma.boardSeat.findMany();
  const boardDreps = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  if (boardDreps.length < 3) { console.error('need ≥ 3 seated board members'); process.exit(1); }
  const userIdForDrep = (drepId) => boardDreps.find((d) => d.id === drepId)?.user.id;

  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });

  console.log('\n=== Setup: round in SUBMISSION, three proposals A/B/C ===');
  // Board scope = the 5 board members for clean filtering.
  const round = await rounds.create({
    name: 'SUBMISSION-phase round',
    mandatoryWords: 0, budgetAda: 1_000_000, rewardsPoolAda: 50_000,
    categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000 }],
    eligibleDrepIds: boardDreps.map((d) => d.id),
  });
  await rounds.startStage(round.id, 'SUBMISSION');
  const r0 = await rounds.get(round.id);
  ok('round in SUBMISSION', r0.status === 'SUBMISSION');

  // Three submitters — same carol but three separate draft proposals.
  const cats = round.categories;
  const draftA = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cats[0].id, title: 'A — pays fee, board approves',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Will be confirmed.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
  });
  const draftB = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cats[0].id, title: 'B — pays fee, board approves',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Will be confirmed.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
  });
  const draftC = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cats[0].id, title: 'C — never submitted (DRAFT)',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Stays DRAFT.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
  });
  // A fourth proposal D submits the fee tx but the board never confirms it (PENDING).
  const draftD = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cats[0].id, title: 'D — fee paid, board never confirms',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Stays PENDING.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
  });

  await proposals.submit(carol.id, draftA.id, { submissionFeeTxHash: 'feehash-A' });
  await proposals.submit(carol.id, draftB.id, { submissionFeeTxHash: 'feehash-B' });
  await proposals.submit(carol.id, draftD.id, { submissionFeeTxHash: 'feehash-D' });
  // C is never submitted (stays DRAFT).

  await proposals.reviewFee(draftA.id, { decision: 'APPROVE' });
  await proposals.reviewFee(draftB.id, { decision: 'APPROVE' });
  // D stays PENDING (board didn't review).

  const det = (id) => proposals.get(id, carol.id); // carol is the submitter; needed to view DRAFT/PENDING
  let pA = await det(draftA.id), pB = await det(draftB.id), pC = await det(draftC.id), pD = await det(draftD.id);
  ok('A active+FILTERING', pA.status === 'ACTIVE' && pA.stage === 'FILTERING');
  ok('B active+FILTERING', pB.status === 'ACTIVE' && pB.stage === 'FILTERING');
  ok('C still DRAFT (never submitted)', pC.status === 'DRAFT', pC.status);
  ok('D still PENDING (fee paid, not yet confirmed)', pD.status === 'PENDING', pD.status);

  console.log('\n=== SUBMISSION phase: reviewer pre-assignment OK, vote BLOCKED, no DRep pings ===');
  // Pre-assign reviewers to A.
  await filtering.drawReviewers(draftA.id);
  const fas = await prisma.filterAssignment.findMany({ where: { proposalId: draftA.id, releasedAt: null } });
  ok('reviewers pre-assigned during SUBMISSION', fas.length > 0, `${fas.length} reviewers`);

  // Attempt to vote → must be blocked by the round.status gate.
  const aReviewerUid = userIdForDrep(fas[0].drepId);
  let voteBlocked = false;
  try { await filtering.vote(aReviewerUid, draftA.id, 'YES', 'looks ok'); }
  catch (e) { voteBlocked = /round is in SUBMISSION|not FILTERING|voting is closed/i.test(String(e.message)); }
  ok('filtering vote is blocked during SUBMISSION', voteBlocked);

  // votingTasksCount should return 0 for every assigned reviewer — no notifications.
  const tasksDuringSubmission = await Promise.all(boardDreps.map((d) => filtering.votingTasksCount(d.user.id)));
  ok('no DRep gets a vote-notification during SUBMISSION', tasksDuringSubmission.every((t) => t.filtering === 0));

  // §3 — pre-assignments are VISIBLE during SUBMISSION with a QUEUED badge (voting still
  // closed; votingTasksCount above stays 0, so no notification fires).
  const myAssignDuringSub = await filtering.myAssignments(aReviewerUid);
  ok('myAssignments shows the pre-assignment as QUEUED during SUBMISSION', myAssignDuringSub.length >= 1 && myAssignDuringSub.every((a) => a.queued === true), JSON.stringify(myAssignDuringSub.map((a) => a.queued)));

  console.log('\n=== Round moves to FILTERING: unpaid stragglers auto-rejected, vote opens ===');
  // §5.1 — at most one round in FILTERING/DV across the platform. Temporarily stash
  // any other round currently in those states so this test can transition cleanly.
  const conflictingRounds = await prisma.round.findMany({
    where: { status: { in: ['FILTERING', 'DV'] }, id: { not: round.id } },
    select: { id: true, status: true },
  });
  for (const c of conflictingRounds) {
    await prisma.round.update({ where: { id: c.id }, data: { status: 'CLOSED' } });
  }
  try {
    await rounds.startStage(round.id, 'FILTERING');
  } finally {
    for (const c of conflictingRounds) {
      await prisma.round.update({ where: { id: c.id }, data: { status: c.status } });
    }
  }
  const r1 = await rounds.get(round.id);
  ok('round in FILTERING', r1.status === 'FILTERING');

  pC = await det(draftC.id); pD = await det(draftD.id);
  ok('C auto-REJECTED (never submitted)', pC.status === 'REJECTED', pC.status);
  ok('C carries clear reason (never submitted)', /not submitted/i.test(pC.feeReviewFeedback ?? ''), pC.feeReviewFeedback);
  ok('D auto-REJECTED (fee not confirmed)', pD.status === 'REJECTED', pD.status);
  ok('D carries clear reason (fee not confirmed)', /not confirmed/i.test(pD.feeReviewFeedback ?? ''), pD.feeReviewFeedback);
  pA = await det(draftA.id); pB = await det(draftB.id);
  ok('A still ACTIVE', pA.status === 'ACTIVE');
  ok('B still ACTIVE', pB.status === 'ACTIVE');

  // Now the reviewer CAN vote.
  await filtering.vote(aReviewerUid, draftA.id, 'YES', 'looks ok');
  const rA = await filtering.result(draftA.id);
  ok('vote accepted in FILTERING', rA.yes >= 1);

  // votingTasksCount > 0 for assigned reviewers (excluding the one who just voted).
  const tasksNow = await Promise.all(boardDreps.map((d) => filtering.votingTasksCount(d.user.id)));
  const anyPending = tasksNow.some((t) => t.filtering > 0);
  ok('DReps now get vote notifications in FILTERING', anyPending);

  console.log('\n=== Cleanup ===');
  const propIds = [draftA.id, draftB.id, draftC.id, draftD.id];
  const msIds = (await prisma.milestone.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((m) => m.id);
  await prisma.vote.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestone.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.filterAssignment.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.proposalVersion.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.anchor.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.proposal.deleteMany({ where: { id: { in: propIds } } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
