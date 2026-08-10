/**
 * Genesis: loading the JSON file (all accepted formats), partial load (keep
 * valid / report invalid), manual add + remove board members, incremental
 * re-load. Runs against the REAL GenesisService (live Koios + dev DB) and
 * leaves the full 5-member board seated.
 *
 *   node tools/test-genesis.cjs
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
const { GenesisService } = require('../apps/api/dist/admin/genesis.service.js');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const config = { get: (k) => process.env[k] };
const store = new Map();
const redis = { client: {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async set(k, v) { store.set(k, v); return 'OK'; },
  async del(k) { return store.delete(k) ? 1 : 0; },
} };
const audit = { log: async () => {} };

const id = (key) => drepIdFromKeyHashHex(personas[key].drepKeyHash);
const UNREG = 'drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y'; // valid bech32, not registered

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
async function verifies(svc, A, label, payload, n) {
  try {
    const res = await svc.upload(A, payload);
    check(label, res.proposedBoard.length === n && res.invalid.length === 0, `${res.proposedBoard.length} verified`);
  } catch (e) {
    check(label, false, e.message);
  }
}
async function throws(label, fn, re) {
  try {
    await fn();
    check(label, false, 'unexpectedly accepted');
  } catch (e) {
    check(label, re.test(e.message), e.message);
  }
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const svc = new GenesisService(prisma, redis, cardano, audit);
  const admin = await prisma.adminUser.findFirst();
  if (!admin) throw new Error('no admin_user — run pnpm admin:create');
  const A = admin.id;

  await prisma.boardSeat.deleteMany({});
  await prisma.platformState.update({ where: { id: 1 }, data: { genesisApprovedAt: null, genesisApprovedBy: null, genesisPayload: null } }).catch(() => {});

  console.log('\n=== Loading the JSON file — accepted formats (3 registered DReps) ===');
  const three = ['regular', 'dave', 'erin'];
  await verifies(svc, A, 'array of { name, drep_id }', three.map((k) => ({ name: k, drep_id: id(k) })), 3);
  await verifies(svc, A, '{ founding_board: [...] }', { founding_board: three.map((k) => ({ name: k, drep_id: id(k) })) }, 3);
  await verifies(svc, A, 'name → drep_id map', Object.fromEntries(three.map((k) => [k, id(k)])), 3);
  await verifies(svc, A, 'array of [name, drep_id] pairs', three.map((k) => [k, id(k)]), 3);

  console.log('\n=== Partial load — keep valid, report invalid (no whole-file rejection) ===');
  const mixed = [
    { name: 'Alice', drep_id: id('regular') },
    { name: 'BadFmt', drep_id: 'notadrep' }, // structurally invalid
    { name: 'Dave', drep_id: id('dave') },
    { name: 'Unreg', drep_id: UNREG }, // valid bech32, not a registered DRep
    { name: 'Erin', drep_id: id('erin') },
  ];
  const res = await svc.upload(A, mixed);
  check('3 valid kept', res.proposedBoard.length === 3, res.proposedBoard.map((m) => m.name).join(','));
  check('2 invalid reported', res.invalid.length === 2);
  check('garbage id → bech32 reason', res.invalid.some((m) => m.name === 'BadFmt' && /bech32/i.test(m.reason)));
  check('unregistered → not-registered reason', res.invalid.some((m) => m.name === 'Unreg' && /registered/i.test(m.reason)));
  const allBad = await svc.upload(A, [{ name: 'X', drep_id: 'notadrep' }]);
  check('all-invalid file: 0 valid, 1 invalid, no throw', allBad.proposedBoard.length === 0 && allBad.invalid.length === 1);
  await throws('empty file rejected', () => svc.upload(A, []), /no board members/i);
  await throws('unrecognized payload rejected', () => svc.upload(A, 42), /unrecognized|no board members/i);

  console.log('\n=== Manual add / remove (one at a time) ===');
  await prisma.boardSeat.deleteMany({});
  let st = await svc.addBoardMember(A, 'Alice', id('regular'));
  check('add Alice → board 1', st.boardCount === 1);
  st = await svc.addBoardMember(A, 'Dave', id('dave'));
  check('add Dave → board 2', st.boardCount === 2);
  await throws('duplicate add rejected', () => svc.addBoardMember(A, 'Alice again', id('regular')), /already a board member/i);
  await throws('add unregistered rejected', () => svc.addBoardMember(A, 'Fake', UNREG), /not registered/i);
  await throws('add garbage id rejected', () => svc.addBoardMember(A, 'X', 'notadrep'), /valid bech32/i);
  st = await svc.removeBoardMember(A, id('dave'));
  check('remove Dave → board 1', st.boardCount === 1);
  await throws('remove non-member rejected', () => svc.removeBoardMember(A, id('dave')), /not a current board member/i);

  console.log('\n=== Incremental re-load (3 then +2 = 5) ===');
  await prisma.boardSeat.deleteMany({});
  await svc.upload(A, three.map((k) => ({ name: k, drep_id: id(k) })));
  let ap = await svc.approve(A);
  check('first load seats 3', ap.seated === 3 && ap.boardCount === 3);
  const five = [...three, 'frank', 'grace'];
  await svc.upload(A, five.map((k) => ({ name: k, drep_id: id(k) })));
  ap = await svc.approve(A);
  check('re-load adds only the 2 new', ap.seated === 2 && ap.boardCount === 5, `seated ${ap.seated}, board ${ap.boardCount}`);

  await redis.client.del('admin:genesis:proposed');
  const seated = await prisma.boardSeat.count();
  check('ends with full 5-member board seated', seated === 5, `${seated} seats`);

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('crashed:', e);
  process.exit(1);
});
