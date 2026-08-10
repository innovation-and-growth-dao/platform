/**
 * VOTING-DREP JOURNEY AT SCALE — 12 registered DReps drive a full round with
 * NON-DEFAULT config (3-of-5 filtering jury, 60% D&V threshold, 50% quick-poll
 * participation), covering:
 *
 *   1. Dashboard: DAO overview lists all 12 with exact adjusted-power math
 *      (log10(stake) × merit multiplier) from stubbed on-chain metrics.
 *   2. Filtering: 5-reviewer draw from the 12, 3 YES advances; FILTER_COMPLETE
 *      merit for every reviewer who voted.
 *   3. D&V: all 12 in the electorate; two proposals tie EXACTLY at the budget
 *      cliff (yes-power 50 vs 50, threshold 60% passed by both), a third fails
 *      the threshold; DV_VOTE merit through the service path.
 *   4. TALLY: below-threshold proposal REJECTED; the tie creates a quick poll
 *      (PENDING_BOARD) and blocks FUNDING until resolved.
 *   5. Quick poll: launch → 8 of 12 vote a full ranking (QUICK_POLL_VOTE merit)
 *      → resolve → winner APPROVED, loser REJECTED (budget-cut) → FUNDING opens.
 *   6. Rewards (§12): fixed pool split per cast ballot across 36 ballots; bonus
 *      ordered by voting power; payout links exactly the 10 recipients with a
 *      reward address (2 stay unlinked).
 *   7. Comments: a DRep comments, another replies (threaded).
 *   8. History: per-proposal vote lists with rationales; every decision visible
 *      in On-chain proofs; round category stats add up (1 approved / 2 rejected).
 *
 * Deterministic (all chain reads stubbed); self-cleaning.
 *   node tools/test-dreps-at-scale.cjs
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
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { FilteringService } = require(root + '/apps/api/dist/proposals/filtering.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { QuickPollService } = require(root + '/apps/api/dist/proposals/quick-poll.service.js');
const { MeritService } = require(root + '/apps/api/dist/merit/merit.service.js');
const { RewardsService } = require(root + '/apps/api/dist/rewards/rewards.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { CommentsService } = require(root + '/apps/api/dist/comments/comments.service.js');
const { DrepService } = require(root + '/apps/api/dist/drep/drep.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const PAYOUT = 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3';
const ADA = 1_000_000n;

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const merit = new MeritService(prisma);
  const dv = new DvService(prisma, config, anchor, cardano, merit);
  const rounds = new RoundsService(prisma, config, dv);
  const proposals = new ProposalsService(prisma, config, cardano, anchor);
  const filtering = new FilteringService(prisma, anchor, merit);
  const quickPolls = new QuickPollService(prisma, dv, merit);
  const buckets = new TreasuryBucketsService(prisma, config, cardano);
  const rewards = new RewardsService(prisma, buckets, cardano);
  const comments = new CommentsService(prisma);
  const drepSvc = new DrepService(prisma, cardano, anchor);

  const ts = Date.now();
  const ids = { users: [], dreps: [], props: [], round: null, cfg: null, buckets: [] };

  // ── 12 registered DReps, powers 1..12 (drep #i has power i) ──
  const voters = [];
  for (let i = 1; i <= 12; i++) {
    const u = await db.appUser.create({
      data: {
        stakeKeyHash: `sc_u${i}_${ts}`, stakeAddress: `stake_sc_${i}_${ts}`, drepKeyHash: `dkh_sc_${i}_${ts}`,
        drepRegistered: true, displayName: `DRep ${String(i).padStart(2, '0')}`,
        rewardPaymentAddress: i <= 10 ? `addr_test_reward_sc_${i}` : null, // 2 without an address
      },
    });
    const d = await db.drep.create({ data: { userId: u.id, drepIdOnchain: `drep_sc_${i}_${ts}`, status: 'ADMITTED', subcategoryIds: ['governance'] } });
    ids.users.push(u); ids.dreps.push(d);
    voters.push({ user: u, drep: d, power: i });
  }
  const byPower = (p) => voters.find((v) => v.power === p);
  const uidOf = (drepId) => voters.find((v) => v.drep.id === drepId)?.user.id;

  // ── stub every chain read for determinism ──
  cardano.addressBalance = async (addrs) => new Map(addrs.map((a) => [a, 1_000_000_000_000n]));
  cardano.drepMetadata = async () => new Map();
  cardano.drepActivityMetricsBatch = async () => new Map();
  cardano.drepEntryMetricsBatch = async (rows) =>
    new Map(rows.map((r) => {
      const v = voters.find((x) => x.drep.drepIdOnchain === r.drepId);
      // drep #i gets 10^i ₳ of voting power → basePower = log10 = i exactly.
      const lovelace = v ? BigInt(Math.round(10 ** v.power)) * ADA : 0n;
      return [r.drepId, { votingPowerLovelace: lovelace, delegators: v ? v.power : 0, ownVotingPowerLovelace: lovelace, qualifyingDelegators: 0 }];
    }));
  dv.liveBalancedPower = async (drepIds) => new Map(drepIds.map((id) => [id, voters.find((v) => v.drep.id === id)?.power ?? 0]));

  try {
    console.log('— 1) DAO overview dashboard: 12 members, exact adjusted power —');
    const members = await drepSvc.listDaoMembers();
    const mine = members.filter((m) => m.drepId.startsWith(`drep_sc_`) && m.drepId.endsWith(`_${ts}`));
    ok('all 12 new DReps listed as DAO members', mine.length === 12, `${mine.length}`);
    const m12 = mine.find((m) => m.displayName === 'DRep 12');
    ok('power math exact: 10^12 ₳ → base log₁₀ = 12, merit 0 → adjusted 12.00',
      m12 && m12.basePower === 12 && m12.meritMultiplier === 1 && m12.adjustedPower === 12, JSON.stringify({ b: m12?.basePower, m: m12?.merit, a: m12?.adjustedPower }));

    console.log('— 2) round + filtering with a 5-of-12 jury —');
    const submitter = ids.users[0]; // DRep 01 doubles as the submitter
    await db.submitterApplication.upsert({
      where: { userId: submitter.id },
      update: { status: 'APPROVED' },
      create: { userId: submitter.id, status: 'APPROVED', displayName: 'S', description: 'd', socialLinks: [], country: 'T' },
    });
    ids.round = await rounds.create({
      name: '__dreps_at_scale__', mandatoryWords: 0, budgetAda: 600, rewardsPoolAda: 2_000,
      filterReviewerCount: 5, filterApprovalVotes: 3, dvApprovalThresholdPct: 60,
      quickPollParticipationPct: 50, quickPollDurationHours: 48,
      feeOssPct: 0, feeCommercialPct: 0,
      categories: [{ name: 'Main', type: 'GRANT', allocatedAda: 600, description: 'main' }],
      eligibleDrepIds: voters.map((v) => v.drep.id),
    });
    const catId = ids.round.categories[0].id;
    await rounds.startStage(ids.round.id, 'SUBMISSION');
    const mk = (title, amt) => proposals.createDraft(submitter.id, {
      roundId: ids.round.id, categoryId: catId, title, payoutAddress: PAYOUT, contentMd: 'pitch',
      isCommercial: false, requestedAmountAda: amt, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: amt }],
    });
    const A = await mk('Tie candidate A', 600);
    const B = await mk('Tie candidate B', 600);
    const C = await mk('Below threshold C', 100);
    ids.props.push(A.id, B.id, C.id);
    for (const p of [A, B, C]) await proposals.submit(submitter.id, p.id, {}); // zero fee → straight ACTIVE

    await rounds.startStage(ids.round.id, 'FILTERING');
    await filtering.drawReviewers(A.id);
    const assigns = await db.filterAssignment.findMany({ where: { proposalId: A.id, releasedAt: null } });
    ok('5 reviewers drawn from the 12 eligible', assigns.length === 5, `${assigns.length}`);
    let fVotes = 0;
    for (const a of assigns) { await filtering.vote(uidOf(a.drepId), A.id, 'YES', 'looks solid'); if (++fVotes >= 3) break; }
    ok('3 YES (config) → A advances to DEBATE_VOTE', (await db.proposal.findUnique({ where: { id: A.id } })).stage === 'DEBATE_VOTE');
    const filterMerit = await db.meritLedger.count({ where: { reasonCode: 'FILTER_COMPLETE', referenceId: A.id } });
    ok('FILTER_COMPLETE merit for each of the 3 reviewers', filterMerit === 3, `${filterMerit}`);
    // B and C skip the filtering ceremony — push them to D&V directly, stamping the round's
    // D&V threshold exactly like filtering.maybeDecide does when it advances a proposal.
    await db.proposal.updateMany({ where: { id: { in: [B.id, C.id] } }, data: { stage: 'DEBATE_VOTE', approvalThresholdPct: 60 } });

    console.log('— 3) D&V: 12-strong electorate, exact tie at the cliff —');
    await db.round.update({ where: { id: ids.round.id }, data: { status: 'VOTE' } });
    // Electorate = all 12 on every proposal. Yes-sets: A {12,11,10,9,5,3}=50, B {12,11,10,8,6,3}=50,
    // C {4,2,1}=7. Everyone else votes an explicit NO (36 ballots total for rewards).
    const yesA = new Set([12, 11, 10, 9, 5, 3]);
    const yesB = new Set([12, 11, 10, 8, 6, 3]);
    const yesC = new Set([4, 2, 1]);
    const seed = async (propId, yes, skipServiceFor = new Set()) => {
      const snap = await db.voteSnapshot.create({ data: { proposalId: propId } });
      for (const v of voters) {
        await db.voteSnapshotEntry.create({ data: { snapshotId: snap.id, drepId: v.drep.id, stakeLovelace: 0n, meritPoints: 0, basePower: v.power, meritMultiplier: 1, finalPower: v.power } });
        if (!skipServiceFor.has(v.power)) {
          await db.vote.create({ data: { proposalId: propId, drepId: v.drep.id, phase: 'DEBATE_VOTE', choice: yes.has(v.power) ? 'YES' : 'NO', rationale: `rationale by ${v.power}` } });
        }
      }
    };
    // NOTE: dv.vote() refreshes the voter's snapshot power with their merit-adjusted LIVE
    // power — that would nudge the exact 50-vs-50 tie. So the service-path (merit) votes go
    // through proposal C, whose outcome is threshold-decided regardless of tiny power shifts.
    await seed(A.id, yesA);
    await seed(B.id, yesB);
    await seed(C.id, yesC, new Set([4, 2]));
    await dv.vote(byPower(4).user.id, C.id, 'YES', 'votes through the service');
    await dv.vote(byPower(2).user.id, C.id, 'YES', 'votes through the service');
    const dvMerit = await db.meritLedger.count({ where: { reasonCode: 'DV_VOTE', referenceId: C.id } });
    ok('DV_VOTE merit awarded via the service path', dvMerit === 2, `${dvMerit}`);

    console.log('— 4) TALLY: threshold + tie → quick poll gate —');
    await rounds.startStage(ids.round.id, 'TALLY');
    ok('C below the 60% threshold → REJECTED', (await db.proposal.findUnique({ where: { id: C.id } })).status === 'REJECTED');
    const poll = await db.quickPoll.findFirst({ where: { roundId: ids.round.id, status: { in: ['PENDING_BOARD', 'ACTIVE'] } } });
    ok('exact 50-vs-50 tie at the cliff → quick poll created', !!poll && poll.candidates.includes(A.id) && poll.candidates.includes(B.id));
    ok('A and B stay ACTIVE while the poll is open',
      (await db.proposal.findUnique({ where: { id: A.id } })).status === 'ACTIVE' && (await db.proposal.findUnique({ where: { id: B.id } })).status === 'ACTIVE');
    let blocked = false;
    try { await rounds.startStage(ids.round.id, 'FUNDING'); } catch { blocked = true; }
    ok('FUNDING blocked while the poll is unresolved', blocked);

    console.log('— 5) quick poll: 8 of 12 vote ranked → winner funded —');
    await quickPolls.launch(poll.id);
    for (const p of [12, 11, 10, 9, 8, 7, 6, 5]) {
      const v = byPower(p);
      // Majority ranks A first (B first only for two voters) → A wins the Borda count.
      const ranking = p === 8 || p === 6 ? [B.id, A.id] : [A.id, B.id];
      await quickPolls.vote(v.user.id, poll.id, ranking);
    }
    const qpMerit = await db.meritLedger.count({ where: { reasonCode: 'QUICK_POLL_VOTE', referenceId: poll.id } });
    ok('QUICK_POLL_VOTE merit for all 8 voters', qpMerit === 8, `${qpMerit}`);
    await db.quickPoll.update({ where: { id: poll.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await quickPolls.resolveDue();
    const [ra, rb] = await Promise.all([A, B].map((p) => db.proposal.findUnique({ where: { id: p.id } })));
    ok('poll resolved: A APPROVED (winner)', ra.status === 'APPROVED', ra.status);
    ok('B REJECTED (budget-cut — same votes, budget exhausted)', rb.status === 'REJECTED', rb.status);
    await rounds.startStage(ids.round.id, 'FUNDING');
    ok('FUNDING opens once the poll resolved', (await db.round.findUnique({ where: { id: ids.round.id } })).status === 'FUNDING');

    console.log('— 6) rewards: 36 ballots, fixed split + power-ordered bonus, 10 payable —');
    const { fixed, bonus } = await rewards.computeDv(ids.round.id);
    const fixedRows = await db.rewardEntry.findMany({ where: { rewardCalculationId: fixed.id } });
    ok('every one of the 12 voters earned fixed rewards', fixedRows.length === 12, `${fixedRows.length}`);
    const perVote = (840n * ADA) / 36n;
    ok('fixed = ballots × (840 ₳ / 36) each (3 ballots per DRep)',
      fixedRows.every((e) => e.amountAda === perVote * 3n), `${perVote * 3n}`);
    const bonusRows = await db.rewardEntry.findMany({ where: { rewardCalculationId: bonus.id } });
    const bAmt = (p) => bonusRows.find((e) => e.drepId === byPower(p).drep.id)?.amountAda ?? 0n;
    ok('bonus strictly ordered by voting power (12 > 6 > 1)', bAmt(12) > bAmt(6) && bAmt(6) > bAmt(1) && bAmt(1) > 0n);
    // payout needs an active multisig + rewards bucket
    ids.cfg = await db.multisigConfig.create({ data: { scriptJson: { type: 'atLeast', required: 3, scripts: [] }, scriptHash: `sc_sh_${ts}`, bech32Address: `addr_test_sc_ms_${ts}`, threshold: 3, totalKeys: 5 } });
    ids.buckets.push(await db.treasuryBucket.create({ data: { configId: ids.cfg.id, label: 'Rewards', scriptJson: {}, scriptHash: `sc_shr_${ts}`, bech32Address: `addr_test_sc_rew_${ts}`, isDefaultRewards: true } }));
    const pay = await rewards.preparePayout(fixed.id);
    ok('payout links exactly the 10 recipients with an address (2 skipped)', pay.recipients === 10 && pay.skipped === 2, JSON.stringify(pay));

    console.log('— 7) comments: threaded discussion —');
    const c1 = await comments.create(byPower(7).user.id, A.id, 'Great scope — how will you measure adoption?');
    const c2 = await comments.create(byPower(9).user.id, A.id, 'Agree with the question above.', c1.id);
    const reply = await db.comment.findUnique({ where: { id: c2.id } });
    ok('comment + threaded reply recorded', reply?.parentId === c1.id && reply?.authorUserId === byPower(9).user.id);

    console.log('— 8) history: votes with rationales, proofs, category stats —');
    const resA = await dv.result(A.id);
    ok('vote history: all 12 voters listed with rationales', resA.votes.length === 12 && resA.votes.every((v) => !!v.rationale));
    const proofs = await drepSvc.listOnChainProofs();
    const ourAnchors = await db.anchor.findMany({ where: { proposalId: { in: [A.id, B.id, C.id] }, kind: 'dv' } });
    ok('all three D&V decisions anchored', ourAnchors.length === 3, `${ourAnchors.length}`);
    ok('decisions appear in On-chain proofs', ourAnchors.every((a) => proofs.some((p) => p.hash === a.hash)));
    const roundDetail = await rounds.get(ids.round.id);
    const stats = roundDetail.categories[0].stats;
    ok('category stats add up: 1 approved / 2 rejected in D&V', stats.approved === 1 && stats.rejectedVote === 2, JSON.stringify({ a: stats.approved, r: stats.rejectedVote }));
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    for (const pid of ids.props) {
      await db.anchor.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.comment.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.quickPollVote.deleteMany({ where: { quickPoll: { candidates: { has: pid } } } }).catch(() => {});
      await db.vote.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.voteSnapshotEntry.deleteMany({ where: { snapshot: { proposalId: pid } } }).catch(() => {});
      await db.voteSnapshot.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.filterAssignment.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.milestoneAssignment.deleteMany({ where: { milestone: { proposalId: pid } } }).catch(() => {});
      await db.milestone.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.proposalVersion.deleteMany({ where: { proposalId: pid } }).catch(() => {});
      await db.multisigAction.deleteMany({ where: { proposalId: pid } }).catch(() => {});
    }
    if (ids.round) {
      await db.quickPoll.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      await db.rewardEntry.deleteMany({ where: { rewardCalculation: { roundId: ids.round.id } } }).catch(() => {});
      const acts = await db.multisigAction.findMany({ where: { kind: 'REWARD_PAYOUT' }, select: { id: true } }).catch(() => []);
      await db.rewardCalculation.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      for (const a of acts) await db.multisigAction.delete({ where: { id: a.id } }).catch(() => {});
      await db.proposal.deleteMany({ where: { id: { in: ids.props } } }).catch(() => {});
      await db.roundDrepEligibility.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      await db.roundCategory.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      await db.roundSchedule.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      await db.anchor.deleteMany({ where: { roundId: ids.round.id } }).catch(() => {});
      await db.round.delete({ where: { id: ids.round.id } }).catch(() => {});
    }
    await db.treasuryBucket.deleteMany({ where: { id: { in: ids.buckets.map((b) => b.id) } } }).catch(() => {});
    if (ids.cfg) await db.multisigConfig.delete({ where: { id: ids.cfg.id } }).catch(() => {});
    await db.submitterApplication.deleteMany({ where: { userId: { in: ids.users.map((u) => u.id) } } }).catch(() => {});
    await db.meritLedger.deleteMany({ where: { drepId: { in: ids.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: ids.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: ids.users.map((u) => u.id) } } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
