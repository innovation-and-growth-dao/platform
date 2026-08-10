/**
 * §14 — the pre-election "FREE PERIOD": while NO board is seated, a registered DRep
 * whose profile passes every check joins the DAO AUTOMATICALLY (there is nobody to run
 * the 3-of-5 admission vote). Once a board is seated, new applications go back to the
 * normal board-approval flow. Submitter applications ALWAYS wait for board approval —
 * during the free period they queue until the first board exists.
 *
 * Covers:
 *   1. No board seated → entryEligibility reports freePeriod: true.
 *   2. apply() with a complete profile → ADMITTED immediately (admittedAt stamped),
 *      and the admission is anchored ("free period — no board elected").
 *   3. A submitter application in the free period stays PENDING; the public
 *      pending-count endpoint reports { count, boardElected: false }.
 *   4. Board seated again → apply() goes back to PENDING_ADMISSION (board approval),
 *      freePeriod: false, pending-count reports boardElected: true.
 *
 * Self-cleaning + restores the parked board roster.
 *   node tools/test-free-period.cjs
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
const { DrepService } = require(root + '/apps/api/dist/drep/drep.service.js');
const { SubmitterService } = require(root + '/apps/api/dist/submitter/submitter.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

const bio100 = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
const kh = (i) => 'cd'.repeat(27) + i.toString(16).padStart(2, '0'); // valid 56-hex key hash
const profile = (name) => ({
  displayName: name,
  bio: bio100,
  country: 'Testland',
  subcategoryIds: ['governance'],
  contact: { telegram: `@${name}`, email: `${name}@test.io` },
});

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const drep = new DrepService(prisma, cardano, anchor);
  let submitters;
  try { submitters = new SubmitterService(prisma, anchor); } catch { submitters = new SubmitterService(prisma); }

  const ts = Date.now();
  const startedAt = new Date();
  const mine = { users: [], dreps: [] };
  const mkUser = async (name, i) => {
    const u = await db.appUser.create({
      data: { stakeKeyHash: `fp_${name}_${ts}`, stakeAddress: `stake_fp_${name}_${ts}`, drepKeyHash: kh(i), drepRegistered: true, displayName: name },
    });
    mine.users.push(u);
    return u;
  };

  // Park the standing board → free period.
  const parked = await db.boardSeat.findMany({ where: { removedAt: null }, select: { id: true } });
  await db.boardSeat.updateMany({ where: { id: { in: parked.map((s) => s.id) } }, data: { removedAt: new Date() } });

  try {
    console.log('— 1) no board seated → free period —');
    const alice2 = await mkUser('fpjoiner', 1);
    const elig = await drep.entryEligibility(alice2.id);
    ok('entryEligibility reports freePeriod: true', elig.freePeriod === true);

    console.log('— 2) a complete profile joins AUTOMATICALLY —');
    const joined = await drep.apply(alice2.id, profile('fpjoiner'));
    mine.dreps.push(joined);
    ok('admitted immediately (no board vote)', joined.status === 'ADMITTED', joined.status);
    ok('admittedAt stamped', !!joined.admittedAt);
    const anchors = await db.anchor.findMany({ where: { kind: 'admission', createdAt: { gte: startedAt } } });
    const fp = anchors.find((a) => String(a.preimage?.event ?? '').includes('free period'));
    ok('admission anchored with the free-period event', !!fp && fp.preimage?.wallet?.kind === 'drep_id', JSON.stringify(fp?.preimage?.event));
    ok('member appears in the DAO overview', (await drep.listDaoMembers()).some((m) => m.displayName === 'fpjoiner'));

    console.log('— 3) submitter applications WAIT for a board —');
    const subUser = await mkUser('fpsubmitter', 2);
    const app = await submitters.apply(subUser.id, {
      displayName: 'fpsubmitter', country: 'Testland', agreePersist: true,
      description: bio100, conflictOfInterest: 'none', telegram: '@fpsubmitter', email: 'fpsubmitter@test.io',
    });
    ok('application stays PENDING (board approval required, board or not)', app.status === 'PENDING', app.status);
    const pc = await submitters.pendingPublicCount();
    ok('public pending count includes it + boardElected: false', pc.count >= 1 && pc.boardElected === false, JSON.stringify(pc));

    console.log('— 4) board seated again → back to board approval —');
    await db.boardSeat.updateMany({ where: { id: { in: parked.map((s) => s.id) } }, data: { removedAt: null } });
    const bob2 = await mkUser('fplater', 3);
    const elig2 = await drep.entryEligibility(bob2.id);
    ok('freePeriod: false once a board exists', elig2.freePeriod === false);
    const applied = await drep.apply(bob2.id, profile('fplater'));
    mine.dreps.push(applied);
    ok('application now PENDING_ADMISSION (3-of-5 board vote)', applied.status === 'PENDING_ADMISSION', applied.status);
    const pc2 = await submitters.pendingPublicCount();
    ok('pending count now reports boardElected: true', pc2.boardElected === true);
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    await db.anchor.deleteMany({ where: { kind: 'admission', createdAt: { gte: startedAt } } }).catch(() => {});
    await db.submitterApplicationHistory.deleteMany({ where: { userId: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.submitterApplication.deleteMany({ where: { userId: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.admissionVote.deleteMany({ where: { drepId: { in: mine.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: mine.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.boardSeat.updateMany({ where: { id: { in: parked.map((s) => s.id) } }, data: { removedAt: null } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
