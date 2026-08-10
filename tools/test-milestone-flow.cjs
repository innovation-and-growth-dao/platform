/**
 * §11 — milestone allocation + POA gating + stop-funding. Validates the post-r56 flow
 * end-to-end at the service level (no tADA spent; ANCHOR_MNEMONIC removed):
 *   - board sees ranked candidates (expertise first, then load),
 *   - board assigns exactly milestoneReviewerCount DReps (rejects wrong count / submitter / dupes),
 *   - re-allocation requires release; release blocked once a POA has been submitted,
 *   - POA cannot be edited once submitted (only a REJECTED milestone allows resubmit),
 *   - APPROVED milestone auto-prepares a PROJECT_FUNDING multisig action (board → pay),
 *   - reviewer + board can propose stop-funding (3-YES → proposal FAILED + anchor),
 *   - notification counts: per-board "pending stop-funding" non-zero while ACTIVE.
 *
 * Self-cleaning. node tools/test-milestone-flow.cjs
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
  if (boardDreps.length < 5) { console.error('need 5 seated board members for this test'); process.exit(1); }
  // Resolves to user.id for any admitted DRep we know about (board or non-board) so the
  // vote loops below work for either kind of reviewer.
  const allDrepsCache = new Map();
  const userIdForDrep = (drepId) => {
    if (allDrepsCache.has(drepId)) return allDrepsCache.get(drepId);
    return boardDreps.find((d) => d.id === drepId)?.user.id;
  };

  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });

  // Include any admitted non-board DReps in the round so we can verify the REVIEWER
  // role on stop-funding (board members are checked first, so a board-DRep proposer
  // would resolve to role=BOARD even when also assigned as a reviewer).
  const seatHashes = seats.map((s) => s.drepKeyHash);
  const nonBoardDreps = await prisma.drep.findMany({
    where: { status: 'ADMITTED', user: { drepKeyHash: { notIn: seatHashes } } },
    include: { user: { select: { id: true } } },
  });
  for (const d of nonBoardDreps) allDrepsCache.set(d.id, d.user.id);

  console.log('\n=== Setup: round → submit → filter → D&V → FUNDING ===');
  // Only board in initial eligibility so D&V tally is clean — we ADD any non-board
  // admitted DReps to eligibility AFTER D&V finalizes so they become valid milestone
  // reviewer candidates (and we can test the REVIEWER role on stop-funding).
  const round = await rounds.create({
    name: 'Milestone-flow round',
    mandatoryWords: 0, budgetAda: 1_000_000, rewardsPoolAda: 50_000,
    categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000 }],
    eligibleDrepIds: boardDreps.map((d) => d.id),
  });
  await rounds.startStage(round.id, 'SUBMISSION');
  const draft = await proposals.createDraft(carol.id, {
    roundId: round.id, categoryId: round.categories[0].id, title: 'Milestone flow tool',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Pitch.', isCommercial: true, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'M1', amountAda: 600 }, { title: 'Milestone 2', description: 'M2', amountAda: 400 }],
  });
  await proposals.submit(carol.id, draft.id, { submissionFeeTxHash: 'feehash-mf' });
  await proposals.reviewFee(draft.id, { decision: 'APPROVE' });
  // The proposal.stage transitions (FILTERING → DEBATE_VOTE → FUNDING) are driven
  // directly by the proposal services. r65 requires round.status === FILTERING for
  // the filtering vote to be accepted, so push round status via Prisma here
  // (bypassing §5.1 which the demo data would otherwise trip).
  await prisma.round.update({ where: { id: round.id }, data: { status: 'FILTERING' } });
  await filtering.drawReviewers(draft.id);
  const fas = await prisma.filterAssignment.findMany({ where: { proposalId: draft.id, releasedAt: null } });
  let v = 0;
  for (const a of fas) {
    const uid = userIdForDrep(a.drepId);
    if (uid) { await filtering.vote(uid, draft.id, 'YES', 'looks fine'); if (++v >= 3) break; }
  }
  // §8 — D&V ballots open only once the round reaches the VOTE sub-stage (the
  // proposal already flipped to DEBATE_VOTE on passing filtering). Advance it.
  await prisma.round.update({ where: { id: round.id }, data: { status: 'DV' } });
  await dv.openVoting(draft.id);
  for (const d of boardDreps) await dv.optIn(d.user.id, draft.id);
  const rationale = 'I support this proposal because '.padEnd(220, 'x');
  for (const d of boardDreps) await dv.vote(d.user.id, draft.id, 'YES', rationale);
  await dv.finalize(draft.id);
  // Direct status push — bypasses §5.1 (single-Filtering rule) without touching the
  // demo round; the test restores the round status in cleanup below.
  await prisma.round.update({ where: { id: round.id }, data: { status: 'FUNDING' } });
  // Now ADD non-board admitted DReps to the round so they become valid candidates for
  // milestone allocation (after D&V — they don't affect the D&V tally).
  for (const d of nonBoardDreps) {
    await prisma.roundDrepEligibility.create({ data: { roundId: round.id, drepId: d.id } });
  }
  let det = await proposals.get(draft.id);
  ok('proposal in FUNDING', det.stage === 'FUNDING' && det.status === 'APPROVED');

  console.log('\n=== §11.1 Board allocation: candidates ranked, exact count enforced ===');
  const cands = await milestones.candidates(draft.id);
  const wantCands = boardDreps.length + nonBoardDreps.length;
  ok('candidates list returned', Array.isArray(cands) && cands.length === wantCands, `${cands.length} cands (expected ${wantCands})`);
  // §11.1 ranking — expertise-matched DReps come first when there's an overlap. The
  // sort is stable across runs (ties broken by load then name).
  const hasExpertise = cands.some((c) => c.expertiseMatch);
  if (hasExpertise) {
    const firstNon = cands.findIndex((c) => !c.expertiseMatch);
    const lastExp = cands.map((c) => c.expertiseMatch).lastIndexOf(true);
    ok('expertise-matched candidates ranked first', firstNon === -1 || firstNon > lastExp);
  }
  ok('submitter excluded from candidates', !cands.some((c) => c.drepId === det.submitterDrepId ?? null));
  ok('each candidate carries expertise + load metadata', cands.every((c) => typeof c.expertiseMatch === 'boolean' && typeof c.loadInRound === 'number'));

  // Round override is null → use platform default (3). Try wrong counts.
  let threwTooFew = false;
  try { await milestones.assignReviewers(draft.id, __asJury([cands[0].drepId, cands[1].drepId]), boardDreps[0].user.id); } catch { threwTooFew = true; }
  ok('rejects fewer than the required count', threwTooFew);

  let threwTooMany = false;
  try { await milestones.assignReviewers(draft.id, __asJury([cands[0].drepId, cands[1].drepId, cands[2].drepId, cands[3].drepId]), boardDreps[0].user.id); } catch { threwTooMany = true; }
  ok('rejects more than the required count', threwTooMany);

  let threwDup = false;
  try { await milestones.assignReviewers(draft.id, __asJury([cands[0].drepId, cands[0].drepId, cands[1].drepId]), boardDreps[0].user.id); } catch { threwDup = true; }
  ok('rejects duplicate DReps in the selection', threwDup);

  // Pick three reviewers: at least one non-board DRep when available so we can later
  // test the REVIEWER role on stop-funding (board members resolve to role=BOARD first).
  const drepCands = cands.filter((c) => c.kind !== 'Expert');
  const nonBoardCands = drepCands.filter((c) => nonBoardDreps.some((d) => d.id === c.drepId));
  const boardCands = drepCands.filter((c) => !nonBoardCands.some((n) => n.drepId === c.drepId));
  const jury = [...nonBoardCands.slice(0, 1), ...boardCands.slice(0, 3 - Math.min(1, nonBoardCands.length))].slice(0, 3).map((c) => c.drepId);
  const after = await milestones.assignReviewers(draft.id, __asJury(jury), boardDreps[0].user.id);
  ok('reviewers assigned to every milestone', after.every((m) => m.reviewers.length === 3));

  // Re-allocate without release → blocked.
  let threwReassign = false;
  try { await milestones.assignReviewers(draft.id, __asJury(jury), boardDreps[0].user.id); } catch { threwReassign = true; }
  ok('reassign blocked without release', threwReassign);

  // Release + reassign works (no POA submitted yet).
  await milestones.releaseReviewers(draft.id);
  await milestones.assignReviewers(draft.id, __asJury(jury), boardDreps[0].user.id);
  ok('release + reassign succeeds (no POA yet)', true);

  console.log('\n=== §11.2 POA gating: immutable once submitted, resubmit only after REJECTED ===');
  const ms = await milestones.forProposal(draft.id);
  const m1 = ms[0], m2 = ms[1];
  await milestones.submitPoa(carol.id, m1.id, 'POA attempt 1 for M1');

  // Cannot resubmit while POA_SUBMITTED.
  let threwResub = false;
  try { await milestones.submitPoa(carol.id, m1.id, 'attempt 2 immediately — not allowed'); } catch { threwResub = true; }
  ok('cannot edit/resubmit POA while under review', threwResub);

  // Cannot release reviewers after a POA was submitted.
  let threwReleaseAfter = false;
  try { await milestones.releaseReviewers(draft.id); } catch { threwReleaseAfter = true; }
  ok('cannot release reviewers once a POA exists', threwReleaseAfter);

  // Two reviewers vote NO → REJECTED, then resubmit is allowed.
  let rejVotes = 0;
  for (const drepId of jury) {
    const uid = userIdForDrep(drepId);
    if (uid) { await milestones.vote(uid, m1.id, 'NO', 'evidence is missing'); if (++rejVotes >= 2) break; }
  }
  const m1after = await milestones.result(m1.id);
  ok('2 NO votes → milestone REJECTED', m1after.status === 'REJECTED', m1after.status);
  // Resubmission now succeeds (clears prior votes).
  await milestones.submitPoa(carol.id, m1.id, 'POA attempt 2 — addressed feedback');
  const m1r = await milestones.result(m1.id);
  ok('REJECTED → resubmit POA opens it for review again', m1r.status === 'POA_SUBMITTED' && m1r.yes === 0 && m1r.no === 0);

  console.log('\n=== Approve M1 → auto-prepared PROJECT_FUNDING action for the board ===');
  let appV = 0;
  for (const drepId of jury) {
    const uid = userIdForDrep(drepId);
    if (uid) { await milestones.vote(uid, m1.id, 'YES', 'now delivered'); if (++appV >= 2) break; }
  }
  const m1ok = await milestones.result(m1.id);
  ok('M1 APPROVED', m1ok.status === 'APPROVED', m1ok.status);
  const payAction = await prisma.multisigAction.findFirst({
    // Structural link (the action carries milestoneId since §11/§15) — no fragile text match.
    where: { kind: 'PROJECT_FUNDING', milestoneId: m1.id },
    orderBy: { createdAt: 'desc' },
  });
  ok('PROJECT_FUNDING multisig action prepared for the board', !!payAction && payAction.status === 'PENDING_SIGS');

  console.log('\n=== §11 Stop-funding: reviewer proposes, board 1p1v decides ===');
  // Prefer a non-board reviewer so role resolves to REVIEWER (board members would
  // resolve to BOARD first since they have stop-funding authority anyway).
  const reviewerDrepId = jury.find((id) => nonBoardDreps.some((d) => d.id === id)) ?? jury[0];
  const isNonBoardReviewer = nonBoardDreps.some((d) => d.id === reviewerDrepId);
  const reviewerUid = userIdForDrep(reviewerDrepId);
  const stop = await milestones.proposeStopFunding(reviewerUid, draft.id, 'project quality degraded — concrete evidence in milestone 1 review');
  const expectedRole = isNonBoardReviewer ? 'REVIEWER' : 'BOARD';
  ok(`${isNonBoardReviewer ? 'non-board reviewer' : 'board-reviewer'} proposes stop-funding → ACTIVE`, stop.status === 'ACTIVE' && stop.proposerRole === expectedRole, `role=${stop.proposerRole}`);

  // Duplicate ACTIVE not allowed.
  let threwDupStop = false;
  try { await milestones.proposeStopFunding(reviewerUid, draft.id, 'second one'); } catch { threwDupStop = true; }
  ok('cannot open a second ACTIVE stop-funding for the same proposal', threwDupStop);

  // Non-reviewer / non-board user cannot propose.
  let threwForbidden = false;
  try { await milestones.proposeStopFunding(carol.id, draft.id, 'submitter trying to stop their own project'); } catch { threwForbidden = true; }
  ok('non-reviewer non-board user cannot propose', threwForbidden);

  // Notification badge: each board member sees a pending count > 0.
  const pendingBefore = await Promise.all(boardDreps.map((d) => milestones.pendingStopFundingForBoard(d.user.id)));
  ok('every board member has 1 pending stop-funding before voting', pendingBefore.every((n) => n === 1));

  // Active list (board view) includes our stop.
  const active = await milestones.activeStopFundingsForBoard(boardDreps[0].user.id);
  ok('board sees the active stop in the global panel', active.some((s) => s.id === stop.id));

  // Board votes: first two YES → not enough; third YES → APPROVED + proposal FAILED + anchor.
  await milestones.voteStopFunding(boardDreps[0].user.id, stop.id, 'YES');
  await milestones.voteStopFunding(boardDreps[1].user.id, stop.id, 'YES');
  const halfway = (await milestones.stopFundingsForProposal(draft.id)).find((s) => s.id === stop.id);
  ok('still ACTIVE after 2 YES (threshold 3)', halfway.status === 'ACTIVE' && halfway.yes === 2);
  // Once a board member votes, their pending count drops by 1.
  const pendingMid = await milestones.pendingStopFundingForBoard(boardDreps[0].user.id);
  ok('voter\'s pending count drops to 0 after voting', pendingMid === 0);

  await milestones.voteStopFunding(boardDreps[2].user.id, stop.id, 'YES');
  const decided = (await milestones.stopFundingsForProposal(draft.id)).find((s) => s.id === stop.id);
  ok('3 YES → APPROVED', decided.status === 'APPROVED' && decided.yes === 3);
  det = await proposals.get(draft.id);
  ok('proposal status → FAILED on stop-funding APPROVED', det.status === 'FAILED');

  const stopAnchor = await prisma.anchor.findFirst({ where: { proposalId: draft.id, kind: 'stop_funding' } });
  ok('stop-funding decision anchored (label 80808081)', !!stopAnchor && stopAnchor.metadataLabel === 80808081);
  const pre = stopAnchor?.preimage ?? {};
  ok('anchor preimage carries subject + outcome', pre.subject === 'stop_funding' && pre.result?.outcome === 'APPROVED', `outcome=${pre.result?.outcome}`);

  // Pending count is 0 for everyone now.
  const pendingAfter = await Promise.all(boardDreps.map((d) => milestones.pendingStopFundingForBoard(d.user.id)));
  ok('pending stop-funding count drops to 0 once decided', pendingAfter.every((n) => n === 0));

  console.log('\n=== Cleanup ===');
  const msIds = (await prisma.milestone.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((m) => m.id);
  const snapIds = (await prisma.voteSnapshot.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((s) => s.id);
  const stopIds = (await prisma.stopFundingProposal.findMany({ where: { proposalId: draft.id }, select: { id: true } })).map((s) => s.id);
  await prisma.stopFundingVote.deleteMany({ where: { stopId: { in: stopIds } } });
  await prisma.stopFundingProposal.deleteMany({ where: { proposalId: draft.id } });
  await prisma.vote.deleteMany({ where: { proposalId: draft.id } });
  await prisma.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  await prisma.milestone.deleteMany({ where: { proposalId: draft.id } });
  await prisma.filterAssignment.deleteMany({ where: { proposalId: draft.id } });
  await prisma.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapIds } } });
  await prisma.voteSnapshot.deleteMany({ where: { proposalId: draft.id } });
  await prisma.proposalVersion.deleteMany({ where: { proposalId: draft.id } });
  await prisma.anchor.deleteMany({ where: { proposalId: draft.id } });
  // Auto-prepared PROJECT_FUNDING multisig actions queued by maybeDecide().
  await prisma.multisigAction.deleteMany({ where: { kind: 'PROJECT_FUNDING', description: { contains: `${det.publicId ?? draft.id}` } } });
  await prisma.proposal.delete({ where: { id: draft.id } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
