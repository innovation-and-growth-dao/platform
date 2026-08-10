/**
 * Service-level tests for internal treasury transfers (§15.5):
 *   • board-only gate
 *   • source ≠ destination enforced; both must belong to the active multisig
 *   • a valid transfer creates a BOARD_TRANSFER action to the destination
 *     bucket's address with the initiator stamped (TX_INITIATED merit later)
 *
 * Self-cleaning: throwaway user/drep/board seat/multisig/buckets/action.
 *   node tools/test-internal-transfer.cjs
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
const { TreasuryBucketsService } = require(root + '/apps/api/dist/treasury/treasury-buckets.service.js');
const { TreasuryService } = require(root + '/apps/api/dist/treasury/treasury.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const buckets = new TreasuryBucketsService(prisma, config, cardano);
  const svc = new TreasuryService(prisma, config, cardano, anchor, buckets);

  const ts = Date.now();
  // Board member: user + drep + active seat keyed by drepKeyHash.
  const user = await db.appUser.create({ data: { stakeKeyHash: `tit_${ts}`, stakeAddress: 'stake_test_itx', drepKeyHash: `dkh_itx_${ts}` } });
  const drep = await db.drep.create({ data: { userId: user.id, drepIdOnchain: `drep_test_itx_${ts}`, status: 'ADMITTED' } });
  const seat = await db.boardSeat.create({ data: { drepId: drep.drepIdOnchain, drepKeyHash: user.drepKeyHash, displayName: 'itx tester' } });
  // Active multisig + two buckets (primary + labeled).
  const cfg = await db.multisigConfig.create({
    data: { scriptJson: { type: 'atLeast', required: 3, scripts: [] }, scriptHash: `sh_itx_${ts}`, bech32Address: `addr_test_itx_ms_${ts}`, threshold: 3, totalKeys: 5 },
  });
  const primary = await db.treasuryBucket.create({
    data: { configId: cfg.id, label: 'Primary', scriptJson: {}, scriptHash: `sh_itx_p_${ts}`, bech32Address: `addr_test_itx_ms_${ts}_p`, isPrimary: true },
  });
  const rewards = await db.treasuryBucket.create({
    data: { configId: cfg.id, label: 'Rewards', scriptJson: {}, scriptHash: `sh_itx_r_${ts}`, bech32Address: `addr_test_itx_ms_${ts}_r` },
  });

  let actionId = null;
  try {
    console.log('— gates —');
    await throws('non-board user refused', () => svc.prepareInternalTransfer('00000000-0000-4000-8000-000000000000', { sourceBucketId: primary.id, destBucketId: rewards.id, amountAda: 5 }), /board members only/);
    await throws('same source and destination refused', () => svc.prepareInternalTransfer(user.id, { sourceBucketId: primary.id, destBucketId: primary.id, amountAda: 5 }), /two different treasury addresses/);
    await throws('non-positive amount refused', () => svc.prepareInternalTransfer(user.id, { sourceBucketId: primary.id, destBucketId: rewards.id, amountAda: 0 }), /positive number/);
    await throws('foreign destination bucket refused', () => svc.prepareInternalTransfer(user.id, { sourceBucketId: primary.id, destBucketId: '00000000-0000-4000-8000-000000000000', amountAda: 5 }), /destination bucket/);

    console.log('— happy path —');
    const r = await svc.prepareInternalTransfer(user.id, { sourceBucketId: primary.id, destBucketId: rewards.id, amountAda: 7 });
    actionId = r.id;
    const action = await db.multisigAction.findUnique({ where: { id: r.id } });
    ok('BOARD_TRANSFER action queued', action?.kind === 'BOARD_TRANSFER' && action.status === 'PENDING_SIGS');
    ok('destination = the bucket address (never free-form)', action?.destAddress === rewards.bech32Address);
    ok('primary source stored as NULL (bare multisig script)', action?.sourceBucketId === null);
    ok('initiator stamped for TX_INITIATED merit', action?.initiatorUserId === user.id);
    ok('description names both ends', /Internal transfer: Primary → Rewards/.test(action?.description ?? ''));

    const r2 = await svc.prepareInternalTransfer(user.id, { sourceBucketId: rewards.id, destBucketId: primary.id, amountAda: 3 });
    const a2 = await db.multisigAction.findUnique({ where: { id: r2.id } });
    ok('labeled source keeps its bucket id', a2?.sourceBucketId === rewards.id);
    await db.multisigAction.delete({ where: { id: r2.id } });
  } finally {
    if (actionId) await db.multisigAction.delete({ where: { id: actionId } }).catch(() => {});
    await db.treasuryBucket.deleteMany({ where: { configId: cfg.id } });
    await db.multisigConfig.delete({ where: { id: cfg.id } }).catch(() => {});
    await db.boardSeat.delete({ where: { id: seat.id } }).catch(() => {});
    await db.drep.delete({ where: { id: drep.id } }).catch(() => {});
    await db.appUser.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }

  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
