/**
 * §14.4 removal flow: board proposes removing a DAO member, 3-of-5 vote removes
 * them, the member can re-apply. Cleans up Heidi at the end.
 *
 *   node tools/test-removal.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // automated suite must not submit on-chain anchor txs
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
  const __bio100 = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' '); // §14.3 — bio needs ≥100 words
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const drep = new DrepService(prisma, cardano);
  const login = async (key) => {
    const p = personas[key];
    const u = await users.upsertByStakeKey({ stakeKeyHash: stakeKeyHashFromBech32(p.stakeAddress), stakeAddress: p.stakeAddress, drepKeyHash: p.drepKeyHash });
    await users.getProfile(u.id);
    return u.id;
  };

  const alice = await login('regular');
  const dave = await login('dave');
  const erin = await login('erin');

  // Fresh Heidi → admit her.
  const hu = await prisma.appUser.findUnique({ where: { stakeKeyHash: stakeKeyHashFromBech32(personas.heidi.stakeAddress) } });
  if (hu) { const d = await prisma.drep.findUnique({ where: { userId: hu.id } }); if (d) { await prisma.drepRemovalVote.deleteMany({ where: { removal: { targetDrepId: d.id } } }); await prisma.drepRemoval.deleteMany({ where: { targetDrepId: d.id } }); await prisma.admissionVote.deleteMany({ where: { drepId: d.id } }); await prisma.roundDrepEligibility.deleteMany({ where: { drepId: d.id } }); await prisma.drep.delete({ where: { id: d.id } }); } }
  const heidi = await login('heidi');
  const app = await drep.apply(heidi, { displayName: 'Heidi', bio: __bio100, country: 'Testland', contact: { telegram: '@heidi_t', email: 'heidi@test.io' } });
  for (const b of [alice, dave, erin]) await drep.voteOnApplication(b, app.id, { choice: 'YES', feedback: 'ok' });
  ok('Heidi admitted', (await prisma.drep.findUnique({ where: { id: app.id } })).status === 'ADMITTED');

  console.log('\n=== Board proposes removal ===');
  ok('Heidi is in removable members', (await drep.listRemovableMembers()).some((m) => m.drepId === app.id));
  const removal = await drep.proposeRemoval(alice, app.id, 'Inactive');
  ok('removal pending', removal.status === 'PENDING');
  ok('duplicate propose rejected', await drep.proposeRemoval(alice, app.id).then(() => false).catch(() => true));
  ok('Heidi sees the removal vote', (await drep.getMyActiveRemoval(heidi)) !== null);

  console.log('\n=== Board votes 3-of-5 to remove ===');
  let r = await drep.voteRemoval(alice, removal.id, 'YES', 'inactive 3 months');
  ok('1 YES pending', r.status === 'PENDING', `yes=${r.yes}/${r.threshold}`);
  ok('empty rationale rejected', await drep.voteRemoval(dave, removal.id, 'YES', '').then(() => false).catch(() => true));
  r = await drep.voteRemoval(dave, removal.id, 'YES', 'agree');
  r = await drep.voteRemoval(erin, removal.id, 'YES', 'agree');
  ok('3 YES → APPROVED', r.status === 'APPROVED', `yes=${r.yes}/${r.threshold}`);
  ok('Heidi status REMOVED', (await prisma.drep.findUnique({ where: { id: app.id } })).status === 'REMOVED');

  console.log('\n=== Removed member can re-apply ===');
  const prof = await users.getProfile(heidi);
  ok('Heidi no longer DAO_MEMBER', !prof.roles.includes('DAO_MEMBER'), prof.roles.join(','));
  const reapp = await drep.apply(heidi, { displayName: 'Heidi', bio: __bio100, country: 'Testland', contact: { telegram: '@heidi_t', email: 'heidi@test.io' } });
  ok('re-application pending', reapp.status === 'PENDING_ADMISSION');

  console.log('\n=== Cleanup ===');
  await prisma.drepRemovalVote.deleteMany({ where: { removalId: removal.id } });
  await prisma.drepRemoval.deleteMany({ where: { targetDrepId: app.id } });
  await prisma.admissionVote.deleteMany({ where: { drepId: app.id } });
  await prisma.anchor.deleteMany({ where: { proposalId: app.id } });
  await prisma.drep.delete({ where: { id: app.id } });
  ok('Heidi reset', (await prisma.drep.findUnique({ where: { userId: heidi } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
