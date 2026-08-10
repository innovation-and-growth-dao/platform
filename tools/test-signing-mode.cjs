/**
 * Service-level tests for the TX_SIGNING_PROCESS platform parameter (§15/§20):
 *   • default (no DB row / garbage row) resolves to 1_PHASE
 *   • 1_PHASE: commitToSign refuses (no Authorize step), prepareTxBody skips the
 *     authorization gate, submitWitness skips the commit gate
 *   • 2_PHASE: prepareTxBody / submitWitness refuse until 3 commitments are in
 *   • governance updateParam rejects values other than 1_PHASE / 2_PHASE
 *
 * Self-cleaning: creates a throwaway multisig action + config row and deletes them.
 *   node tools/test-signing-mode.cjs
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
const { MultisigBroadcastService } = require(root + '/apps/api/dist/treasury/multisig-broadcast.service.js');
const { GovernanceService } = require(root + '/apps/api/dist/governance/governance.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  // pledgeReturn + merit are only touched at broadcast time, never in these gates.
  const svc = new MultisigBroadcastService(prisma, config, anchor, cardano, null, null);
  const gov = new GovernanceService(prisma);

  const setMode = (v) => v == null
    ? db.platformConfig.deleteMany({ where: { key: 'TX_SIGNING_PROCESS' } })
    : db.platformConfig.upsert({ where: { key: 'TX_SIGNING_PROCESS' }, update: { value: v }, create: { key: 'TX_SIGNING_PROCESS', value: v } });

  const action = await db.multisigAction.create({
    data: { kind: 'OPS', status: 'PENDING_SIGS', amountAda: 5n, destAddress: 'addr_test_signing_mode', description: 'signing-mode test' },
  });

  try {
    console.log('— mode resolution —');
    await setMode(null);
    ok('no row → 1_PHASE (default)', (await svc.signingMode()) === '1_PHASE');
    await setMode('2_PHASE');
    ok('row 2_PHASE → 2_PHASE', (await svc.signingMode()) === '2_PHASE');
    await setMode('garbage');
    ok('garbage row → falls back to 1_PHASE', (await svc.signingMode()) === '1_PHASE');

    console.log('— 2_PHASE gates (fallback ceremony) —');
    await setMode('2_PHASE');
    await throws('prepareTxBody refuses before 3 commitments', () => svc.prepareTxBody(action.id), /waiting on board authorizations/);
    await throws('submitWitness refuses before 3 commitments', () => svc.submitWitness(action.id, 'a0', 'no-such-user'), /authorization phase/);

    console.log('— 1_PHASE behaviour —');
    await setMode('1_PHASE');
    await throws('commitToSign refuses (no Authorize step in 1-phase)', () => svc.commitToSign(action.id, 'no-such-user', { signature: 'x', key: 'y', ts: 'z' }), /1-Phase signing is enabled/);
    // The authorization gate is gone — prepareTxBody proceeds straight to the
    // source-script lookup (and fails there in this DB, which has no multisig).
    await throws('prepareTxBody skips the authorization gate', () => svc.prepareTxBody(action.id), /no active multisig|no on-chain UTxOs/);

    console.log('— governance validation —');
    const admin = await db.appUser.create({ data: { stakeKeyHash: `tsm_${Date.now()}`, stakeAddress: 'stake_test_signing_mode' } });
    await throws('updateParam rejects an unknown value', () => gov.updateParam(admin.id, 'TX_SIGNING_PROCESS', '3_PHASE'), /must be 1_PHASE or 2_PHASE/);
    const upd = await gov.updateParam(admin.id, 'TX_SIGNING_PROCESS', '2_PHASE');
    ok('updateParam accepts 2_PHASE', upd.value === '2_PHASE');
    const params = await gov.getParams();
    const p = params.find((x) => x.key === 'TX_SIGNING_PROCESS');
    ok('param listed with 1_PHASE default + description', !!p && p.default === '1_PHASE' && /Eternl/.test(p.description));
    await db.appUser.delete({ where: { id: admin.id } });
  } finally {
    await db.multisigAction.delete({ where: { id: action.id } }).catch(() => {});
    await db.platformConfig.deleteMany({ where: { key: 'TX_SIGNING_PROCESS' } });
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }

  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
