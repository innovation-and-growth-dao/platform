/**
 * §7/§8/§11/§16/§20 — full proposal lifecycle at the service level (no tADA spent;
 * ANCHOR_MNEMONIC is removed so anchors are recorded but not submitted):
 *   submit (commercial fee) → board confirm-fee → edit (versioned) → filtering
 *   (3 YES, anchored) → D&V (balanced, anchored) → milestones (POA + 2 YES each,
 *   anchored) → COMPLETE, plus comments. Cleans up everything at the end.
 *
 *   node tools/test-proposal-flow.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // record anchors, do not submit on-chain

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
const { buildResultMetadata, GOVERNANCE_METADATA_LABEL } = require(root + '/packages/cardano/dist/index.js');
const { CommentsService } = require(root + '/apps/api/dist/comments/comments.service.js');
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
  const comments = new CommentsService(prisma);

  // Reviewers/voters = the seated board (admitted DReps); submitter = a non-board holder.
  const seats = await prisma.boardSeat.findMany();
  const boardDreps = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  ok('have ≥3 board reviewers', boardDreps.length >= 3, `${boardDreps.length} board dreps`);
  const userIdForDrep = (drepId) => boardDreps.find((d) => d.id === drepId)?.user.id;

  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });

  console.log('\n=== Round + submission (commercial fee 3%) ===');
  // Scope eligibility to the board so the test is isolated from other admitted DReps.
  const round = await rounds.create({ name: 'Flow round', mandatoryWords: 0, ignoreBudgetChange: 0, budgetAda: 1_000_000, rewardsPoolAda: 50_000, categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000 }], eligibleDrepIds: boardDreps.map((d) => d.id) });
  await rounds.startStage(round.id, 'SUBMISSION');
  const draft = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: round.categories[0].id, title: 'Build a tool',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Original pitch.', isCommercial: true, requestedAmountAda: 1000,
    // §3 — every mandatory field must be non-empty at submit time (default
    // mandatoryWords = 1). Each milestone needs a title + acceptanceCriteria.
    ecosystemImpactMd: 'Benefits developers',
    successMetricsMd: 'Adoption metrics',
    costBreakdownMd: 'Engineering costs',
    teamInfoMd: 'Small team',
    milestones: [
      { title: 'Milestone one', description: 'M1', acceptanceCriteria: 'Done', amountAda: 600 },
      { title: 'Milestone two', description: 'M2', acceptanceCriteria: 'Done', amountAda: 400 },
    ],
    payoutAddress: 'addr_test1qpd_carol_payout',
  });
  const submitted = await proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feehash123' });
  ok('commercial fee = 3% of requested', submitted.submissionFeeAda === 30, `${submitted.submissionFeeAda} ₳`);
  ok('status PENDING after submit', submitted.status === 'PENDING');
  ok('appears in board pending-fee list', (await proposals.listPendingFee()).some((x) => x.id === draft.id));
  await proposals.reviewFee(draft.id, { decision: 'APPROVE' });
  let det = await proposals.get(draft.id);
  ok('fee confirmed → ACTIVE + FILTERING', det.status === 'ACTIVE' && det.stage === 'FILTERING');

  console.log('\n=== Edit during filtering → versioned + diff (full snapshot) ===');
  // Edit multiple fields at once. The version snapshot must capture every editable
  // field (pitch, ecosystem impact, success metrics, payout) so the diff view can
  // show the whole change set — not just the pitch.
  await proposals.updateDraft(carol.id, draft.id, {
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Updated pitch with more detail.',
    ecosystemImpactMd: 'Now serves three additional segments.',
    successMetricsMd: '5,000 monthly active users in 6 months.',
    payoutAddress: 'addr_test1qpd_v2',
  });
  const versions = await proposals.versions(draft.id);
  ok('prior content snapshotted', versions.length === 2 && versions[0].contentMd === 'Original pitch.' && versions[1].current === true);
  const v0 = versions[0], v1 = versions[1];
  ok('v0 snapshot present + carries pitch', !!v0.snapshot && v0.snapshot.contentMd === 'Original pitch.');
  ok('v1 snapshot reflects updated pitch', !!v1.snapshot && v1.snapshot.contentMd === 'Updated pitch with more detail.');
  ok(
    'snapshot diff catches ecosystem impact change',
    (v0.snapshot.ecosystemImpactMd ?? '') !== (v1.snapshot.ecosystemImpactMd ?? '') &&
      v1.snapshot.ecosystemImpactMd === 'Now serves three additional segments.',
  );
  ok(
    'snapshot diff catches success-metrics change',
    v1.snapshot.successMetricsMd === '5,000 monthly active users in 6 months.',
  );
  ok('snapshot diff catches payout change', v1.snapshot.payoutAddress === 'addr_test1qpd_v2');
  ok(
    'snapshot milestone array is captured',
    Array.isArray(v0.snapshot.milestones) && v0.snapshot.milestones.length === det.milestones.length,
  );

  console.log('\n=== Budget change: PENDING → board APPROVES → snapshot + votes reset ===');
  // §12 — a budget change is a request that the board approves or rejects.
  // The proposal + filtering votes are unchanged until APPROVE.
  const preBudgetMilestones = det.milestones.map((m) => ({ description: m.description, amountAda: m.amountAda }));
  // Bump M1 by 200 ₳ so the requested amount actually changes (backend rejects "unchanged").
  const newMilestones = preBudgetMilestones.map((m, i) => (i === 0 ? { ...m, amountAda: m.amountAda + 200 } : m));
  const sum = newMilestones.reduce((a, m) => a + m.amountAda, 0);
  const req = await proposals.requestBudgetChange(carol.id, draft.id, { requestedAmountAda: sum, milestones: newMilestones, reason: 'M1 scope expanded after kickoff call' });
  ok('budget change created a PENDING request', req.status === 'PENDING' && !!req.id);
  const oldAmount = det.requestedAmountAda;
  const detMid = await proposals.get(draft.id);
  ok('proposal still shows the old amount while pending', detMid.requestedAmountAda === oldAmount && !!detMid.pendingBudgetChange);
  const versionsMid = await proposals.versions(draft.id);
  ok('no new version row written for a pending request yet', versionsMid.length === versions.length);

  // Board approves → proposal mutates, version is snapshotted, fee delta queued.
  await proposals.approveBudgetChange(boardDreps[0].user.id, req.id);
  const versions2 = await proposals.versions(draft.id);
  ok('approval created a new version entry', versions2.length === versions.length + 1);
  const beforeBudget = versions2[versions2.length - 2];
  const afterBudget = versions2[versions2.length - 1];
  ok('pre-approval snapshot kept old milestone shape', JSON.stringify(beforeBudget.snapshot.milestones.map((m) => m.amountAda)) === JSON.stringify(preBudgetMilestones.map((m) => m.amountAda)));
  ok('current snapshot reflects new milestone amounts', JSON.stringify(afterBudget.snapshot.milestones.map((m) => m.amountAda)) === JSON.stringify(newMilestones.map((m) => m.amountAda)));
  const detAfter = await proposals.get(draft.id);
  ok('pending-request cleared after approval', !detAfter.pendingBudgetChange);
  ok('proposal now carries the approved amount', detAfter.requestedAmountAda === sum);

  console.log('\n=== §7 Filtering: draw + 3 YES → anchored decision ===');
  // The proposal.stage transitions (FILTERING → DEBATE_VOTE → FUNDING) come from the
  // proposal services. §5.1 forbids two rounds in FILTERING/DV at once, and the demo
  // data holds that slot — so we push round.status directly via Prisma. r65 also
  // requires round.status === FILTERING for filtering votes to be accepted.
  await prisma.round.update({ where: { id: round.id }, data: { status: 'FILTERING' } });
  await filtering.drawReviewers(draft.id);
  const assigns = await prisma.filterAssignment.findMany({ where: { proposalId: draft.id, releasedAt: null } });
  let voted = 0;
  for (const a of assigns) {
    const uid = userIdForDrep(a.drepId);
    if (uid) { await filtering.vote(uid, draft.id, 'YES', 'clear and well-scoped'); if (++voted >= 3) break; }
  }
  det = await proposals.get(draft.id);
  ok('3 YES → advanced to DEBATE_VOTE', det.stage === 'DEBATE_VOTE');
  const fAnchor = await prisma.anchor.findFirst({ where: { proposalId: draft.id, kind: 'filtering' } });
  ok('filtering decision anchored (label 80808081)', !!fAnchor && fAnchor.metadataLabel === 80808081);
  // The on-chain metadata for a proposal decision must carry the structured proposal id (e.g. R8-P1).
  const pre = fAnchor?.preimage ?? {};
  const fMeta = buildResultMetadata({
    subject: pre.subject, style: pre.style, applicant: pre.ref, proposalId: pre.publicId,
    votes: [], yes: 0, no: 0, threshold: 0, outcome: 'ACCEPTED',
  })[GOVERNANCE_METADATA_LABEL];
  ok('filtering on-chain metadata carries the proposal id', fMeta.proposalId === det.publicId && !!det.publicId, `${fMeta.proposalId} vs ${det.publicId}`);
  const fres = await filtering.result(draft.id);
  ok('filtering exposes public rationale', fres.votes.some((v) => v.rationale === 'clear and well-scoped'));

  console.log('\n=== §8 Debate & Vote: balanced, anchored (board opt-in §8.2) ===');
  // Round must be in DV before openVoting / cast — the round-status gate
  // prevents D&V voting from happening while the round is still in FILTERING.
  await prisma.round.update({ where: { id: round.id }, data: { status: 'DV' } });
  // §8.2 — board members only vote on funding proposals after explicitly opting in.
  await dv.openVoting(draft.id);
  // §8.2 — board members are voters by default (no per-proposal opt-in). The
  // per-board-member opt-out lives in their profile and zeroes their snapshot
  // weight at tally time without mutating the snapshot.
  ok(
    'board included in D&V by default (no per-proposal opt-in)',
    (await dv.result(draft.id)).eligible === boardDreps.length,
    `eligible=${(await dv.result(draft.id)).eligible} of ${boardDreps.length}`,
  );
  // Profile toggle on a single board member drops them from the live tally
  // without re-running openVoting.
  const optOutMember = boardDreps[0];
  await prisma.drep.update({ where: { id: optOutMember.id }, data: { votesOnFundingProposals: false } });
  ok(
    'profile opt-out zeroes the member at tally time',
    (await dv.result(draft.id)).eligible === boardDreps.length - 1,
  );
  // Toggle back on for the rest of the test.
  await prisma.drep.update({ where: { id: optOutMember.id }, data: { votesOnFundingProposals: true } });
  ok(
    'profile opt-back-in restores their weight',
    (await dv.result(draft.id)).eligible === boardDreps.length,
  );
  const rationale = 'I support this proposal because '.padEnd(220, 'x');
  for (const d of boardDreps) await dv.vote(d.user.id, draft.id, 'YES', rationale);
  const fin = await dv.finalize(draft.id);
  ok('D&V APPROVED → FUNDING', fin.status === 'APPROVED' && fin.stage === 'FUNDING');
  const dAnchor = await prisma.anchor.findFirst({ where: { proposalId: draft.id, kind: 'dv' } });
  ok('D&V result anchored', !!dAnchor);
  ok('D&V exposes rationale + weight', (fin.votes ?? []).some((v) => v.rationale && (v.weight ?? 0) > 0));
  // §5 — the on-chain JSON shows per-DRep power + total power.
  const dvVotes = (dAnchor?.preimage?.votes) ?? [];
  ok('anchor preimage carries per-vote power + total', dvVotes.some((v) => (v.weight ?? 0) > 0) && (fin.totalPower ?? 0) > 0);

  console.log('\n=== §11 Milestones: board allocates reviewers + POA + 2 YES each → COMPLETE ===');
  // Push the round to FUNDING via Prisma (bypasses §5.1 single-Filtering rule which
  // would block round.startStage when the demo round holds the slot).
  await prisma.round.update({ where: { id: round.id }, data: { status: 'FUNDING' } });
  // §11.1 — board picks the milestone reviewers (the default is 3, hardcoded in the
  // service helper). Pick the first three eligible board DReps (excludes the submitter,
  // who is Carol — not a DRep — so any 3 of 5 board are valid).
  const milestoneJury = boardDreps.slice(0, 3).map((d) => d.id);
  await milestones.assignReviewers(draft.id, __asJury(milestoneJury), boardDreps[0].user.id);
  for (const m of await milestones.forProposal(draft.id)) {
    await milestones.submitPoa(carol.id, m.id, `Delivered milestone ${m.idx + 1}`);
    const massign = await prisma.milestoneAssignment.findMany({ where: { milestoneId: m.id, releasedAt: null } });
    let mv = 0;
    for (const a of massign) {
      const uid = userIdForDrep(a.reviewerDrepId);
      if (uid) { await milestones.vote(uid, m.id, 'YES', 'looks delivered'); if (++mv >= 2) break; }
    }
  }
  det = await proposals.get(draft.id);
  ok('all milestones approved → proposal COMPLETE', det.status === 'COMPLETE');
  ok('milestone decisions anchored', (await prisma.anchor.count({ where: { proposalId: draft.id, kind: 'milestone' } })) >= 2);

  console.log('\n=== §20 Comments ===');
  await comments.create(carol.id, draft.id, 'Great proposal!');
  const clist = await comments.list(draft.id);
  ok('comment listed', clist.length === 1 && clist[0].contentMd === 'Great proposal!');

  console.log('\n=== Cleanup ===');
  const msIds = (await prisma.milestone.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((m) => m.id);
  const snapIds = (await prisma.voteSnapshot.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((s) => s.id);
  await prisma.comment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.vote.deleteMany({ where: { proposalId: draft.id } });
  await prisma.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestone.deleteMany({ where: { proposalId: draft.id } });
  await prisma.filterAssignment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapIds } } });
  await prisma.voteSnapshot.deleteMany({ where: { proposalId: draft.id } });
  await prisma.proposalVersion.deleteMany({ where: { proposalId: draft.id } });
  await prisma.feeAdjustment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.budgetChangeRequest.deleteMany({ where: { proposalId: draft.id } });
  await prisma.anchor.deleteMany({ where: { proposalId: draft.id } });
  // Auto-prepared PROJECT_FUNDING multisig actions (one per APPROVED milestone) — no
  // FK to proposal so we match by the unique description tag the service writes.
  await prisma.multisigAction.deleteMany({ where: { kind: 'PROJECT_FUNDING', description: { contains: `${det.publicId ?? draft.id}` } } });
  await prisma.proposal.delete({ where: { id: draft.id } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });
  ok('cleaned up', (await prisma.proposal.findUnique({ where: { id: draft.id } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
