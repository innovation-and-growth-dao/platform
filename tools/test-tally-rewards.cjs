/**
 * §9/§12/§16 — service-level tests for the round END-GAME: the VOTE → TALLY
 * crystallization, the TALLY → FUNDING guard, DRep reward calculation + payout,
 * and the skin-in-the-game pledge return. Covers:
 *
 *   1. Mid-VOTE finalize is blocked (no half-counted results).
 *   2. startStage(VOTE → TALLY) runs the canonical tally: threshold pass + budget
 *      fit → APPROVED; passed-threshold-but-budget-exhausted → REJECTED (budget-cut);
 *      below threshold → REJECTED.
 *   3. TALLY → FUNDING is blocked while a tie-break quick poll is open.
 *   4. §12 D&V rewards: fixed pool split per cast vote (840 ₳ / 6 votes = 140 ₳ each),
 *      bonus pool weighted by participation × power; recompute-safety and override
 *      guards once a payout is pending (no double payment).
 *   5. Payout prep: only recipients WITH a reward address are linked; the rest stay
 *      unlinked and payable in a later batch.
 *   6. §16.3 pledge return (PER_MILESTONE): each paid milestone returns its
 *      proportional share; the last share takes the remainder so the sum equals the
 *      pledge EXACTLY; idempotent (no duplicate returns).
 *
 * Deterministic: voting powers/snapshots are seeded directly; all Cardano reads are
 * stubbed. Self-cleaning.
 *
 *   node tools/test-tally-rewards.cjs
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
process.env.ROUNDS_SCHEDULER_DISABLED = '1';

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { RewardsService } = require(root + '/apps/api/dist/rewards/rewards.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { PledgeReturnService } = require(root + '/apps/api/dist/treasury/pledge-return.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };
const ADA = 1_000_000n;

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const dv = new DvService(prisma, config, anchor, cardano);
  const rounds = new RoundsService(prisma, config, dv); // dv injected → real tally on stage switch
  const buckets = new TreasuryBucketsService(prisma, config, cardano);
  const rewards = new RewardsService(prisma, buckets, cardano);
  const pledgeReturn = new PledgeReturnService(prisma, cardano, buckets);

  // Stubs: fat treasury balance for the payout pre-flight; fixed pledge sender.
  cardano.addressBalance = async (addrs) => new Map(addrs.map((a) => [a, 100_000_000_000n]));
  cardano.txSenderAddress = async () => 'addr_test_pledge_sender';

  const ts = Date.now();
  const ids = { users: [], dreps: [], props: [], snaps: [], round: null, cat: null, cfg: null, buckets: [], calcs: [], actions: [], polls: [] };

  const mkVoter = async (name, power) => {
    const user = await db.appUser.create({ data: { stakeKeyHash: `tr_${name}_${ts}`, stakeAddress: `stake_tr_${name}_${ts}`, drepKeyHash: `dkh_tr_${name}_${ts}`, displayName: name } });
    const drep = await db.drep.create({ data: { userId: user.id, drepIdOnchain: `drep_tr_${name}_${ts}`, status: 'ADMITTED' } });
    ids.users.push(user); ids.dreps.push(drep);
    return { user, drep, power };
  };
  // Seed a proposal already in Debate & Vote with its electorate + cast votes.
  const mkProp = async (title, requestedAda, votes /* Map<drepId, 'YES'|'NO'|null> */, extra = {}) => {
    const p = await db.proposal.create({
      data: {
        type: 'FUNDING', votingType: 'BALANCED', status: 'ACTIVE', stage: 'DEBATE_VOTE',
        title, roundId: ids.round.id, categoryId: ids.cat.id, submitterUserId: ids.users[0].id,
        requestedAmountAda: requestedAda * ADA, contentMd: 'c', submittedAt: new Date(), ...extra,
      },
    });
    const snap = await db.voteSnapshot.create({ data: { proposalId: p.id } });
    ids.props.push(p); ids.snaps.push(snap);
    for (const v of voters) {
      await db.voteSnapshotEntry.create({ data: { snapshotId: snap.id, drepId: v.drep.id, stakeLovelace: 0n, meritPoints: 0, basePower: v.power, meritMultiplier: 1, finalPower: v.power } });
      const choice = votes.get(v.drep.id);
      if (choice) await db.vote.create({ data: { proposalId: p.id, drepId: v.drep.id, phase: 'DEBATE_VOTE', choice, rationale: 'r' } });
    }
    return p;
  };

  let voters = [];
  try {
    console.log('— setup: 3 voters (power 10 / 8 / 5), round in VOTE, budget 1000 ₳ —');
    voters = [await mkVoter('v1', 10), await mkVoter('v2', 8), await mkVoter('v3', 5)];
    ids.round = await db.round.create({
      data: { number: 100000 + (ts % 100000), name: '__tally_rewards__', status: 'VOTE', budgetAda: 1000n * ADA, rewardsPoolAda: 2000n * ADA, multisigAddress: 'x' },
    });
    ids.cat = await db.roundCategory.create({ data: { roundId: ids.round.id, name: 'Main', type: 'GRANT', allocatedAda: 1000n * ADA } });
    const [v1, v2, v3] = voters;

    // P1: unanimous YES, 600 ₳ → fits. P2: YES 18/23 (78% > 51%) but budget exhausted → cut.
    // P3: YES 5/23 (22%) → rejected on votes.
    const P1 = await mkProp('Winner takes budget', 600n, new Map([[v1.drep.id, 'YES'], [v2.drep.id, 'YES'], [v3.drep.id, 'YES']]), {
      pledgeAmountAda: 100n * ADA, pledgeReturnMethod: 'PER_MILESTONE', pledgeTxHash: 'pledge_tx_1', pledgeConfirmedAt: new Date(),
    });
    const P2 = await mkProp('Passes vote, budget cut', 600n, new Map([[v1.drep.id, 'YES'], [v2.drep.id, 'YES']]));
    const P3 = await mkProp('Below threshold', 100n, new Map([[v3.drep.id, 'YES']]));
    const m1 = await db.milestone.create({ data: { proposalId: P1.id, idx: 0, title: 'M1', description: 'd', amountAda: 360n * ADA, status: 'PLANNED' } });
    const m2 = await db.milestone.create({ data: { proposalId: P1.id, idx: 1, title: 'M2', description: 'd', amountAda: 240n * ADA, status: 'PLANNED' } });

    console.log('— 1) mid-VOTE finalize is blocked —');
    await throws('finalize during VOTE refused (half-counted result)', () => dv.finalize(P1.id), /VOTE|voting|mid-vote/i);

    console.log('— 2) VOTE → TALLY crystallizes the tally —');
    await rounds.startStage(ids.round.id, 'TALLY');
    const [r1, r2, r3] = await Promise.all([P1, P2, P3].map((p) => db.proposal.findUnique({ where: { id: p.id } })));
    ok('round is in TALLY', (await db.round.findUnique({ where: { id: ids.round.id } })).status === 'TALLY');
    ok('P1: passed threshold + fits budget → APPROVED', r1.status === 'APPROVED', r1.status);
    ok('P2: passed threshold, budget exhausted → REJECTED (budget-cut)', r2.status === 'REJECTED', r2.status);
    ok('P3: below threshold → REJECTED', r3.status === 'REJECTED', r3.status);
    ok('decisions anchored (internal record; submits later via hot wallet)',
      (await db.anchor.count({ where: { proposalId: { in: [P1.id, P2.id, P3.id] } } })) >= 3);

    console.log('— 3) TALLY → FUNDING blocked while a tie-break quick poll is open —');
    const poll = await db.quickPoll.create({ data: { roundId: ids.round.id, categoryId: ids.cat.id, candidates: [P2.id], status: 'PENDING_BOARD', eligibleDrepIds: voters.map((v) => v.drep.id) } });
    ids.polls.push(poll);
    await throws('advance refused with an open poll', () => rounds.startStage(ids.round.id, 'FUNDING'), /quick poll/i);
    await db.quickPoll.delete({ where: { id: poll.id } }); ids.polls.pop();
    await rounds.startStage(ids.round.id, 'FUNDING');
    ok('poll resolved/removed → round advances to FUNDING', (await db.round.findUnique({ where: { id: ids.round.id } })).status === 'FUNDING');

    console.log('— 4) §12 D&V rewards: fixed 840 ₳ / 6 votes, bonus 360 ₳ by participation × power —');
    const { fixed, bonus } = await rewards.computeDv(ids.round.id);
    ids.calcs.push(fixed.id, bonus.id);
    // Defaults: experts 0% → DReps keep 2000 ₳; D&V 60% = 1200 ₳; fixed 70% = 840 ₳, bonus 360 ₳.
    ok('fixed pool = 840 ₳ (experts 0% → 2000 → 60% D&V → 70% fixed)', fixed.poolAda === 840, `${fixed.poolAda}`);
    ok('bonus pool = 360 ₳ (the remaining 30%)', bonus.poolAda === 360, `${bonus.poolAda}`);
    const fixedRows = await db.rewardEntry.findMany({ where: { rewardCalculationId: fixed.id } });
    ok('each voter cast 2 of 3 ballots → 2 × 140 ₳ = 280 ₳ fixed each',
      fixedRows.length === 3 && voters.every((v) => fixedRows.find((e) => e.drepId === v.drep.id)?.amountAda === 280n * ADA),
      JSON.stringify(fixedRows.map((e) => Number(e.amountAda) / 1e6)));
    const bonusRows = await db.rewardEntry.findMany({ where: { rewardCalculationId: bonus.id } });
    const [b1, b2, b3] = voters.map((v) => bonusRows.find((e) => e.drepId === v.drep.id)?.amountAda ?? 0n);
    ok('bonus ordered by power (v1 > v2 > v3), all positive', b1 > b2 && b2 > b3 && b3 > 0n, JSON.stringify([b1, b2, b3].map(String)));
    const bonusSum = b1 + b2 + b3;
    ok('bonus sums to the 360 ₳ pool (±dust lovelace)', bonusSum >= 360n * ADA - 5n && bonusSum <= 360n * ADA + 5n, `${bonusSum}`);

    console.log('— 5) payout prep: address-less recipients stay unlinked; linked calc is frozen —');
    ids.cfg = await db.multisigConfig.create({ data: { scriptJson: { type: 'atLeast', required: 3, scripts: [] }, scriptHash: `tr_sh_${ts}`, bech32Address: `addr_test_tr_ms_${ts}`, threshold: 3, totalKeys: 5 } });
    ids.buckets.push(await db.treasuryBucket.create({ data: { configId: ids.cfg.id, label: 'Rewards', scriptJson: {}, scriptHash: `tr_shr_${ts}`, bech32Address: `addr_test_tr_rew_${ts}`, isDefaultRewards: true } }));
    await db.appUser.update({ where: { id: voters[0].user.id }, data: { rewardPaymentAddress: 'addr_test_reward_v1' } });
    await db.appUser.update({ where: { id: voters[1].user.id }, data: { rewardPaymentAddress: 'addr_test_reward_v2' } });

    const pay1 = await rewards.preparePayout(fixed.id);
    ids.actions.push(pay1.actionId);
    ok('pays the 2 recipients with an address; 1 skipped (unlinked, payable later)',
      pay1.recipients === 2 && pay1.skipped === 1 && pay1.totalAda === 560, JSON.stringify(pay1));
    const linked = await db.rewardEntry.findMany({ where: { payoutActionId: pay1.actionId } });
    ok('exactly the 2 addressed entries are linked to the action', linked.length === 2);

    await throws('recompute refused while a payout is pending (no double payment)', () => rewards.computeDv(ids.round.id), /pending payout/i);
    await throws('override refused on an entry in a pending payout', () => rewards.setOverride(linked[0].id, 500), /pending payout/i);

    await db.appUser.update({ where: { id: voters[2].user.id }, data: { rewardPaymentAddress: 'addr_test_reward_v3' } });
    const pay2 = await rewards.preparePayout(fixed.id);
    ids.actions.push(pay2.actionId);
    ok('late-address recipient payable in a second batch (only the remaining entry)',
      pay2.recipients === 1 && pay2.totalAda === 280, JSON.stringify(pay2));

    console.log('— 6) §16.3 pledge return per milestone: shares sum EXACTLY to the pledge —');
    await db.milestone.update({ where: { id: m1.id }, data: { paidAt: new Date(), paidInTx: 'tx_m1' } });
    const ret1 = await pledgeReturn.maybePrepareReturn(P1.id, m1.id);
    ok('milestone 1 (360/600) → 60 ₳ share to the pledge sender',
      ret1?.kind === 'PLEDGE_RETURN' && ret1.amountAda === 60n * ADA && ret1.destAddress === 'addr_test_pledge_sender', `${ret1?.amountAda}`);
    ids.actions.push(ret1.id);
    ok('idempotent — same milestone returns nothing twice', (await pledgeReturn.maybePrepareReturn(P1.id, m1.id)) === null);
    await db.milestone.update({ where: { id: m2.id }, data: { paidAt: new Date(), paidInTx: 'tx_m2' } });
    const ret2 = await pledgeReturn.maybePrepareReturn(P1.id, m2.id);
    ids.actions.push(ret2.id);
    ok('last milestone takes the remainder → 40 ₳ (total = 100 ₳ pledge exactly)',
      ret2?.amountAda === 40n * ADA && ret1.amountAda + ret2.amountAda === 100n * ADA, `${ret2?.amountAda}`);

    console.log('— 7) round closes —');
    await rounds.startStage(ids.round.id, 'CLOSED');
    ok('round CLOSED with endedAt stamped', !!(await db.round.findUnique({ where: { id: ids.round.id } })).endedAt);
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    const propIds = ids.props.map((p) => p.id);
    await db.multisigAction.deleteMany({ where: { OR: [{ id: { in: ids.actions.filter(Boolean) } }, { proposalId: { in: propIds } }] } }).catch(() => {});
    await db.rewardEntry.deleteMany({ where: { rewardCalculation: { roundId: ids.round?.id } } }).catch(() => {});
    await db.rewardCalculation.deleteMany({ where: { roundId: ids.round?.id } }).catch(() => {});
    await db.anchor.deleteMany({ where: { OR: [{ proposalId: { in: propIds } }, { roundId: ids.round?.id }] } }).catch(() => {});
    await db.quickPoll.deleteMany({ where: { roundId: ids.round?.id } }).catch(() => {});
    await db.vote.deleteMany({ where: { proposalId: { in: propIds } } }).catch(() => {});
    await db.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: ids.snaps.map((s) => s.id) } } }).catch(() => {});
    await db.voteSnapshot.deleteMany({ where: { id: { in: ids.snaps.map((s) => s.id) } } }).catch(() => {});
    await db.milestone.deleteMany({ where: { proposalId: { in: propIds } } }).catch(() => {});
    await db.proposal.deleteMany({ where: { id: { in: propIds } } }).catch(() => {});
    await db.roundCategory.deleteMany({ where: { roundId: ids.round?.id } }).catch(() => {});
    await db.roundSchedule.deleteMany({ where: { roundId: ids.round?.id } }).catch(() => {});
    await db.round.deleteMany({ where: { id: ids.round?.id } }).catch(() => {});
    await db.treasuryBucket.deleteMany({ where: { id: { in: ids.buckets.map((b) => b.id) } } }).catch(() => {});
    if (ids.cfg) await db.multisigConfig.delete({ where: { id: ids.cfg.id } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: ids.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: ids.users.map((u) => u.id) } } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
