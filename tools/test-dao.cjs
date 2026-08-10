/**
 * End-to-end DAO membership + voting-power test against the REAL services
 * (UsersService, DrepService) + dev DB + live Koios. Requires the 5-member
 * board to be seated. Cleans up the test applicant (Heidi) at the end so the
 * JOIN flow can be exercised manually afterwards.
 *
 *   node tools/test-dao.cjs
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

  const seats = await prisma.boardSeat.count();
  if (seats < 3) throw new Error(`need >=3 board seats (have ${seats}) — seat the board first`);

  // Simulate login for a persona → returns { userId, profile }.
  const login = async (key) => {
    const p = personas[key];
    const user = await users.upsertByStakeKey({
      stakeKeyHash: stakeKeyHashFromBech32(p.stakeAddress),
      stakeAddress: p.stakeAddress,
      drepKeyHash: p.drepKeyHash,
    });
    return { userId: user.id, profile: await users.getProfile(user.id) };
  };

  console.log('\n=== Board members are DAO members (no application) ===');
  const alice = await login('regular');
  const dave = await login('dave');
  const erin = await login('erin');
  for (const [name, m] of [['Alice', alice], ['Dave', dave], ['Erin', erin]]) {
    ok(`${name}: BOARD + DAO_MEMBER`, m.profile.roles.includes('BOARD') && m.profile.roles.includes('DAO_MEMBER'),
      m.profile.roles.join(','));
  }

  console.log('\n=== Non-board registered DRep (Heidi) ===');
  // clean any prior state for a deterministic run
  const heidiUser = await prisma.appUser.findUnique({ where: { stakeKeyHash: stakeKeyHashFromBech32(personas.heidi.stakeAddress) } });
  if (heidiUser) {
    const d = await prisma.drep.findUnique({ where: { userId: heidiUser.id } });
    if (d) {
      await prisma.admissionVote.deleteMany({ where: { drepId: d.id } });
      await prisma.roundDrepEligibility.deleteMany({ where: { drepId: d.id } }); // a round may list her as eligible (FK)
      await prisma.drep.delete({ where: { id: d.id } });
    }
  }
  const heidi = await login('heidi');
  ok('Heidi: DREP, not DAO_MEMBER, not BOARD',
    heidi.profile.roles.includes('DREP') && !heidi.profile.roles.includes('DAO_MEMBER') && !heidi.profile.roles.includes('BOARD'),
    heidi.profile.roles.join(','));

  console.log('\n=== Heidi requests to join → board 3-of-5 vote (rationale required) ===');
  const applied = await drep.apply(heidi.userId, { displayName: 'Heidi', bio: __bio100, country: 'Testland', subcategoryIds: ['governance'], contact: { telegram: '@heidi_t', email: 'heidi@test.io' } });
  ok('application is PENDING_ADMISSION', applied.status === 'PENDING_ADMISSION');

  // rationale required
  try { await drep.voteOnApplication(alice.userId, applied.id, { choice: 'YES', feedback: '' }); ok('empty rationale rejected', false); }
  catch (e) { ok('empty rationale rejected', /rationale is required/i.test(e.message)); }

  let r = await drep.voteOnApplication(alice.userId, applied.id, { choice: 'YES', feedback: 'Strong governance track record.' });
  ok('after 1 YES still pending', r.status === 'PENDING_ADMISSION', `yes=${r.yes}/${r.threshold}`);
  r = await drep.voteOnApplication(dave.userId, applied.id, { choice: 'YES', feedback: 'Agree, solid candidate.' });
  ok('after 2 YES still pending', r.status === 'PENDING_ADMISSION', `yes=${r.yes}`);
  r = await drep.voteOnApplication(erin.userId, applied.id, { choice: 'YES', feedback: 'Welcome aboard.' });
  ok('after 3 YES → ADMITTED', r.status === 'ADMITTED', `yes=${r.yes}/${r.threshold}`);

  console.log('\n=== Applicant view: sees votes + rationale + voter ===');
  const mine = await drep.getMine(heidi.userId);
  ok('getMine yes=3, threshold=3', mine.yes === 3 && mine.threshold === 3);
  ok('3 board votes with rationale + voter', mine.admissionVotesReceived.length === 3 && mine.admissionVotesReceived.every((v) => v.feedback && v.voterName));
  console.log('   sample vote:', JSON.stringify(mine.admissionVotesReceived[0]));

  console.log('\n=== Heidi is now a DAO member ===');
  const heidiAfter = await users.getProfile(heidi.userId);
  ok('Heidi role DAO_MEMBER, not BOARD', heidiAfter.roles.includes('DAO_MEMBER') && !heidiAfter.roles.includes('BOARD'),
    heidiAfter.roles.join(','));

  console.log('\n=== DAO members overview (voting power) ===');
  const members = await drep.listDaoMembers();
  console.log('   members:', members.map((m) => `${m.displayName}${m.isBoard ? '*' : ''}=${m.adjustedPower}`).join(', '));
  ok('Heidi appears in overview', members.some((m) => m.drepId === personas.heidi && true || m.displayName === 'Heidi'));
  ok('every member has voting-power fields', members.every((m) => typeof m.basePower === 'number' && typeof m.meritMultiplier === 'number' && typeof m.adjustedPower === 'number'));
  ok('board members flagged isBoard', members.some((m) => m.isBoard));

  console.log('\n=== Cleanup (remove Heidi so JOIN can be tested manually) ===');
  await prisma.admissionVote.deleteMany({ where: { drepId: applied.id } });
  await prisma.anchor.deleteMany({ where: { proposalId: applied.id } });
  await prisma.drep.delete({ where: { id: applied.id } });
  ok('Heidi reset to non-member', (await prisma.drep.findUnique({ where: { userId: heidi.userId } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
