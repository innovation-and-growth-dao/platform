/**
 * Recovery tool — when `tools/seat-board.cjs` can't reach Koios (rate-limit) but
 * the personas + their on-chain DRep registrations are known-good, this script
 * re-seats the 5 founding board members by **direct DB insert**, bypassing the
 * on-chain verification step. Idempotent (upserts by drepKeyHash).
 *
 * Use only when the board has been wiped (e.g. test-genesis crashed mid-run on a
 * Koios 429) and you can't wait for the rate-limit window. For a fresh install
 * always prefer `seat-board.cjs`.
 *
 *   node tools/restore-board-from-personas.cjs
 */
const path = require('node:path');
const { prisma } = require(path.join(__dirname, '..', 'packages', 'db', 'dist', 'index.js'));
const { drepIdFromKeyHashHex } = require(path.join(__dirname, '..', 'packages', 'cardano', 'dist', 'index.js'));
const personas = require('./persona-wallets.json');

const BOARD = [
  { key: 'regular', name: 'Alice (Founding Board)' },
  { key: 'dave', name: 'Dave (Founding Board)' },
  { key: 'erin', name: 'Erin (Founding Board)' },
  { key: 'frank', name: 'Frank (Founding Board)' },
  { key: 'grace', name: 'Grace (Founding Board)' },
];

(async () => {
  let seated = 0;
  for (const b of BOARD) {
    const drepKeyHash = personas[b.key]?.drepKeyHash;
    if (!drepKeyHash) { console.error(`missing persona key: ${b.key}`); continue; }
    const drepId = drepIdFromKeyHashHex(drepKeyHash);
    await prisma.boardSeat.upsert({
      where: { drepKeyHash },
      update: { drepId, displayName: b.name },
      create: { drepKeyHash, drepId, displayName: b.name },
    });
    console.log(`  ✓ ${b.name}`);
    seated++;
  }
  const total = await prisma.boardSeat.count();
  console.log(`\nRestored ${seated} seats. Board now: ${total} / 5.`);
  await prisma.$disconnect();
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
