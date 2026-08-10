/**
 * Write genesis.json for the 5-member founding board (Alice + Dave/Erin/Frank/
 * Grace) from their on-chain DRep IDs, then run it through the REAL
 * GenesisService: verify on-chain + seat. Idempotent (skips already-seated).
 * Run only AFTER tools/register-dreps.cjs reports all registered.
 *
 *   node tools/seat-board.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaService } = require('../apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require('../apps/api/dist/cardano/cardano-query.service.js');
const { GenesisService } = require('../apps/api/dist/admin/genesis.service.js');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const BOARD = [
  { key: 'regular', name: 'Alice (Founding Board)' },
  { key: 'dave', name: 'Dave (Founding Board)' },
  { key: 'erin', name: 'Erin (Founding Board)' },
  { key: 'frank', name: 'Frank (Founding Board)' },
  { key: 'grace', name: 'Grace (Founding Board)' },
];

const config = { get: (k) => process.env[k] };
const store = new Map();
const redis = { client: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; },
  async del(k) { return store.delete(k) ? 1 : 0; },
} };
const audit = { log: async () => {} };

(async () => {
  const genesis = {
    founding_board: BOARD.map((b) => ({
      name: b.name,
      drep_id: drepIdFromKeyHashHex(personas[b.key].drepKeyHash),
    })),
  };
  fs.writeFileSync(path.join(__dirname, '..', 'genesis.json'), JSON.stringify(genesis, null, 2) + '\n');
  console.log('genesis.json written with 5 board members:');
  for (const m of genesis.founding_board) console.log(`  ${m.name.padEnd(26)} ${m.drep_id}`);

  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const svc = new GenesisService(prisma, redis, cardano, audit);
  const admin = await prisma.adminUser.findFirst();
  if (!admin) throw new Error('no admin_user — run pnpm admin:create first');

  console.log('\nUploading + verifying on-chain…');
  await svc.upload(admin.id, genesis); // throws if any isn't a registered DRep
  const res = await svc.approve(admin.id);
  console.log(`Seated: +${res.seated}, board now ${res.boardCount}/${res.maxBoard}`);

  const seats = await prisma.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
  console.log('\nBoard seats:');
  for (const s of seats) console.log(`  ${s.displayName.padEnd(26)} ${s.drepId}`);

  await prisma.$disconnect();
  console.log(res.boardCount === 5 ? '\n✅ Full 5-member board seated.' : '\n⚠ board count != 5');
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
