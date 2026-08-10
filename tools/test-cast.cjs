/**
 * Full-cast role verification (read-mostly; does NOT mutate board seats).
 * For every actor in the fixed cast, simulate login (the REAL UsersService:
 * live Koios on-chain check + dev DB) and assert the derived roles:
 *
 *   5 board    (Alice, Dave, Erin, Frank, Grace) -> DREP + BOARD
 *   3 voting   (Heidi, Ivan, Judy)               -> DREP, not BOARD
 *   2 holders  (Bob, Carol)                       -> ADA holder, not DREP
 *
 * Also re-checks genesis verification (accept registered / reject unregistered)
 * WITHOUT approving, so the seated board is left untouched.
 *
 *   node tools/test-cast.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaService } = require('../apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require('../apps/api/dist/cardano/cardano-query.service.js');
const { UsersService } = require('../apps/api/dist/users/users.service.js');
const { GenesisService } = require('../apps/api/dist/admin/genesis.service.js');
const { stakeKeyHashFromBech32 } = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const config = { get: (k) => process.env[k] };
const store = new Map();
const redis = { client: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; },
  async del(k) { return store.delete(k) ? 1 : 0; },
} };
const audit = { log: async () => {} };

// key -> expected role set
const CAST = [
  { key: 'regular', label: 'Alice', expect: ['DREP', 'BOARD'] },
  { key: 'dave', label: 'Dave', expect: ['DREP', 'BOARD'] },
  { key: 'erin', label: 'Erin', expect: ['DREP', 'BOARD'] },
  { key: 'frank', label: 'Frank', expect: ['DREP', 'BOARD'] },
  { key: 'grace', label: 'Grace', expect: ['DREP', 'BOARD'] },
  { key: 'heidi', label: 'Heidi', expect: ['DREP'], not: ['BOARD'] },
  { key: 'ivan', label: 'Ivan', expect: ['DREP'], not: ['BOARD'] },
  { key: 'judy', label: 'Judy', expect: ['DREP'], not: ['BOARD'] },
  { key: 'board', label: 'Bob', expect: ['VIEWER'], not: ['DREP', 'BOARD', 'SUBMITTER'] }, // §2.1 — SUBMITTER is earned via an approved application, not default
  { key: 'holder', label: 'Carol', expect: ['VIEWER'], not: ['DREP', 'BOARD', 'SUBMITTER'] },
];

let failures = 0;
function check(label, cond, detail) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function loginAndProfile(users, persona) {
  const stakeKeyHash = stakeKeyHashFromBech32(persona.stakeAddress);
  const user = await users.upsertByStakeKey({
    stakeKeyHash,
    stakeAddress: persona.stakeAddress,
    drepKeyHash: persona.drepKeyHash, // undefined for the pure ADA holder (Carol)
  });
  return users.getProfile(user.id);
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);

  console.log('=== Full-cast role recognition (live Koios + dev DB) ===\n');
  for (const a of CAST) {
    const p = await loginAndProfile(users, personas[a.key]);
    const roles = p.roles;
    console.log(`[${a.label}] roles: ${roles.join(', ')} | registered=${p.onchainDrep.registered}`);
    for (const r of a.expect) check(`${a.label} has ${r}`, roles.includes(r));
    for (const r of a.not ?? []) check(`${a.label} NOT ${r}`, !roles.includes(r));
  }

  console.log('\n=== Genesis verification (non-mutating) ===\n');
  const genesis = new GenesisService(prisma, redis, cardano, audit);
  const admin = await prisma.adminUser.findFirst();
  const genesisFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'genesis.json'), 'utf8'));
  try {
    const res = await genesis.upload(admin.id, genesisFile);
    check('5-member genesis verifies on-chain', res.proposedBoard.length === 5, `${res.proposedBoard.length} verified`);
  } catch (e) {
    check('5-member genesis verifies on-chain', false, e.message);
  }
  // Partial load: an unregistered DRep is reported as invalid, not seated.
  const bad = await genesis.upload(admin.id, {
    founding_board: [{ name: 'Fake', drep_id: 'drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y' }],
  });
  check(
    'unregistered DRep excluded (0 valid, reported invalid)',
    bad.proposedBoard.length === 0 && bad.invalid.some((m) => /registered/i.test(m.reason)),
  );
  await redis.client.del('admin:genesis:proposed'); // clear the stash; do NOT approve

  const seats = await prisma.boardSeat.count();
  check('board still 5 seats (untouched)', seats === 5, `${seats} seats`);

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('test crashed:', e);
  process.exit(1);
});
