/**
 * §15.2 — service-level tests for the BOARD HAND-OVER: after a new board is elected
 * and installed, the treasury multisig migrates from the OLD board's wallet to the
 * NEW board's wallet. Covers:
 *
 *   1. First assembly: all seats keyed → tryAssemble (via status()) builds the native
 *      script + address, and anchors the "New multisig prepared" proof (signers list).
 *   2. Rotation: election swaps the seats (a RETURNING member's key carries over —
 *      they don't have to re-submit an identical key); rotationInProgress is flagged.
 *   3. "Submit your key" reminder (JobsService.remindMultisigKeys): notifies exactly
 *      the seats still awaiting a key (not the carry-over member), deduped per seat.
 *   4. Second assembly: platform stamps the old config replaced, anchors proof #1 for
 *      the new wallet, and AUTO-CREATES the FUND MIGRATION actions — one per funded
 *      source (old main address + each labeled bucket) → the NEW PRIMARY address.
 *   5. Idempotency: preparing again reuses the open migrations (no duplicates).
 *   6. resolveSource: a bucket migration spends from the bucket's address with the
 *      bucket's wrapped script, but signs with the OLD board's keys.
 *   7. Confirmation: once the migrations confirm and the old wallet drains, the old
 *      config reads terminated (date = migration paidAt); the migration proof
 *      ("Funds moved from old multisig to the new multisig") records every move.
 *
 * All balances are stubbed (no Koios dependency); the anchor hot wallet is unset so
 * anchors are recorded (txHash null) without submitting. Self-cleaning + restores the
 * pre-test board roster and any pre-existing active multisig config.
 *
 *   node tools/test-multisig-migration.cjs
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
const { BoardMultisigService } = require(root + '/apps/api/dist/treasury/board-multisig.service.js');
const { MultisigBroadcastService } = require(root + '/apps/api/dist/treasury/multisig-broadcast.service.js');
const { NotificationsService } = require(root + '/apps/api/dist/notifications/notifications.service.js');
const { JobsService } = require(root + '/apps/api/dist/jobs/jobs.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

// Valid 28-byte (56-hex) payment key hashes — CSL parses them into the native script.
const kh = (i) => 'ab'.repeat(27) + i.toString(16).padStart(2, '0');

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const svc = new BoardMultisigService(prisma, config, cardano, undefined, anchor);
  const broadcast = new MultisigBroadcastService(prisma, config, anchor, cardano, /* pledgeReturn */ {});
  const notify = new NotificationsService(prisma);
  const jobs = new JobsService(prisma, cardano, anchor, notify, /* buckets */ {}, /* quickPolls */ {});

  const ts = Date.now();
  const startedAt = new Date();
  let balances = new Map(); // address → lovelace bigint (stub)
  cardano.addressBalance = async (addrs) => new Map(addrs.map((a) => [a, balances.get(a) ?? 0n]));

  // ── isolate: park the standing board + remember any pre-existing active config ──
  const parkedSeats = await db.boardSeat.findMany({ where: { removedAt: null }, select: { id: true } });
  await db.boardSeat.updateMany({ where: { id: { in: parkedSeats.map((s) => s.id) } }, data: { removedAt: new Date() } });
  const activeBefore = await db.multisigConfig.findFirst({ where: { replacedAt: null } });

  const mine = { users: [], dreps: [], seats: [], keys: [], configs: [], buckets: [], actions: [] };
  const mkMember = async (name, i, { seatKey } = { seatKey: true }) => {
    const user = await db.appUser.create({ data: { stakeKeyHash: `msm_${name}_${ts}`, stakeAddress: `stake_msm_${name}_${ts}`, drepKeyHash: `dkh_msm_${name}_${ts}`, displayName: name } });
    const drep = await db.drep.create({ data: { userId: user.id, drepIdOnchain: `drep_msm_${name}_${ts}`, status: 'ADMITTED' } });
    const seat = await db.boardSeat.create({ data: { drepId: drep.drepIdOnchain, drepKeyHash: user.drepKeyHash, displayName: name } });
    mine.users.push(user); mine.dreps.push(drep); mine.seats.push(seat);
    let key = null;
    if (seatKey) {
      key = await db.boardMultisigKey.create({
        data: { boardSeatId: seat.id, userId: user.id, paymentKeyHash: kh(i), paymentBech32: `addr_test_msm_${name}_${ts}`, hardwareAttested: true, attestationSignature: 'sig', attestationKey: 'key', attestationTs: new Date().toISOString() },
      });
      mine.keys.push(key);
    }
    return { user, drep, seat, key };
  };

  try {
    console.log('— 1) old board assembles its multisig (status() triggers assembly) —');
    const A = await mkMember('A', 1), B = await mkMember('B', 2), C = await mkMember('C', 3);
    let st = await svc.status();
    ok('all keys in → multisig assembled on status refresh', !!st.active, st.active?.bech32Address);
    ok('3-of-3 script (threshold clamped to key count)', st.active?.threshold === 3 && st.active?.totalKeys === 3);
    const cfgA = await db.multisigConfig.findUnique({ where: { id: st.active.id } });
    mine.configs.push(cfgA);
    ok('script address derived (addr_test1…)', /^addr_test1/.test(cfgA.bech32Address));
    const newAnchors1 = await db.anchor.findMany({ where: { kind: 'multisig_new', createdAt: { gte: startedAt } } });
    ok('proof #1 anchored: "New multisig prepared"', newAnchors1.length === 1);
    ok('proof lists every signer (DRep id + provided address)',
      newAnchors1[0]?.preimage?.signers?.length === 3 &&
      newAnchors1[0].preimage.signers.some((s) => s.drep === A.drep.drepIdOnchain && s.address === `addr_test_msm_A_${ts}`),
      JSON.stringify(newAnchors1[0]?.preimage?.signers));

    // Old board's buckets: the primary (same address) + a labeled Rewards bucket.
    const primary = await db.treasuryBucket.create({ data: { configId: cfgA.id, label: '', scriptJson: {}, scriptHash: `msm_shp_${ts}`, bech32Address: cfgA.bech32Address, isPrimary: true } });
    const rewardsB = await db.treasuryBucket.create({ data: { configId: cfgA.id, label: 'Rewards', scriptJson: { type: 'all', scripts: [] }, scriptHash: `msm_shr_${ts}`, bech32Address: `addr_test_msm_rewards_${ts}` } });
    mine.buckets.push(primary, rewardsB);

    console.log('— 2) election installs a new board (A returns; D + E are new) —');
    await db.boardSeat.updateMany({ where: { id: { in: [A.seat.id, B.seat.id, C.seat.id] } }, data: { removedAt: new Date() } });
    // Returning member A gets a NEW seat with the same drepKeyHash — no key row (carry-over).
    const seatA2 = await db.boardSeat.create({ data: { drepId: A.drep.drepIdOnchain, drepKeyHash: A.user.drepKeyHash, displayName: 'A' } });
    mine.seats.push(seatA2);
    const D = await mkMember('D', 4, { seatKey: false }), E = await mkMember('E', 5, { seatKey: false });

    st = await svc.status();
    ok('rotation in progress (old wallet still active)', st.rotationInProgress === true && st.active?.id === cfgA.id);
    ok('carry-over key counts as submitted (returning member not re-asked)',
      st.seats.find((s) => s.seatId === seatA2.id)?.hasKey === true && st.submitted === 1, `submitted=${st.submitted}`);

    console.log('— 3) "submit your key" reminder — only the seats actually awaiting a key —');
    await jobs.remindMultisigKeys();
    await jobs.remindMultisigKeys(); // twice → must dedupe
    const reminders = await db.notification.findMany({ where: { kind: 'MULTISIG_KEY_NEEDED', userId: { in: [A.user.id, D.user.id, E.user.id] } } });
    ok('D and E notified once each; carry-over A not nagged',
      reminders.length === 2 && !reminders.some((n) => n.userId === A.user.id),
      `got ${reminders.length}`);

    console.log('— 4) new keys land → new multisig assembles → funds auto-migrate —');
    balances = new Map([[cfgA.bech32Address, 10_000_000n], [rewardsB.bech32Address, 5_000_000n]]);
    for (const [m, i] of [[D, 4], [E, 5]]) {
      mine.keys.push(await db.boardMultisigKey.create({
        data: { boardSeatId: m.seat.id, userId: m.user.id, paymentKeyHash: kh(i), paymentBech32: `addr_test_msm_${m.user.displayName}_${ts}`, hardwareAttested: true, attestationSignature: 'sig', attestationKey: 'key', attestationTs: new Date().toISOString() },
      }));
    }
    st = await svc.status();
    const cfgB = await db.multisigConfig.findUnique({ where: { id: st.active.id } });
    mine.configs.push(cfgB);
    ok('new multisig assembled (different script)', cfgB.id !== cfgA.id && cfgB.scriptHash !== cfgA.scriptHash);
    const cfgA2 = await db.multisigConfig.findUnique({ where: { id: cfgA.id } });
    ok('old config stamped replaced + linked to successor', !!cfgA2.replacedAt && cfgA2.replacedByConfigId === cfgB.id);
    const newAnchors2 = await db.anchor.findMany({ where: { kind: 'multisig_new', createdAt: { gte: startedAt } }, orderBy: { createdAt: 'asc' } });
    ok('proof #1 anchored again for the NEW wallet (carry-over address included)',
      newAnchors2.length === 2 && newAnchors2[1].preimage.signers.length === 3 &&
      newAnchors2[1].preimage.signers.some((s) => s.drep === A.drep.drepIdOnchain && s.address === `addr_test_msm_A_${ts}`));

    const migrations = await db.multisigAction.findMany({ where: { kind: 'MIGRATION', fromConfigId: cfgA.id }, orderBy: { createdAt: 'asc' } });
    mine.actions.push(...migrations);
    ok('one FUND MIGRATION per funded source (main + Rewards bucket)', migrations.length === 2, `${migrations.length}`);
    const mainMig = migrations.find((m) => m.sourceBucketId === null);
    const rewMig = migrations.find((m) => m.sourceBucketId === rewardsB.id);
    ok('main migration: full balance → NEW PRIMARY address',
      mainMig?.amountAda === 10_000_000n && mainMig?.destAddress === cfgB.bech32Address && mainMig?.toConfigId === cfgB.id);
    ok('bucket migration: bucket balance → NEW PRIMARY address (new board re-buckets later)',
      rewMig?.amountAda === 5_000_000n && rewMig?.destAddress === cfgB.bech32Address);
    ok('history labels name the source ("Rewards bucket → new primary address")',
      mainMig?.description === 'Primary treasury → new primary address' && rewMig?.description === 'Rewards bucket → new primary address',
      JSON.stringify([mainMig?.description, rewMig?.description]));

    console.log('— 5) idempotency: preparing again reuses the open migrations —');
    const again = await svc.prepareMigration(D.user.id, cfgA.id);
    const migCount = await db.multisigAction.count({ where: { kind: 'MIGRATION', fromConfigId: cfgA.id } });
    ok('no duplicate migrations (existing reused)', again.created === 0 && again.existing === 2 && migCount === 2, JSON.stringify(again));

    console.log('— 6) resolveSource: bucket migration signs with the OLD board keys from the bucket address —');
    const src = await broadcast.resolveSource(rewMig);
    ok('spends FROM the bucket address with the bucket script', src.bech32Address === rewardsB.bech32Address && src.scriptHash === rewardsB.scriptHash);
    const oldKeys = [kh(1), kh(2), kh(3)].sort();
    ok('signing keys = the OLD board (their keyhashes are in the old script)', JSON.stringify([...src.keyHashes].sort()) === JSON.stringify(oldKeys), JSON.stringify(src.keyHashes));

    console.log('— 7) migrations confirm → old multisig terminates + move proof anchored —');
    const paidAt = new Date();
    for (const [m, tx] of [[mainMig, 'tx_mig_main'], [rewMig, 'tx_mig_rewards']]) {
      await db.multisigAction.update({ where: { id: m.id }, data: { status: 'CONFIRMED', txHash: tx, paidAt } });
    }
    balances = new Map(); // everything drained
    st = await svc.status();
    const oldInHistory = st.history.find((h) => h.id === cfgA.id);
    ok('old config listed in history with 0 balance', !!oldInHistory && oldInHistory.balanceAda === 0);
    ok('terminated date = the migration tx paid date', !!oldInHistory?.terminatedAt && Math.abs(new Date(oldInHistory.terminatedAt).getTime() - paidAt.getTime()) < 2000);
    ok('no migrations pending anymore', st.migrationsPending.length === 0);

    const mig = await anchor.anchorMultisigMigration({
      newAddress: cfgB.bech32Address,
      moves: [
        { from: cfgA.bech32Address, lovelace: 10_000_000, tx: 'tx_mig_main' },
        { from: rewardsB.bech32Address, lovelace: 5_000_000, tx: 'tx_mig_rewards' },
      ],
    });
    ok('proof #2 recorded ("Funds moved from old multisig to the new multisig")', !!mig.hash && mig.submitted === false);
    const migAnchor = await db.anchor.findFirst({ where: { kind: 'multisig_migration', createdAt: { gte: startedAt } } });
    ok('proof #2 JSON: old addresses + amounts + tx ids + new address',
      migAnchor?.preimage?.newAddress === cfgB.bech32Address &&
      migAnchor?.preimage?.moves?.length === 2 &&
      migAnchor.preimage.totalLovelace === 15_000_000 &&
      migAnchor.preimage.moves.some((m) => m.from === rewardsB.bech32Address && m.tx === 'tx_mig_rewards'),
      JSON.stringify(migAnchor?.preimage));
  } catch (e) {
    console.error('crashed:', e);
    fail++;
  } finally {
    // ── cleanup (reverse order) + restore parked state ──
    await db.notification.deleteMany({ where: { kind: 'MULTISIG_KEY_NEEDED', userId: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.anchor.deleteMany({ where: { kind: { in: ['multisig_new', 'multisig_migration'] }, createdAt: { gte: startedAt } } }).catch(() => {});
    await db.multisigAction.deleteMany({ where: { kind: 'MIGRATION', fromConfigId: { in: mine.configs.map((c) => c.id) } } }).catch(() => {});
    await db.treasuryBucket.deleteMany({ where: { id: { in: mine.buckets.map((b) => b.id) } } }).catch(() => {});
    // Break the succession link before deleting; also un-stamp any pre-existing config we replaced.
    await db.multisigConfig.updateMany({ where: { id: { in: mine.configs.map((c) => c.id) } }, data: { replacedByConfigId: null } }).catch(() => {});
    if (activeBefore) await db.multisigConfig.update({ where: { id: activeBefore.id }, data: { replacedAt: null, replacedByConfigId: null } }).catch(() => {});
    for (const c of mine.configs.reverse()) await db.multisigConfig.delete({ where: { id: c.id } }).catch(() => {});
    await db.boardMultisigKey.deleteMany({ where: { id: { in: mine.keys.map((k) => k.id) } } }).catch(() => {});
    await db.boardSeat.deleteMany({ where: { id: { in: mine.seats.map((s) => s.id) } } }).catch(() => {});
    await db.drep.deleteMany({ where: { id: { in: mine.dreps.map((d) => d.id) } } }).catch(() => {});
    await db.appUser.deleteMany({ where: { id: { in: mine.users.map((u) => u.id) } } }).catch(() => {});
    await db.boardSeat.updateMany({ where: { id: { in: parkedSeats.map((s) => s.id) } }, data: { removedAt: null } }).catch(() => {});
    await db.$disconnect();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(fail ? `\n❌ ${fail} failed` : '\n✅ all passed');
  process.exit(fail ? 1 : 0);
})();
