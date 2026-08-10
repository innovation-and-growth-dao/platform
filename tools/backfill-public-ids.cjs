/**
 * One-off, idempotent: assign a structured publicId (R{round}-P{n}) to public proposals
 * that became ACTIVE before the publicId feature existed (so the "Proposal ID" shows in the
 * UI). Only fills nulls; never overwrites. Per-round sequence continues past existing ids.
 *
 *   node tools/backfill-public-ids.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { prisma: db } = require(root + '/packages/db/dist/index.js');

(async () => {
  // Statuses that mean the proposal has been public (publicId is assigned at activation).
  const PUBLIC = ['ACTIVE', 'APPROVED', 'FUNDING', 'COMPLETE', 'FAILED'];
  const rows = await db.proposal.findMany({
    where: { publicId: null, status: { in: PUBLIC } },
    orderBy: { createdAt: 'asc' },
    include: { round: { select: { number: true } } },
  });
  if (rows.length === 0) {
    console.log('Nothing to backfill — every public proposal already has a publicId.');
    await db.$disconnect();
    return;
  }
  const usedByRound = {};
  for (const p of rows) {
    if (usedByRound[p.roundId] === undefined) {
      usedByRound[p.roundId] = await db.proposal.count({ where: { roundId: p.roundId, publicId: { not: null } } });
    }
    usedByRound[p.roundId] += 1;
    const code = `R${p.round?.number ?? 0}-P${usedByRound[p.roundId]}`;
    await db.proposal.update({ where: { id: p.id }, data: { publicId: code } });
    console.log(`  ${code}  ←  "${p.title}" (${p.status})`);
  }
  console.log(`\n✅ Backfilled ${rows.length} proposal id(s).`);
  await db.$disconnect();
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
