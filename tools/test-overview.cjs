/**
 * Verifies (1) DAO overview voting power is non-zero from real on-chain stake,
 * and (2) the Expert apply → board approve flow. Warms board logins so all 5
 * appear with stake. Cleans up the test expert (Carol) at the end.
 *
 *   node tools/test-overview.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { DrepService } = require(root + '/apps/api/dist/drep/drep.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const drep = new DrepService(prisma, cardano);

  const login = async (key) => {
    const p = personas[key];
    const u = await users.upsertByStakeKey({
      stakeKeyHash: stakeKeyHashFromBech32(p.stakeAddress),
      stakeAddress: p.stakeAddress,
      drepKeyHash: p.drepKeyHash,
    });
    await users.getProfile(u.id); // materialize board ADMITTED row
    return u.id;
  };

  console.log('\n=== Warm board logins (all 5 get rows + stake addresses) ===');
  for (const k of ['regular', 'dave', 'erin', 'frank', 'grace']) await login(k);
  ok('done', true);

  console.log('\n=== DAO overview — voting power from on-chain stake ===');
  const members = await drep.listDaoMembers();
  for (const m of members) {
    console.log(`   ${m.displayName}${m.isBoard ? '*' : ''}: stake=${m.votingPowerAda} ADA, base=${m.basePower}, merit=${m.merit}, ×${m.meritMultiplier} → power=${m.adjustedPower}`);
  }
  // Match the Alice persona by her stable DRep ID — the board seat's displayName
  // is whatever genesis seeded (the persona key), not necessarily the label.
  const alice = members.find((m) => m.drepId === personas.regular.drepId);
  ok('5 board members listed', members.filter((m) => m.isBoard).length === 5, `${members.filter((m) => m.isBoard).length} board`);
  ok('Alice voting power > 0 (real on-chain stake)', alice && alice.adjustedPower > 0, alice ? `power=${alice.adjustedPower}` : 'missing');
  ok('Alice base ≈ log10(stake)', alice && Math.abs(alice.basePower - Math.log10(alice.votingPowerAda)) < 0.05);
  ok('every member has a "since" date', members.every((m) => !!m.since), alice ? new Date(alice.since).toISOString().slice(0, 10) : '');

  console.log('\n=== Expert apply → board approve (Carol = ADA holder) ===');
  const carol = await login('holder');
  // clean prior
  const prior = await prisma.expert.findFirst({ where: { userId: carol } });
  if (prior) await prisma.expert.delete({ where: { id: prior.id } });
  const applied = await drep.applyExpert(carol, { displayName: 'Carol', bio: 'QA + tooling', subcategoryIds: ['tooling'], conflictOfInterest: 'None.', email: 'carol@test.io', telegram: '@carol_t' });
  ok('expert application pending', applied.approvedByBoard === false);
  const pendingList = await drep.listExpertApplications();
  ok('appears in board pending list', pendingList.some((e) => e.id === applied.id));
  ok('not yet in approved dashboard list', !(await drep.listApprovedExperts()).some((e) => e.id === applied.id));
  await drep.approveExpertById(applied.id);
  ok('approved → in dashboard experts', (await drep.listApprovedExperts()).some((e) => e.id === applied.id));
  ok('approved → out of pending list', !(await drep.listExpertApplications()).some((e) => e.id === applied.id));

  console.log('\n=== Cleanup (remove Carol expert so apply can be tested manually) ===');
  await prisma.expert.delete({ where: { id: applied.id } }).catch(() => {});
  ok('Carol expert removed', (await prisma.expert.findFirst({ where: { userId: carol } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
