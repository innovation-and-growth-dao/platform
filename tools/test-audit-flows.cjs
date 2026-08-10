/**
 * Service-level tests for the audit batch:
 *   §9.1 budget auto-ranking at finalize (approve within budget, budget-cut the rest)
 *   §9.2 quick-poll: tie detection, board launch, vote, low-participation extension,
 *        exhausted-extensions fallback (FAILED → candidates budget-cut)
 *   §11.5 board one-time milestone extension
 *   §16.4 pledge-grace extension + the daily expiry job (notifications)
 *   §2.1 submitter gating on createDraft
 *   §20.3 notification dedupe per (user, kind, refId)
 *   §6 schedule auto-shift (extending the current stage cascades to later stages)
 *
 * Self-cleaning: creates throwaway rounds/proposals/users and deletes them.
 *   node tools/test-audit-flows.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // never submit real txs from tests
process.env.JOBS_DISABLED = '1';

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { QuickPollService } = require(root + '/apps/api/dist/proposals/quick-poll.service.js');
const { MilestonesService } = require(root + '/apps/api/dist/milestones/milestones.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { NotificationsService } = require(root + '/apps/api/dist/notifications/notifications.service.js');
const { SubmitterService } = require(root + '/apps/api/dist/submitter/submitter.service.js');
const { JobsService } = require(root + '/apps/api/dist/jobs/jobs.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const dv = new DvService(prisma, config, anchor, cardano);
  const quickPolls = new QuickPollService(prisma, dv);
  const notify = new NotificationsService(prisma);

  // Throwaway submitter user + two voting DReps (loose rows, no on-chain identity needed).
  const user = await db.appUser.create({ data: { stakeKeyHash: `tst_${Date.now()}`, stakeAddress: 'stake_test_audit' } });
  const mkDrep = async (n) => db.drep.create({
    data: {
      userId: (await db.appUser.create({ data: { stakeKeyHash: `tstd_${n}_${Date.now()}`, stakeAddress: `stake_d${n}` } })).id,
      drepIdOnchain: `drep_test_audit_${n}_${Date.now()}`,
      status: 'ADMITTED',
    },
  });
  const d1 = await mkDrep(1);
  const d2 = await mkDrep(2);

  // Round in VOTE with one category (budget 1000 ₳) + helper to seed a D&V proposal with a
  // single-voter snapshot of chosen power, voting YES (=> 100% approval; ranking by power).
  const round = await db.round.create({
    data: {
      number: 9000 + Math.floor(Math.random() * 100), name: '__audit_flows__', status: 'VOTE',
      budgetAda: 1000_000_000n, rewardsPoolAda: 0n, multisigAddress: 'addr_test_audit',
    },
  });
  const cat = await db.roundCategory.create({ data: { roundId: round.id, name: 'C', type: 'GRANT', allocatedAda: 1000_000_000n } });
  const cleanupProposalIds = [];
  const mkProposal = async (title, askAda, power, voter = d1) => {
    const p = await db.proposal.create({
      data: {
        type: 'FUNDING', votingType: 'BALANCED', status: 'ACTIVE', stage: 'DEBATE_VOTE', title,
        roundId: round.id, categoryId: cat.id, submitterUserId: user.id,
        requestedAmountAda: BigInt(askAda) * 1_000_000n, contentMd: 'c', submittedAt: new Date(),
      },
    });
    const snap = await db.voteSnapshot.create({ data: { proposalId: p.id } });
    await db.voteSnapshotEntry.create({
      data: { snapshotId: snap.id, drepId: voter.id, stakeLovelace: 0n, meritPoints: 0, basePower: power, meritMultiplier: 1, finalPower: power },
    });
    await db.vote.create({ data: { proposalId: p.id, drepId: voter.id, phase: 'DEBATE_VOTE', choice: 'YES', rationale: 'r' } });
    cleanupProposalIds.push(p.id);
    return p;
  };

  try {
    // ── §9.1 budget auto-ranking ─────────────────────────────────────────────
    const A = await mkProposal('A', 600, 100);
    const B = await mkProposal('B', 600, 80);
    const C = await mkProposal('C', 300, 60); // fits the leftover, but is BELOW the cliff
    await db.round.update({ where: { id: round.id }, data: { status: 'FUNDING' } }); // finalize refuses mid-VOTE
    await dv.finalizeRound(round.id);
    const get = (id) => db.proposal.findUnique({ where: { id }, select: { status: true, stage: true } });
    ok('§9.1 highest-power proposal fits budget → APPROVED', (await get(A.id)).status === 'APPROVED');
    ok('§9.1 next proposal over budget → REJECTED (budget-cut)', (await get(B.id)).status === 'REJECTED');
    ok('§9.1 walk stops at the cliff — lower-ranked rejected even if it would fit', (await get(C.id)).status === 'REJECTED');

    // ── §9.2 quick poll on a tie at the cliff ────────────────────────────────
    const round2 = await db.round.create({
      data: { number: round.number + 100, name: '__audit_flows_2__', status: 'FUNDING', budgetAda: 600_000_000n, rewardsPoolAda: 0n, multisigAddress: 'x' },
    });
    const cat2 = await db.roundCategory.create({ data: { roundId: round2.id, name: 'C2', type: 'GRANT', allocatedAda: 600_000_000n } });
    const mk2 = async (title, power, voter) => {
      const p = await db.proposal.create({
        data: { type: 'FUNDING', votingType: 'BALANCED', status: 'ACTIVE', stage: 'DEBATE_VOTE', title, roundId: round2.id, categoryId: cat2.id, submitterUserId: user.id, requestedAmountAda: 600_000_000n, contentMd: 'c', submittedAt: new Date() },
      });
      const snap = await db.voteSnapshot.create({ data: { proposalId: p.id } });
      await db.voteSnapshotEntry.create({ data: { snapshotId: snap.id, drepId: voter.id, stakeLovelace: 0n, meritPoints: 0, basePower: power, meritMultiplier: 1, finalPower: power } });
      await db.vote.create({ data: { proposalId: p.id, drepId: voter.id, phase: 'DEBATE_VOTE', choice: 'YES', rationale: 'r' } });
      cleanupProposalIds.push(p.id);
      return p;
    };
    const T1 = await mk2('T1', 70, d1);
    const T2 = await mk2('T2', 70, d2); // identical score, budget fits only one → tie
    await dv.finalizeRound(round2.id);
    const poll = await db.quickPoll.findFirst({ where: { roundId: round2.id } });
    ok('§9.2 tie at the cliff creates a quick poll (PENDING_BOARD)', poll?.status === 'PENDING_BOARD');
    ok('§9.2 both tied proposals are candidates', !!poll && poll.candidates.includes(T1.id) && poll.candidates.includes(T2.id));
    ok('§9.2 candidates stay ACTIVE until the poll resolves', (await get(T1.id)).status === 'ACTIVE' && (await get(T2.id)).status === 'ACTIVE');

    const launched = await quickPolls.launch(poll.id);
    ok('§9.2 board one-click launch opens the window', launched?.status === 'ACTIVE' && !!launched?.endsAt);
    const voted = await quickPolls.vote(d1.userId, poll.id, [T1.id, T2.id]);
    ok('§9.2 eligible DRep votes (choice recorded)', voted?.myRanking?.[0] === T1.id);
    await throws('§9.2 non-candidate choice rejected', () => quickPolls.vote(d1.userId, poll.id, [A.id, T2.id]), /not a candidate/);

    // Low participation (1 of 2 voters, power 50%) at deadline → extension.
    await db.quickPoll.update({ where: { id: poll.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await quickPolls.resolveDue();
    let st = await db.quickPoll.findUnique({ where: { id: poll.id } });
    ok('§9.2 <51% participation extends the poll', st.status === 'ACTIVE' && st.extensions === 1, `status=${st.status} ext=${st.extensions}`);

    // Exhaust extensions → FAILED, neither funded.
    await db.quickPoll.update({ where: { id: poll.id }, data: { extensions: 99, endsAt: new Date(Date.now() - 1000) } });
    await quickPolls.resolveDue();
    st = await db.quickPoll.findUnique({ where: { id: poll.id } });
    ok('§9.2 exhausted extensions → FAILED', st.status === 'FAILED');
    ok('§9.2 fallback: neither tied proposal is funded', (await get(T1.id)).status === 'REJECTED' && (await get(T2.id)).status === 'REJECTED');

    // ── §11.5 board one-time milestone extension ─────────────────────────────
    const milestones = new MilestonesService(prisma, anchor, { defaultBucketFor: async () => null });
    const mp = await db.proposal.create({
      data: { type: 'FUNDING', votingType: 'BALANCED', status: 'APPROVED', stage: 'FUNDING', title: 'MS', roundId: round.id, categoryId: cat.id, submitterUserId: user.id, requestedAmountAda: 0n, contentMd: 'c' },
    });
    cleanupProposalIds.push(mp.id);
    const baseDeadline = new Date(Date.now() + 5 * 86_400_000);
    const ms = await db.milestone.create({ data: { proposalId: mp.id, idx: 0, amountAda: 0n, status: 'NOT_STARTED', deadlineAt: baseDeadline } });
    await milestones.grantBoardExtension(mp.id, ms.id, 30);
    const after = await db.milestone.findUnique({ where: { id: ms.id } });
    const gained = Math.round((after.deadlineAt.getTime() - baseDeadline.getTime()) / 86_400_000);
    ok('§11.5 board extension moves the deadline by N days', gained === 30, `gained ${gained}d`);
    ok('§11.5 extension recorded (one-time marker)', !!after.boardExtendedAt && after.boardExtensionDays === 30);
    await throws('§11.5 second extension refused (one-time)', () => milestones.grantBoardExtension(mp.id, ms.id, 10), /already been used/);
    await throws('§11.5 over-max extension refused', async () => {
      await db.milestone.update({ where: { id: ms.id }, data: { boardExtendedAt: null, boardExtensionDays: null } });
      await milestones.grantBoardExtension(mp.id, ms.id, 9999);
    }, /between 1 and/);

    // ── §16.4 pledge grace: extension + expiry job ───────────────────────────
    const proposals = new ProposalsService(prisma, config, cardano, anchor);
    const pp = await db.proposal.create({
      data: { type: 'FUNDING', votingType: 'BALANCED', status: 'APPROVED', stage: 'FUNDING', title: 'PL', roundId: round.id, categoryId: cat.id, submitterUserId: user.id, requestedAmountAda: 0n, contentMd: 'c', pledgeAmountAda: 50_000_000n, pledgeGraceEndsAt: new Date(Date.now() - 86_400_000) },
    });
    cleanupProposalIds.push(pp.id);
    const jobs = new JobsService(prisma, cardano, anchor, notify, { defaultBucketFor: async () => null, list: async () => ({ buckets: [] }) }, quickPolls, undefined);
    await jobs.pledgeGraceCheck();
    const ppAfter = await db.proposal.findUnique({ where: { id: pp.id }, select: { pledgeGraceNotifiedAt: true } });
    ok('§16.4 expired grace stamps the one-time alert', !!ppAfter.pledgeGraceNotifiedAt);
    await proposals.extendPledgeGrace(pp.id, 14);
    const ppExt = await db.proposal.findUnique({ where: { id: pp.id }, select: { pledgeGraceEndsAt: true, pledgeGraceNotifiedAt: true } });
    ok('§16.4 extension re-arms the alert + moves the window forward', ppExt.pledgeGraceNotifiedAt === null && ppExt.pledgeGraceEndsAt > new Date());
    await throws('§16.4 extension refused without a pledge', () => proposals.extendPledgeGrace(mp.id, 14), /no pledge/);

    // ── §2.1 submitter gating ────────────────────────────────────────────────
    await db.round.update({ where: { id: round.id }, data: { status: 'SUBMISSION' } });
    await throws('§2.1 createDraft refused without an approved submitter role',
      () => proposals.createDraft(user.id, { roundId: round.id, categoryId: cat.id, title: 'Audit flow test', contentMd: 'c', isCommercial: false, requestedAmountAda: 10, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 10 }] }),
      /approved submitter/);

    // ── §2.1 no self-review of submitter applications ────────────────────────
    const submitters = new SubmitterService(prisma);
    const selfApp = await db.submitterApplication.create({
      data: { userId: user.id, status: 'PENDING', displayName: 'Self', description: 'x', socialLinks: [], country: 'Testland' },
    });
    await throws('§2.1 approving your OWN application is forbidden', () => submitters.approve(selfApp.id, user.id), /own application/);
    await throws('§2.1 rejecting your OWN application is forbidden', () => submitters.reject(selfApp.id, 'no', user.id), /own application/);
    await submitters.approve(selfApp.id, d1.userId); // another member can
    ok('§2.1 another member can approve it', (await db.submitterApplication.findUnique({ where: { id: selfApp.id } })).status === 'APPROVED');
    // §2.1 — leave/deregister: blocked while a proposal is in flight; profile kept (LEFT).
    const lp = await db.proposal.create({
      data: { type: 'FUNDING', votingType: 'BALANCED', status: 'PENDING', title: 'LV', roundId: round.id, categoryId: cat.id, submitterUserId: user.id, requestedAmountAda: 0n, contentMd: 'c' },
    });
    cleanupProposalIds.push(lp.id);
    await throws('§2.1 leaving is blocked while a proposal is active', () => submitters.leave(user.id), /active proposal/);
    // Close EVERYTHING in flight for this user (earlier sections approved several proposals).
    await db.proposal.updateMany({ where: { submitterUserId: user.id, status: { in: ['PENDING', 'ACTIVE', 'APPROVED'] } }, data: { status: 'COMPLETE' } });
    await submitters.leave(user.id);
    const leftApp = await db.submitterApplication.findUnique({ where: { id: selfApp.id } });
    ok('§2.1 leaving keeps the profile (status LEFT + leftAt)', leftApp.status === 'LEFT' && !!leftApp.leftAt);
    ok('§2.1 a LEFT submitter is no longer approved (role gone)', (await submitters.isApproved(user.id)) === false);
    await db.submitterApplication.delete({ where: { id: selfApp.id } });

    // ── §20.3 notification dedupe ────────────────────────────────────────────
    const n1 = await notify.notifyUsers([user.id], 'TEST_KIND', 'ref-1', { title: 'x' });
    const n2 = await notify.notifyUsers([user.id], 'TEST_KIND', 'ref-1', { title: 'x' });
    ok('§20.3 dedupe: second identical notification skipped', n1 === 1 && n2 === 0, `${n1}/${n2}`);
    ok('§20.3 unread count reflects the single row', (await notify.unreadCount(user.id)) === 1);
    await notify.markAllRead(user.id);
    ok('§20.3 mark-all-read clears the count', (await notify.unreadCount(user.id)) === 0);

    // ── §6 schedule auto-shift ───────────────────────────────────────────────
    const rounds = new RoundsService(prisma, config);
    const now = Date.now();
    await db.roundSchedule.createMany({
      data: [
        { roundId: round.id, stageKey: 'submission', startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 86_400_000) },
        { roundId: round.id, stageKey: 'filtering', startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 2 * 86_400_000) },
      ],
    });
    const newEnd = new Date(now + 3 * 86_400_000); // +2 days vs the old end
    await rounds.updateCurrentStageWindow(round.id, { endsAt: newEnd.toISOString() }, user.id);
    const filt = await db.roundSchedule.findUnique({ where: { roundId_stageKey: { roundId: round.id, stageKey: 'filtering' } } });
    const shifted = Math.round((filt.startsAt.getTime() - (now + 86_400_000)) / 86_400_000);
    ok('§6 extending the current stage auto-shifts later stages by the same delta', shifted === 2, `shifted ${shifted}d`);
  } finally {
    // cleanup (FK-ordered) — covers BOTH throwaway rounds (quick-poll votes/winner reference proposals).
    const pids = cleanupProposalIds;
    const rids = (await db.round.findMany({ where: { name: { in: ['__audit_flows__', '__audit_flows_2__'] } }, select: { id: true } })).map((r) => r.id);
    await db.quickPollVote.deleteMany({ where: { quickPoll: { roundId: { in: rids } } } }).catch(() => undefined);
    await db.quickPoll.deleteMany({ where: { roundId: { in: rids } } }).catch(() => undefined);
    await db.vote.deleteMany({ where: { proposalId: { in: pids } } }).catch(() => undefined);
    await db.voteSnapshotEntry.deleteMany({ where: { snapshot: { proposalId: { in: pids } } } }).catch(() => undefined);
    await db.voteSnapshot.deleteMany({ where: { proposalId: { in: pids } } }).catch(() => undefined);
    await db.milestone.deleteMany({ where: { proposalId: { in: pids } } }).catch(() => undefined);
    await db.anchor.deleteMany({ where: { proposalId: { in: pids } } }).catch(() => undefined);
    await db.proposal.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await db.roundSchedule.deleteMany({ where: { roundId: { in: rids } } }).catch(() => undefined);
    await db.roundCategory.deleteMany({ where: { roundId: { in: rids } } }).catch(() => undefined);
    await db.round.deleteMany({ where: { id: { in: rids } } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.drep.deleteMany({ where: { id: { in: [d1.id, d2.id] } } }).catch(() => undefined);
    await db.appUser.deleteMany({ where: { id: { in: [user.id, d1.userId, d2.userId] } } }).catch(() => undefined);
  }

  console.log(fail ? `\n${fail} failure(s)` : '\nall good');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
