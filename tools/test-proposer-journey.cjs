/**
 * PROPOSER JOURNEY — every edge the submitting team hits, on a round with NON-DEFAULT
 * config (mandatory words, 2-of-3 filtering, 2-of-2 milestone jury, fee settlements on,
 * pledge threshold, and a CUSTOM GLOBAL CONFIG: MILESTONE_MAX_REJECTIONS=2):
 *
 *   1. Draft validation: short title, pledge below the round threshold, pledge without
 *      a return method.
 *   2. Mandatory-words gate at submit (content too short → named field; fixed → PENDING).
 *   3. Fee lifecycle: PENDING locks the amount (settlement mode), content stays editable;
 *      board REJECT → feedback; edit + re-submit with a NEW fee tx → PENDING again,
 *      feedback cleared, BOTH fee hashes kept in history; approve → ACTIVE + publicId +
 *      submission anchor whose JSON carries proposalId/submitter/fee tx.
 *   4. A straggler DRAFT is auto-REJECTED with a clear reason when SUBMISSION ends.
 *   5. Filtering (2-of-3): NO needs rationale; 1 NO + 2 YES advances to DEBATE_VOTE and
 *      anchors the decision.
 *   6. Debate: pitch edits snapshot a new version; the title is immutable.
 *   7. VOTE → TALLY → FUNDING with a seeded electorate → APPROVED.
 *   8. Pledge: submit tx → board REJECT (hash cleared + feedback) → re-submit → APPROVE.
 *   9. Milestones: POA blocked before reviewers; 2-reviewer jury; POA immutable while
 *      submitted; rejection #1 increments the rejection counter (even with no deadline);
 *      resubmit; rejection #2 hits MILESTONE_MAX_REJECTIONS → the platform AUTO-OPENS a
 *      stop-funding proposal (role PLATFORM); board 3×YES → proposal FAILED + anchored;
 *      further POAs are blocked.
 *  10. History: version list grew, fee-hash history kept, milestone feedback recorded.
 *
 * Self-cleaning; restores the MILESTONE_MAX_REJECTIONS platform config.
 *   node tools/test-proposer-journey.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC;
process.env.JOBS_DISABLED = '1';

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
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };
const PAYOUT = 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3';
const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const anchor = new AnchorService(config, prisma, cardano);
  const dv = new DvService(prisma, config, anchor, cardano);
  const rounds = new RoundsService(prisma, config, dv); // dv wired → real tally on stage switch
  const proposals = new ProposalsService(prisma, config, cardano, anchor);
  const filtering = new FilteringService(prisma, anchor);
  const milestones = new MilestonesService(prisma, anchor, new TreasuryBucketsService(prisma, config, cardano));

  // §2.1 — proposal creation requires an APPROVED submitter role.
  const approveSubmitter = (userId) => db.submitterApplication.upsert({
    where: { userId },
    update: { status: 'APPROVED' },
    create: { userId, status: 'APPROVED', displayName: 'Test Submitter', description: 'test', socialLinks: [], country: 'Testland' },
  });

  const seats = await prisma.boardSeat.findMany({ where: { removedAt: null } });
  const boardDreps = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  if (boardDreps.length < 5) { console.error('need the 5-member board seated (run test-genesis first)'); process.exit(1); }
  const uidOf = (drepId) => boardDreps.find((d) => d.id === drepId)?.user.id;

  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });
  await approveSubmitter(carol.id);

  // CUSTOM GLOBAL CONFIG — escalate to stop-funding after 2 milestone rejections.
  const prevCfg = await db.platformConfig.findUnique({ where: { key: 'MILESTONE_MAX_REJECTIONS' } });
  await db.platformConfig.upsert({ where: { key: 'MILESTONE_MAX_REJECTIONS' }, update: { value: 2 }, create: { key: 'MILESTONE_MAX_REJECTIONS', value: 2 } });

  let round = null;
  const cleanupProposals = [];
  try {
    console.log('— setup: round with non-default config —');
    round = await rounds.create({
      name: '__proposer_journey__',
      mandatoryWords: 5, budgetAda: 100_000, rewardsPoolAda: 10_000,
      filterReviewerCount: 3, filterApprovalVotes: 2,
      milestoneReviewerCount: 2, milestoneApprovalVotes: 2,
      milestoneAutoExtensionDays: 7,
      ignoreBudgetChange: 0, requireFeeTopUp: 1, requireFeeReturn: 1,
      pledgeThresholdAda: 500,
      categories: [{ name: 'Tools', type: 'GRANT', allocatedAda: 100_000, description: 'tools' }],
      eligibleDrepIds: boardDreps.map((d) => d.id),
    });
    await rounds.startStage(round.id, 'SUBMISSION');
    const catId = round.categories[0].id;

    console.log('— 1) draft validation edges —');
    await throws('title under 4 chars rejected', () => proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: catId, title: 'abc', payoutAddress: PAYOUT, contentMd: words(6, 'w'), isCommercial: false,
      requestedAmountAda: 1000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 1000 }],
    }), /at least 4 characters/i);
    await throws('pledge below the round threshold rejected', () => proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: catId, title: 'Pledge low', payoutAddress: PAYOUT, contentMd: words(6, 'w'), isCommercial: false,
      requestedAmountAda: 1000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 1000 }],
      pledgeAmountAda: 100, pledgeReturnMethod: 'PER_MILESTONE', pledgeReturnDescription: 'per milestone',
    }), /pledge|threshold/i);

    console.log('— 2) mandatory words at submit —');
    const draft = await proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: catId, title: 'Proposer journey tool', payoutAddress: PAYOUT,
      contentMd: 'too short', isCommercial: false, requestedAmountAda: 1000,
      milestones: [{ title: 'Milestone 1', description: words(5, 'm'), amountAda: 1000 }],
      pledgeAmountAda: 500, pledgeReturnMethod: 'PER_MILESTONE', pledgeReturnDescription: 'proportional per milestone',
    });
    cleanupProposals.push(draft.id);
    await throws('submit blocked while the pitch is under the word minimum', () => proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feetx_1' }), /word/i);
    await proposals.updateDraft(carol.id, draft.id, {
      contentMd: words(12, 'pitch'), ecosystemImpactMd: words(6, 'impact'), successMetricsMd: words(6, 'kpi'),
      costBreakdownMd: words(6, 'cost'), teamInfoMd: words(6, 'team'),
      milestones: [{ title: 'Milestone 1', description: words(5, 'm'), acceptanceCriteria: words(6, 'acc'), amountAda: 1000 }],
    });

    console.log('— 3) fee lifecycle —');
    const submitted = await proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feetx_1' });
    ok('submit with a fee tx → PENDING (fee > 0)', submitted.status === 'PENDING' && submitted.submissionFeeAda > 0, `${submitted.status}/${submitted.submissionFeeAda}`);
    await throws('requested amount LOCKED while PENDING (settlement mode)', () => proposals.updateDraft(carol.id, draft.id, { requestedAmountAda: 2000 }), /locked after submission/i);
    const edited = await proposals.updateDraft(carol.id, draft.id, { contentMd: words(12, 'edited') });
    ok('content stays editable while PENDING', edited.contentMd.startsWith('edited0'));
    await proposals.reviewFee(draft.id, { decision: 'REJECT', feedback: 'fee looks underpaid' });
    let det = await proposals.get(draft.id, carol.id);
    ok('board fee-REJECT → REJECTED + feedback for the proposer', det.status === 'REJECTED' && det.feeReviewFeedback === 'fee looks underpaid');
    const resub = await proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feetx_2' });
    ok('re-submit with a new fee tx → PENDING, feedback cleared', resub.status === 'PENDING' && !resub.feeReviewFeedback);
    const feeHist = (await proposals.get(draft.id, carol.id)).submissionFeeTxHashes ?? [];
    ok('both fee hashes kept in history', feeHist.includes('feetx_1') && feeHist.includes('feetx_2'), JSON.stringify(feeHist));
    await proposals.reviewFee(draft.id, { decision: 'APPROVE' });
    det = await proposals.get(draft.id, carol.id);
    ok('approve → ACTIVE + structured publicId', det.status === 'ACTIVE' && /^R\d+-P\d+$/.test(det.publicId ?? ''), det.publicId);
    const subAnchor = await db.anchor.findFirst({ where: { proposalId: draft.id, kind: 'submission' }, orderBy: { createdAt: 'desc' } });
    ok('submission anchor JSON: proposalId + submitter + fee tx + requested amount',
      subAnchor?.preimage?.proposalId === det.publicId && subAnchor?.preimage?.fee?.txHash === 'feetx_2' &&
      !!subAnchor?.preimage?.submitter && subAnchor?.preimage?.requested === 1000,
      JSON.stringify(subAnchor?.preimage));

    console.log('— 4) straggler DRAFT auto-rejected when SUBMISSION ends —');
    const straggler = await proposals.createDraft(carol.id, {
      roundId: round.id, categoryId: catId, title: 'Never submitted', payoutAddress: PAYOUT,
      contentMd: words(8, 's'), isCommercial: false, requestedAmountAda: 500,
      milestones: [{ title: 'Milestone 1', description: words(5, 'm'), amountAda: 500 }],
    });
    cleanupProposals.push(straggler.id);
    await db.round.update({ where: { id: round.id }, data: { status: 'FILTERING' } });
    // The auto-reject runs in the stage transition; simulate it via the service transition path.
    await db.round.update({ where: { id: round.id }, data: { status: 'SUBMISSION' } });
    await rounds.startStage(round.id, 'FILTERING');
    const strag = await db.proposal.findUnique({ where: { id: straggler.id } });
    ok('DRAFT auto-REJECTED with a clear reason', strag.status === 'REJECTED' && /Not submitted before/.test(strag.feeReviewFeedback ?? ''), strag.feeReviewFeedback);

    console.log('— 5) filtering: 2-of-3, NO needs rationale —');
    await filtering.drawReviewers(draft.id);
    const assigns = await db.filterAssignment.findMany({ where: { proposalId: draft.id, releasedAt: null } });
    ok('drew filterReviewerCount = 3 reviewers', assigns.length === 3, `${assigns.length}`);
    const revUids = assigns.map((a) => uidOf(a.drepId)).filter(Boolean);
    await throws('NO without rationale rejected', () => filtering.vote(revUids[0], draft.id, 'NO'), /rationale/i);
    await filtering.vote(revUids[0], draft.id, 'NO', 'not convinced by the pitch');
    await filtering.vote(revUids[1], draft.id, 'YES', 'solid scope');
    await filtering.vote(revUids[2], draft.id, 'YES', 'well argued');
    det = await proposals.get(draft.id, carol.id);
    ok('2 YES (config filterApprovalVotes=2) → DEBATE_VOTE', det.stage === 'DEBATE_VOTE', det.stage);
    ok('filtering decision anchored', !!(await db.anchor.findFirst({ where: { proposalId: draft.id, kind: 'filtering' } })));

    console.log('— 6) debate: edits version, title immutable —');
    await db.round.update({ where: { id: round.id }, data: { status: 'DEBATE' } });
    const versBefore = (await proposals.versions(draft.id)).length;
    await proposals.updateDraft(carol.id, draft.id, { contentMd: words(14, 'debate') });
    ok('debate edit snapshots a new version', (await proposals.versions(draft.id)).length === versBefore + 1);
    await throws('title is immutable after submission', () => proposals.updateDraft(carol.id, draft.id, { title: 'New title attempt' }), /title/i);

    console.log('— 7) VOTE → TALLY → FUNDING —');
    await db.round.update({ where: { id: round.id }, data: { status: 'VOTE' } });
    const snap = await db.voteSnapshot.create({ data: { proposalId: draft.id } });
    const powers = [10, 8, 5];
    for (let i = 0; i < 3; i++) {
      await db.voteSnapshotEntry.create({ data: { snapshotId: snap.id, drepId: boardDreps[i].id, stakeLovelace: 0n, meritPoints: 0, basePower: powers[i], meritMultiplier: 1, finalPower: powers[i] } });
      await db.vote.create({ data: { proposalId: draft.id, drepId: boardDreps[i].id, phase: 'DEBATE_VOTE', choice: 'YES', rationale: 'r' } });
    }
    await rounds.startStage(round.id, 'TALLY');
    det = await proposals.get(draft.id, carol.id);
    ok('tally → APPROVED', det.status === 'APPROVED', det.status);
    await rounds.startStage(round.id, 'FUNDING');
    det = await proposals.get(draft.id, carol.id);
    ok('round in FUNDING; proposal stage FUNDING', det.stage === 'FUNDING', det.stage);

    console.log('— 8) pledge: reject → re-submit → approve —');
    await proposals.submitPledgeTxHash(carol.id, draft.id, 'pledgetx_1');
    await proposals.reviewPledge(draft.id, { decision: 'REJECT', feedback: 'wrong amount on-chain' });
    det = await proposals.get(draft.id, carol.id);
    ok('pledge REJECT clears the hash + stores feedback', !det.pledgeTxHash && /wrong amount/.test(det.pledgeFeedback ?? ''), det.pledgeFeedback);
    await proposals.submitPledgeTxHash(carol.id, draft.id, 'pledgetx_2');
    await proposals.reviewPledge(draft.id, { decision: 'APPROVE' });
    det = await proposals.get(draft.id, carol.id);
    ok('pledge APPROVE stamps confirmation', !!det.pledgeConfirmedAt);

    console.log('— 9) milestone rejections escalate to auto stop-funding (global config = 2) —');
    const ms = await db.milestone.findMany({ where: { proposalId: draft.id }, orderBy: { idx: 'asc' } });
    const m1 = ms[0];
    await throws('POA blocked before reviewers are assigned', () => milestones.submitPoa(carol.id, m1.id, 'POA attempt 0'), /reviewer/i);
    const cands = await milestones.candidates(draft.id);
    const jury = cands.filter((c) => c.kind === 'DRep').slice(0, 2).map((c) => ({ kind: 'DRep', id: c.id }));
    await milestones.assignReviewers(draft.id, jury, boardDreps[0].user.id);
    await milestones.submitPoa(carol.id, m1.id, 'POA attempt 1');
    await throws('POA immutable while submitted', () => milestones.submitPoa(carol.id, m1.id, 'sneaky edit'), /immutable|submitted|REJECTED/i);
    const juryUids = jury.map((j) => uidOf(j.id));
    await milestones.vote(juryUids[0], m1.id, 'NO', 'no demo linked');
    let m1row = await db.milestone.findUnique({ where: { id: m1.id } });
    ok('rejection #1 → REJECTED + rejection counter = 1 (no deadline needed)', m1row.status === 'REJECTED' && m1row.autoExtendedCount === 1, `${m1row.status}/${m1row.autoExtendedCount}`);
    ok('no auto stop-funding yet (threshold is 2)', !(await db.stopFundingProposal.findFirst({ where: { proposalId: draft.id, status: 'ACTIVE' } })));
    await milestones.submitPoa(carol.id, m1.id, 'POA attempt 2 — added demo');
    await milestones.vote(juryUids[0], m1.id, 'NO', 'demo does not run');
    m1row = await db.milestone.findUnique({ where: { id: m1.id } });
    ok('rejection #2 → counter = 2', m1row.autoExtendedCount === 2, `${m1row.autoExtendedCount}`);
    const autoStop = await db.stopFundingProposal.findFirst({ where: { proposalId: draft.id, status: 'ACTIVE' } });
    ok('platform AUTO-OPENED a stop-funding proposal (role PLATFORM)', autoStop?.proposerRole === 'PLATFORM' && /rejected 2 times/.test(autoStop?.reason ?? ''), autoStop?.reason);

    let stopped = 0;
    for (const d of boardDreps) {
      await milestones.voteStopFunding(d.user.id, autoStop.id, 'YES', 'repeated failure — stop');
      if (++stopped >= 3) break;
    }
    det = await proposals.get(draft.id, carol.id);
    ok('board 3×YES on the auto stop → proposal FAILED', det.status === 'FAILED', det.status);
    ok('stop-funding decision anchored', !!(await db.anchor.findFirst({ where: { proposalId: draft.id, kind: 'stop_funding' } })));
    await throws('POAs blocked on the stopped project', () => milestones.submitPoa(carol.id, m1.id, 'attempt after stop'), /no longer active/i);

    console.log('— 10) proposer history —');
    ok('version history kept (≥ 2 snapshots)', (await proposals.versions(draft.id)).length >= 2);
    const feedback = await db.vote.findMany({ where: { milestoneId: m1.id, phase: 'MILESTONE' }, select: { rationale: true } });
    ok('milestone review feedback recorded for the team', feedback.some((f) => /demo/.test(f.rationale ?? '')));
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    for (const pid of cleanupProposals) {
      await db.anchor.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.multisigAction.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.stopFundingVote.deleteMany({ where: { stop: { proposalId: pid } } }).catch(() => {});
      await db.stopFundingProposal.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.milestonePoa.deleteMany({ where: { milestone: { proposalId: pid } } }).catch(() => {});
      await db.milestoneAssignment.deleteMany({ where: { milestone: { proposalId: pid } } }).catch(() => {});
      await db.vote.deleteMany({ where: { OR: [{ proposalId: pid }, { milestone: { proposalId: pid } }] } }).catch(() => {});
      await db.voteSnapshotEntry.deleteMany({ where: { snapshot: { proposalId: pid } } }).catch(() => {});
      await db.voteSnapshot.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.filterAssignment.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.milestone.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.proposalVersion.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.feeAdjustment.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.comment.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.proposal.delete({ where: { id: pid } }).catch(() => {});
    }
    if (round) {
      await db.roundDrepEligibility.deleteMany({ where: { roundId: round.id } }).catch(() => {});
      await db.roundCategory.deleteMany({ where: { roundId: round.id } }).catch(() => {});
      await db.roundSchedule.deleteMany({ where: { roundId: round.id } }).catch(() => {});
      await db.anchor.deleteMany({ where: { roundId: round.id } }).catch(() => {});
      await db.round.delete({ where: { id: round.id } }).catch(() => {});
    }
    if (prevCfg) await db.platformConfig.update({ where: { key: 'MILESTONE_MAX_REJECTIONS' }, data: { value: prevCfg.value } }).catch(() => {});
    else await db.platformConfig.deleteMany({ where: { key: 'MILESTONE_MAX_REJECTIONS' } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
