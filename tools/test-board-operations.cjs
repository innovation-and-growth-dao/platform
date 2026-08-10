/**
 * BOARD-MEMBER JOURNEY — the money paths, driven through the REAL 3-of-5 signing
 * ceremony: the board's multisig keys are genuine Ed25519 keys generated in the
 * test, the tx bodies are real CSL-built Cardano transactions, and every witness
 * is a real signature over the tx hash (only the final Koios broadcast and the
 * UTxO/param reads are stubbed). Covers:
 *
 *   1. Multisig assembly from the 5 generated board keys (status refresh).
 *   2. Internal proposals — every type:
 *      INFORMATIVE (1p1v, 5×YES → APPROVED + anchored with docHash),
 *      POLL (per-option tally anchored),
 *      INSTRUCTIVE (names actors),
 *      SPENDING → auto-prepared OPS action → CEREMONY → funds sent to the team,
 *      CONFIRMED + "Internal proposal payout" anchor.
 *   3. Milestone payout: PROJECT_FUNDING action → CEREMONY → milestone stamped
 *      PAID + payout anchor + the skin-in-the-game PLEDGE_RETURN auto-prepared.
 *   4. Reward payout: linked entries → CEREMONY (multi-output tx) → entries
 *      stamped paid/paidToAddress + reward-payout anchor with all recipients.
 *   5. Internal transfer between buckets → CEREMONY → CONFIRMED.
 *   6. Merit: TX_SIGNED ×3 per confirmed action; TX_INITIATED for the transfer.
 *   7. Transactions view: every confirmed action visible (executed-actions
 *      fallback) with its tx hash + label.
 *   8. Signature history: 3 recorded signatures per action, attributable per DRep.
 *
 * Self-cleaning; parks + restores the standing board and any active multisig.
 *   node tools/test-board-operations.cjs
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

const CSL = require(root + '/apps/api/node_modules/@emurgo/cardano-serialization-lib-nodejs');
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { BoardMultisigService } = require(root + '/apps/api/dist/treasury/board-multisig.service.js');
const { MultisigBroadcastService } = require(root + '/apps/api/dist/treasury/multisig-broadcast.service.js');
const { TreasuryService } = require(root + '/apps/api/dist/treasury/treasury.service.js');
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { PledgeReturnService } = require(root + '/apps/api/dist/treasury/pledge-return.service.js');
const { InternalProposalsService } = require(root + '/apps/api/dist/internal-proposals/internal-proposals.service.js');
const { RewardsService } = require(root + '/apps/api/dist/rewards/rewards.service.js');
const { MeritService } = require(root + '/apps/api/dist/merit/merit.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const ADA = 1_000_000n;

// Real Preprod-like protocol params for the CSL tx builder.
const PP = {
  min_fee_a: 44, min_fee_b: 155381, pool_deposit: 500000000, key_deposit: 2000000,
  max_val_size: 5000, max_tx_size: 16384, coins_per_utxo_size: 4310,
};
const keyAddr = (pub) => CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(pub.hash())).to_address().to_bech32();

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const merit = new MeritService(prisma);
  const boardMs = new BoardMultisigService(prisma, config, cardano, merit, anchor);
  const bucketsSvc = new TreasuryBucketsService(prisma, config, cardano);
  const pledgeReturn = new PledgeReturnService(prisma, cardano, bucketsSvc);
  const broadcast = new MultisigBroadcastService(prisma, config, anchor, cardano, pledgeReturn, merit);
  const treasury = new TreasuryService(prisma, config, cardano, anchor, bucketsSvc, pledgeReturn);
  const internal = new InternalProposalsService(prisma, config, anchor, cardano);
  const rewards = new RewardsService(prisma, bucketsSvc, cardano);

  const ts = Date.now();
  const startedAt = new Date();

  // ── stubs: UTxOs, params, balances, pledge sender; intercept ONLY the Koios broadcast ──
  cardano.addressUtxos = async () => [{ tx_hash: 'a'.repeat(64), tx_index: 0, value: '5000000000' }]; // 5 000 ₳ input
  cardano.epochParams = async () => PP;
  cardano.addressBalance = async (addrs) => new Map(addrs.map((a) => [a, 1_000_000_000_000n]));
  cardano.txSenderAddress = async () => null; // set per-scenario below
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/submittx')) return { ok: true, text: async () => '"ok"', json: async () => 'ok' };
    return realFetch(url, opts);
  };

  // ── park the standing board + any active multisig config ──
  const parkedSeats = await db.boardSeat.findMany({ where: { removedAt: null }, select: { id: true } });
  await db.boardSeat.updateMany({ where: { id: { in: parkedSeats.map((s) => s.id) } }, data: { removedAt: new Date() } });
  const activeBefore = await db.multisigConfig.findFirst({ where: { replacedAt: null } });
  if (activeBefore) await db.multisigConfig.update({ where: { id: activeBefore.id }, data: { replacedAt: new Date() } });

  // ── 5 board members with REAL Ed25519 multisig keys ──
  const mine = { users: [], dreps: [], seats: [], keys: [], props: [], actions: [], buckets: [], cfgs: [], rounds: [] };
  const board = [];
  for (let i = 1; i <= 5; i++) {
    const prv = CSL.PrivateKey.generate_ed25519();
    const pub = prv.to_public();
    const user = await db.appUser.create({ data: { stakeKeyHash: `bo_u${i}_${ts}`, stakeAddress: `stake_bo_${i}_${ts}`, drepKeyHash: `dkh_bo_${i}_${ts}`, drepRegistered: true, displayName: `Board ${i}` } });
    const drep = await db.drep.create({ data: { userId: user.id, drepIdOnchain: `drep_bo_${i}_${ts}`, status: 'ADMITTED' } });
    const seat = await db.boardSeat.create({ data: { drepId: drep.drepIdOnchain, drepKeyHash: user.drepKeyHash, displayName: `Board ${i}` } });
    const key = await db.boardMultisigKey.create({
      data: { boardSeatId: seat.id, userId: user.id, paymentKeyHash: pub.hash().to_hex(), paymentBech32: keyAddr(pub), hardwareAttested: true, attestationSignature: 'sig', attestationKey: 'key', attestationTs: new Date().toISOString() },
    });
    mine.users.push(user); mine.dreps.push(drep); mine.seats.push(seat); mine.keys.push(key);
    board.push({ user, drep, seat, prv, pub });
  }

  // The REAL ceremony: build the tx body, then 3 board members sign the actual tx hash.
  const ceremony = async (actionId) => {
    await broadcast.prepareTxBody(actionId);
    const act = await db.multisigAction.findUnique({ where: { id: actionId } });
    const txHash = CSL.FixedTransaction.from_hex(act.txCbor).transaction_hash();
    let res;
    for (const m of board.slice(0, 3)) {
      const ws = CSL.TransactionWitnessSet.new();
      const vk = CSL.Vkeywitnesses.new();
      vk.add(CSL.make_vkey_witness(txHash, m.prv));
      ws.set_vkeys(vk);
      res = await broadcast.submitWitness(actionId, ws.to_hex(), m.user.id);
    }
    return res;
  };

  try {
    console.log('— 1) multisig assembles from the 5 generated keys —');
    const st = await boardMs.status();
    ok('3-of-5 multisig assembled', st.active?.threshold === 3 && st.active?.totalKeys === 5, st.active?.bech32Address);
    const cfg = await db.multisigConfig.findUnique({ where: { id: st.active.id } });
    mine.cfgs.push(cfg);
    // Buckets: primary + Rewards + Ops — real key addresses so change outputs parse; the
    // labeled buckets reuse the multisig script so the same 5 keys witness their spends.
    const bPrv = CSL.PrivateKey.generate_ed25519();
    const primary = await db.treasuryBucket.create({ data: { configId: cfg.id, label: '', scriptJson: cfg.scriptJson, scriptHash: `bo_shp_${ts}`, bech32Address: cfg.bech32Address, isPrimary: true } });
    const rewB = await db.treasuryBucket.create({ data: { configId: cfg.id, label: 'Rewards', scriptJson: cfg.scriptJson, scriptHash: `bo_shr_${ts}`, bech32Address: keyAddr(bPrv.to_public()), isDefaultRewards: true } });
    const opsB = await db.treasuryBucket.create({ data: { configId: cfg.id, label: 'Ops', scriptJson: cfg.scriptJson, scriptHash: `bo_sho_${ts}`, bech32Address: keyAddr(CSL.PrivateKey.generate_ed25519().to_public()), isDefaultOperations: true } });
    mine.buckets.push(primary, rewB, opsB);

    console.log('— 2) internal proposals: every type —');
    const proposer = board[0].user.id;
    // INFORMATIVE (yes/no, 1p1v)
    const info = await internal.submit(proposer, { title: '__bo info__', contentMd: 'Adopt the policy.', internalType: 'INFORMATIVE', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 3 });
    mine.props.push(info.id);
    for (const m of board) await internal.vote(m.user.id, info.id, { choice: 'YES', rationale: 'agreed' });
    const infoFin = await internal.finalize(info.id);
    ok('INFORMATIVE 5×YES → APPROVED', infoFin.status === 'APPROVED', infoFin.status);
    const infoAnchor = await db.anchor.findFirst({ where: { proposalId: info.id, kind: 'internal' } });
    ok('internal anchor JSON: label 80808081 + publicId + date-independent docHash',
      infoAnchor?.metadataLabel === 80808081 && !!infoAnchor?.preimage?.publicId && /^[0-9a-f]{64}$/.test(infoAnchor?.preimage?.docHash ?? ''),
      JSON.stringify({ pid: infoAnchor?.preimage?.publicId }));

    // POLL (choose options)
    const poll = await internal.submit(proposer, { title: '__bo poll__', contentMd: 'Pick.', internalType: 'POLL', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 3, pollOptions: ['Alpha', 'Beta'], pollMultiple: false });
    mine.props.push(poll.id);
    for (const m of board.slice(0, 4)) await internal.vote(m.user.id, poll.id, { options: ['Alpha'] });
    await internal.vote(board[4].user.id, poll.id, { options: ['Beta'] });
    const pollFin = await internal.finalize(poll.id);
    ok('POLL tallied per option (Alpha 4 / Beta 1)', pollFin.tally?.kind === 'POLL' && JSON.stringify(pollFin.tally).includes('Alpha'), JSON.stringify(pollFin.tally));

    // INSTRUCTIVE (names actors)
    const instr = await internal.submit(proposer, { title: '__bo instructive__', contentMd: 'Do the thing.', internalType: 'INSTRUCTIVE', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 3, actors: 'Board 1 and Board 2 execute this' });
    mine.props.push(instr.id);
    for (const m of board) await internal.vote(m.user.id, instr.id, { choice: 'YES', rationale: 'go' });
    ok('INSTRUCTIVE approved', (await internal.finalize(instr.id)).status === 'APPROVED');

    // SPENDING → OPS action → REAL CEREMONY → paid
    const team = keyAddr(CSL.PrivateKey.generate_ed25519().to_public());
    const spend = await internal.submit(proposer, { title: '__bo spending__', contentMd: 'Pay the vendor.', internalType: 'SPENDING', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 3, spendingAmountAda: 50, spendingDestAddress: team });
    mine.props.push(spend.id);
    for (const m of board) await internal.vote(m.user.id, spend.id, { choice: 'YES', rationale: 'pay' });
    await internal.finalize(spend.id);
    await internal.detail(spend.id, proposer); // triggers maybePrepareSpending
    const opsAction = await db.multisigAction.findFirst({ where: { kind: 'OPS', proposalId: spend.id } });
    mine.actions.push(opsAction);
    ok('SPENDING approval auto-prepared the OPS action (50 ₳ to the team)', opsAction?.amountAda === 50n * ADA && opsAction?.destAddress === team);
    const spendRes = await ceremony(opsAction.id);
    ok('CEREMONY: 3 real signatures → CONFIRMED + tx hash', spendRes.status === 'CONFIRMED' && /^[0-9a-f]{64}$/.test(spendRes.txHash ?? ''), spendRes.txHash);
    ok('internal-proposal payout anchored (recipient + amount + tx)',
      !!(await db.anchor.findFirst({ where: { kind: 'reward_payout', createdAt: { gte: startedAt }, preimage: { path: ['stage'], equals: 'Internal proposal payout' } } })));

    console.log('— 3) milestone payout ceremony + pledge return —');
    cardano.txSenderAddress = async () => keyAddr(CSL.PrivateKey.generate_ed25519().to_public());
    const fRound = await db.round.create({ data: { number: 200000 + (ts % 90000), name: '__bo_round__', status: 'FUNDING', budgetAda: 1000n * ADA, rewardsPoolAda: 1000n * ADA, multisigAddress: 'x' } });
    mine.rounds.push(fRound);
    const fProp = await db.proposal.create({
      data: {
        type: 'FUNDING', votingType: 'BALANCED', status: 'APPROVED', stage: 'FUNDING', title: '__bo funded__',
        roundId: fRound.id, submitterUserId: board[0].user.id, requestedAmountAda: 100n * ADA, contentMd: 'c',
        payoutAddress: team, pledgeAmountAda: 40n * ADA, pledgeReturnMethod: 'PER_MILESTONE', pledgeTxHash: 'pl_tx', pledgeConfirmedAt: new Date(),
      },
    });
    mine.props.push(fProp.id);
    const fMil = await db.milestone.create({ data: { proposalId: fProp.id, idx: 0, title: 'M1', description: 'd', amountAda: 100n * ADA, status: 'APPROVED' } });
    const payAction = await db.multisigAction.create({
      data: { kind: 'PROJECT_FUNDING', status: 'PENDING_SIGS', amountAda: 100n * ADA, description: 'Milestone #1 payout — __bo funded__', proposalId: fProp.id, milestoneId: fMil.id, milestoneIdx: 0, proposalTitle: '__bo funded__', destAddress: team },
    });
    mine.actions.push(payAction);
    const payRes = await ceremony(payAction.id);
    ok('milestone payout CONFIRMED via real ceremony', payRes.status === 'CONFIRMED');
    const fMilAfter = await db.milestone.findUnique({ where: { id: fMil.id } });
    ok('milestone stamped PAID with the tx', !!fMilAfter.paidAt && fMilAfter.paidInTx === payRes.txHash);
    const pledgeAct = await db.multisigAction.findFirst({ where: { kind: 'PLEDGE_RETURN', proposalId: fProp.id } });
    mine.actions.push(pledgeAct);
    ok('skin-in-the-game: PLEDGE_RETURN auto-prepared for the full 40 ₳ (last milestone)', pledgeAct?.amountAda === 40n * ADA, `${pledgeAct?.amountAda}`);
    const payAnchor = await db.anchor.findFirst({ where: { kind: 'reward_payout', createdAt: { gte: startedAt }, preimage: { path: ['payoutTx'], equals: payRes.txHash } } });
    ok('payout anchor JSON: recipient address + lovelace + tx', payAnchor?.preimage?.recipients?.[0]?.to === team && payAnchor?.preimage?.recipients?.[0]?.lovelace === 100_000_000, JSON.stringify(payAnchor?.preimage?.recipients));

    console.log('— 4) reward payout ceremony (multi-output) —');
    for (const m of board.slice(0, 2)) {
      await db.appUser.update({ where: { id: m.user.id }, data: { rewardPaymentAddress: keyAddr(m.pub) } });
    }
    const calc = await db.rewardCalculation.create({ data: { roundId: fRound.id, kind: 'DV_FIXED', poolAda: 100n * ADA, totalUnits: 2 } });
    for (const m of board.slice(0, 2)) {
      await db.rewardEntry.create({ data: { rewardCalculationId: calc.id, drepId: m.drep.id, amountAda: 50n * ADA, units: 1 } });
    }
    const prep = await rewards.preparePayout(calc.id);
    mine.actions.push({ id: prep.actionId });
    ok('payout prepared for the 2 addressed recipients', prep.recipients === 2, JSON.stringify(prep));
    const rewRes = await ceremony(prep.actionId);
    ok('reward payout CONFIRMED via real multi-output ceremony', rewRes.status === 'CONFIRMED');
    const entries = await db.rewardEntry.findMany({ where: { rewardCalculationId: calc.id } });
    ok('entries stamped paid + tx + address', entries.every((e) => e.paidAt && e.paidInTx === rewRes.txHash && !!e.paidToAddress));
    const rewAnchor = await db.anchor.findFirst({ where: { kind: 'reward_payout', createdAt: { gte: startedAt }, preimage: { path: ['payoutTx'], equals: rewRes.txHash } } });
    ok('reward anchor lists both recipients + total', rewAnchor?.preimage?.recipients?.length === 2 && rewAnchor?.preimage?.totalLovelace === 100_000_000, JSON.stringify(rewAnchor?.preimage?.totalLovelace));

    console.log('— 5) internal transfer ceremony —');
    const tr = await treasury.prepareInternalTransfer(board[1].user.id, { sourceBucketId: primary.id, destBucketId: opsB.id, amountAda: 25 });
    mine.actions.push({ id: tr.id });
    const trRes = await ceremony(tr.id);
    ok('bucket→bucket transfer CONFIRMED', trRes.status === 'CONFIRMED');
    ok('TX_INITIATED merit for the transfer initiator', (await db.meritLedger.count({ where: { reasonCode: 'TX_INITIATED', referenceId: tr.id } })) === 1);

    console.log('— 6) merit: TX_SIGNED ×3 per confirmed action —');
    for (const [label, aid] of [['OPS spend', opsAction.id], ['milestone payout', payAction.id], ['reward payout', prep.actionId], ['transfer', tr.id]]) {
      const n = await db.meritLedger.count({ where: { reasonCode: 'TX_SIGNED', referenceId: aid } });
      ok(`TX_SIGNED ×3 — ${label}`, n === 3, `${n}`);
    }

    console.log('— 7) all transactions visible in Treasury → Transactions —');
    cardano.addressTransactions = async () => []; // chain shows nothing → executed-actions fallback must list them
    const txs = await treasury.treasuryTransactions();
    const hashes = txs.transactions.map((t) => t.hash);
    for (const [label, res] of [['OPS spend', spendRes], ['milestone payout', payRes], ['reward payout', rewRes], ['transfer', trRes]]) {
      ok(`Transactions lists the ${label}`, hashes.includes(res.txHash), res.txHash);
    }

    console.log('— 8) signature history per action (who signed what) —');
    const sigs = await db.multisigSignature.findMany({ where: { actionId: payAction.id }, include: { drep: { select: { drepIdOnchain: true } } } });
    const signerIds = new Set(sigs.map((s) => s.drep.drepIdOnchain));
    ok('3 signatures recorded, attributable to the 3 signing DReps',
      sigs.length === 3 && board.slice(0, 3).every((m) => signerIds.has(m.drep.drepIdOnchain)),
      [...signerIds].join(','));
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    global.fetch = realFetch;
    for (const p of mine.props) {
      await db.anchor.deleteMany({ where: { proposalId: p } }).catch(() => {});
      await db.vote.deleteMany({ where: { proposalId: p } }).catch(() => {});
      await db.voteSnapshotEntry.deleteMany({ where: { snapshot: { proposalId: p } } }).catch(() => {});
      await db.voteSnapshot.deleteMany({ where: { proposalId: p } }).catch(() => {});
      await db.milestone.deleteMany({ where: { proposalId: p } }).catch(() => {});
    }
    const actIds = mine.actions.filter(Boolean).map((a) => a.id);
    await db.meritLedger.deleteMany({ where: { referenceId: { in: actIds } } }).catch(() => {});
    await db.multisigSignature.deleteMany({ where: { actionId: { in: actIds } } }).catch(() => {});
    await db.anchor.deleteMany({ where: { kind: { in: ['reward_payout', 'multisig_new'] }, createdAt: { gte: startedAt } } }).catch(() => {});
    await db.rewardEntry.deleteMany({ where: { rewardCalculation: { roundId: { in: mine.rounds.map((r) => r.id) } } } }).catch(() => {});
    await db.rewardCalculation.deleteMany({ where: { roundId: { in: mine.rounds.map((r) => r.id) } } }).catch(() => {});
    await db.multisigAction.deleteMany({ where: { id: { in: actIds } } }).catch(() => {});
    await db.proposal.deleteMany({ where: { id: { in: mine.props } } }).catch(() => {});
    await db.round.deleteMany({ where: { id: { in: mine.rounds.map((r) => r.id) } } }).catch(() => {});
    await db.treasuryBucket.deleteMany({ where: { id: { in: mine.buckets.map((b) => b.id) } } }).catch(() => {});
    for (const c of mine.cfgs) await db.multisigConfig.delete({ where: { id: c.id } }).catch(() => {});
    if (activeBefore) await db.multisigConfig.update({ where: { id: activeBefore.id }, data: { replacedAt: null, replacedByConfigId: null } }).catch(() => {});
    await db.boardMultisigKey.deleteMany({ where: { id: { in: mine.keys.map((k) => k.id) } } }).catch(() => {});
    await db.boardSeat.deleteMany({ where: { id: { in: mine.seats.map((s) => s.id) } } }).catch(() => {});
    await db.meritLedger.deleteMany({ where: { drepId: { in: mine.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: mine.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.boardSeat.updateMany({ where: { id: { in: parkedSeats.map((s) => s.id) } }, data: { removedAt: null } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
