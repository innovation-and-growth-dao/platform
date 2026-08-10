/**
 * §3 — proposer pledge. End-to-end at the service level:
 *   - At proposal CREATION the team optionally promises a pledge (amount ≥ round's
 *     `pledgeThresholdAda`, return-method description required). Below-min / missing
 *     return method are rejected.
 *   - After D&V approval (round → FUNDING), the team pastes the on-chain pledge tx
 *     hash → proposal appears in board "pending pledges" list with an on-chain
 *     verification result (we don't actually submit on-chain in tests, so the
 *     verification returns not-found; the board can still APPROVE / REJECT).
 *   - Board APPROVE → pledgeConfirmedAt set → milestone POAs unlocked.
 *   - Board REJECT → tx hash cleared + feedback stored; team can re-paste.
 *   - Milestone POAs are BLOCKED while the pledge is promised but not confirmed.
 *
 *   node tools/test-pledge.cjs
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
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { MilestonesService } = require(root + '/apps/api/dist/milestones/milestones.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {
  const __asJury = (ids) => ids.map((id) => ({ kind: 'DRep', id }));

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
  const dv = new DvService(prisma, config, anchor, cardano);
  const milestones = new MilestonesService(prisma, anchor, new TreasuryBucketsService(prisma, config, cardano));

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

  console.log('\n=== Setup: round with pledgeThresholdAda=500, three drafts ===');
  const round = await rounds.create({
    name: 'Pledge-flow round',
    mandatoryWords: 0, budgetAda: 1_000_000, rewardsPoolAda: 50_000,
    categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000 }],
    eligibleDrepIds: boardDreps.map((d) => d.id),
    pledgeThresholdAda: 500, // round-level minimum pledge
  });
  await rounds.startStage(round.id, 'SUBMISSION');
  const cat = round.categories[0];

  console.log('\n=== §3 Validation at createDraft ===');
  // (1) below-min pledge → reject
  let belowMin = false;
  try {
    await proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: cat.id, title: 'Bad pledge',
      payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'x', isCommercial: true, requestedAmountAda: 1000,
      milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
      pledgeAmountAda: 100, pledgeReturnMethod: 'per milestone',
    });
  } catch (e) { belowMin = /below the round's minimum/i.test(String(e.message)); }
  ok('below-min pledge rejected', belowMin);

  // (2) pledge amount > 0 without return method → reject
  let noMethod = false;
  try {
    await proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: cat.id, title: 'No method',
      payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'x', isCommercial: true, requestedAmountAda: 1000,
      milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
      pledgeAmountAda: 500,
    });
  } catch (e) { noMethod = /return-method description is required/i.test(String(e.message)); }
  ok('missing return method rejected', noMethod);

  // (3) valid pledge → ACCEPT, fields stored
  const draftA = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cat.id, title: 'A — with pledge',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'pitch', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 500 }, { title: 'Milestone 2', description: 'M2', amountAda: 500 }],
    pledgeAmountAda: 500, pledgeReturnMethod: 'half after each milestone',
  });
  ok('valid pledge accepted', draftA.pledgeAmountAda === 500 && /half after each milestone/.test(draftA.pledgeReturnMethod ?? ''));

  // (4) no pledge → always allowed
  const draftB = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: cat.id, title: 'B — no pledge',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'pitch', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 1000 }],
  });
  ok('no pledge accepted (opt-out)', draftB.pledgeAmountAda === 0 || draftB.pledgeAmountAda == null);

  console.log('\n=== Race through submit → fee approve → filtering → D&V → FUNDING ===');
  await proposals.submit(carol.id, draftA.id, { submissionFeeTxHash: 'feeA' });
  await proposals.submit(carol.id, draftB.id, { submissionFeeTxHash: 'feeB' });
  await proposals.reviewFee(draftA.id, { decision: 'APPROVE' });
  await proposals.reviewFee(draftB.id, { decision: 'APPROVE' });
  // §5.1 — stash other rounds in FILTERING/DV.
  const stashed = await prisma.round.findMany({ where: { status: { in: ['FILTERING', 'DV'] }, id: { not: round.id } }, select: { id: true, status: true } });
  for (const s of stashed) await prisma.round.update({ where: { id: s.id }, data: { status: 'CLOSED' } });
  try {
    await rounds.startStage(round.id, 'FILTERING');
    for (const id of [draftA.id, draftB.id]) {
      await filtering.drawReviewers(id);
      const fas = await prisma.filterAssignment.findMany({ where: { proposalId: id, releasedAt: null } });
      let voted = 0;
      for (const a of fas) {
        const uid = userIdForDrep(a.drepId);
        if (uid) { await filtering.vote(uid, id, 'YES', 'ok'); if (++voted >= 3) break; }
      }
    }
    await prisma.round.update({ where: { id: round.id }, data: { status: 'DV' } });
    for (const id of [draftA.id, draftB.id]) {
      await dv.openVoting(id);
      for (const d of boardDreps) await dv.optIn(d.user.id, id);
      const rationale = 'I support this proposal because '.padEnd(220, 'x');
      for (const d of boardDreps) await dv.vote(d.user.id, id, 'YES', rationale);
      await dv.finalize(id);
    }
    await prisma.round.update({ where: { id: round.id }, data: { status: 'FUNDING' } });
  } finally {
    for (const s of stashed) await prisma.round.update({ where: { id: s.id }, data: { status: s.status } });
  }
  let pA = await proposals.get(draftA.id, carol.id);
  let pB = await proposals.get(draftB.id, carol.id);
  ok('A funding+APPROVED', pA.status === 'APPROVED' && pA.stage === 'FUNDING');
  ok('B funding+APPROVED', pB.status === 'APPROVED' && pB.stage === 'FUNDING');

  console.log('\n=== §3 Pledge tx flow + board review + POA gate ===');
  // Pre-allocate milestone reviewers so the POA gate (separate from pledge) is satisfied.
  const cands = (await milestones.candidates(draftA.id));
  const jury = cands.slice(0, 3).map((c) => c.drepId);
  await milestones.assignReviewers(draftA.id, __asJury(jury), boardDreps[0].user.id);
  await milestones.assignReviewers(draftB.id, __asJury(cands.slice(0, 3).map((c) => c.drepId)), boardDreps[0].user.id);

  // (5) POA blocked while pledge pending (A only — B has no pledge).
  const msA = await prisma.milestone.findMany({ where: { proposalId: draftA.id }, orderBy: { idx: 'asc' } });
  let poaBlocked = false;
  try { await milestones.submitPoa(carol.id, msA[0].id, 'POA attempt'); }
  catch (e) { poaBlocked = /pledge payment must be confirmed/i.test(String(e.message)); }
  ok('POA blocked while pledge unpaid (A)', poaBlocked);

  // (6) B (no pledge) can post POA directly.
  const msB = await prisma.milestone.findMany({ where: { proposalId: draftB.id }, orderBy: { idx: 'asc' } });
  await milestones.submitPoa(carol.id, msB[0].id, 'B POA');
  ok('POA accepted when no pledge promised (B)', true);

  // (7) Team submits pledge tx hash.
  pA = await proposals.submitPledgeTxHash(carol.id, draftA.id, 'pledgetx-1');
  ok('pledge tx hash recorded', pA.pledgeTxHash === 'pledgetx-1' && !pA.pledgeConfirmedAt);

  // (8) Appears in board pending-pledge list with verification result.
  const pending = await proposals.listPendingPledge();
  const row = pending.find((r) => r.id === draftA.id);
  ok('proposal listed for board pledge review', !!row && row.pledgeAmountAda === 500);
  ok('verification result is present', !!row && typeof row.verification?.paid === 'boolean');

  // (9) POA still blocked — board hasn't approved yet.
  let stillBlocked = false;
  try { await milestones.submitPoa(carol.id, msA[0].id, 'POA again'); }
  catch (e) { stillBlocked = /pledge payment must be confirmed/i.test(String(e.message)); }
  ok('POA blocked after tx pasted but before board approves', stillBlocked);

  // (10) Board REJECT → tx hash cleared + feedback stored.
  pA = await proposals.reviewPledge(draftA.id, { decision: 'REJECT', feedback: 'wrong tx — please re-paste' });
  ok('REJECT clears tx hash + stores feedback',
    pA.pledgeTxHash === null && /please re-paste/i.test(pA.pledgeFeedback ?? '') && !pA.pledgeConfirmedAt);

  // (11) Team re-pastes a corrected hash.
  pA = await proposals.submitPledgeTxHash(carol.id, draftA.id, 'pledgetx-2');
  ok('team re-pastes after rejection', pA.pledgeTxHash === 'pledgetx-2');

  // (12) Board APPROVE → pledgeConfirmedAt set.
  pA = await proposals.reviewPledge(draftA.id, { decision: 'APPROVE' });
  ok('APPROVE confirms pledge', !!pA.pledgeConfirmedAt);

  // (13) POA now unlocked (A).
  await milestones.submitPoa(carol.id, msA[0].id, 'POA after pledge confirmed');
  ok('POA accepted once pledge confirmed (A)', true);

  // (14) Updating the pledge is blocked once the proposal is in FUNDING (general
  // editing closes per ownEditable — pledge fields piggyback on that lock).
  let lockedAfterFunding = false;
  try { await proposals.updateDraft(carol.id, draftA.id, { pledgeAmountAda: 700, pledgeReturnMethod: 'changed' }); }
  catch (e) { lockedAfterFunding = /editing is closed|no longer be changed/i.test(String(e.message)); }
  ok('pledge fields locked once proposal is in FUNDING', lockedAfterFunding);

  console.log('\n=== Cleanup ===');
  const propIds = [draftA.id, draftB.id];
  const msIds = (await prisma.milestone.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((m) => m.id);
  const snapIds = (await prisma.voteSnapshot.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.vote.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestone.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.filterAssignment.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapIds } } });
  await prisma.voteSnapshot.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.proposalVersion.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.anchor.deleteMany({ where: { proposalId: { in: propIds } } });
  await prisma.multisigAction.deleteMany({ where: { kind: 'PROJECT_FUNDING' } }); // any auto-queued payouts
  await prisma.proposal.deleteMany({ where: { id: { in: propIds } } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
