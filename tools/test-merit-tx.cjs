/**
 * Service-level tests for treasury-action merit (§13.2):
 *   • TX_INITIATED + TX_SIGNED exist with +1 deltas in the shared table
 *   • a multisig action stores who initiated it (initiator_user_id)
 *   • the TX_INITIATED award is idempotent per action (no double-counting)
 *
 * Self-cleaning: creates a throwaway user/drep/action and deletes them.
 *   node tools/test-merit-tx.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.JOBS_DISABLED = '1';

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { MeritService } = require(root + '/apps/api/dist/merit/merit.service.js');
const { MERIT_DELTAS } = require(root + '/packages/shared/dist/index.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {
  const prisma = new PrismaService(config);
  const merit = new MeritService(prisma);

  console.log('— shared deltas —');
  ok('TX_INITIATED = +1', MERIT_DELTAS.TX_INITIATED === 1);
  ok('TX_SIGNED = +1', MERIT_DELTAS.TX_SIGNED === 1);

  const user = await db.appUser.create({ data: { stakeKeyHash: `tmt_${Date.now()}`, stakeAddress: 'stake_test_merit_tx' } });
  const drep = await db.drep.create({ data: { userId: user.id, drepIdOnchain: `drep_test_merit_tx_${Date.now()}`, status: 'ADMITTED' } });
  const action = await db.multisigAction.create({
    data: { kind: 'OPS', status: 'PENDING_SIGS', amountAda: 5n, destAddress: 'addr_test_merit_tx', description: 'merit-tx test', initiatorUserId: user.id },
  });

  try {
    console.log('— initiator tracking + idempotent award —');
    const stored = await db.multisigAction.findUnique({ where: { id: action.id }, select: { initiatorUserId: true } });
    ok('action stores initiatorUserId', stored?.initiatorUserId === user.id);

    // Same call combineAndSubmit makes once the tx reaches the network.
    const first = await merit.award(drep.id, 'TX_INITIATED', action.id);
    const second = await merit.award(drep.id, 'TX_INITIATED', action.id);
    ok('first TX_INITIATED award lands', first === true);
    ok('repeat award for the same action is a no-op', second === false);
    const rows = await db.meritLedger.findMany({ where: { drepId: drep.id, reasonCode: 'TX_INITIATED' } });
    ok('exactly one +1 ledger row', rows.length === 1 && Number(rows[0].delta) === 1);
  } finally {
    await db.meritLedger.deleteMany({ where: { drepId: drep.id } });
    await db.multisigAction.delete({ where: { id: action.id } }).catch(() => {});
    await db.drep.delete({ where: { id: drep.id } }).catch(() => {});
    await db.appUser.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }

  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
