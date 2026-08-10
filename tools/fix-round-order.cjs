/**
 * §5.1 consistency fix: a later-numbered round must never be further along than an
 * earlier one. The demo had Round Beta (#2) stuck in FILTERING while Round Gamma (#3,
 * newer) was already in FUNDING — impossible in practice. Swap the two rounds'
 * IDENTITY (number + name + createdAt) so the FUNDING round is the earlier #2 (Beta)
 * and the live FILTERING round is the newest #3 (Gamma). Proposals/votes/anchors stay
 * attached to their round id. Idempotent.
 *
 *   node tools/fix-round-order.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.NODE_ENV = 'production';
const { prisma } = require(root + '/packages/db/dist/index.js');

(async () => {
  const funding = await prisma.round.findFirst({ where: { status: 'FUNDING', name: { contains: 'demo' } } });
  const filtering = await prisma.round.findFirst({ where: { status: 'FILTERING', name: { contains: 'demo' } } });
  if (!funding || !filtering) {
    console.log('No demo FUNDING+FILTERING pair found — nothing to do.');
    await prisma.$disconnect();
    return;
  }
  if (funding.number < filtering.number) {
    console.log(`Already consistent: FUNDING #${funding.number} (${funding.name}) is earlier than FILTERING #${filtering.number} (${filtering.name}).`);
    await prisma.$disconnect();
    return;
  }

  // FUNDING is the more-advanced stage → it must take the LOWER (earlier) identity.
  const lowNum = filtering.number;   // currently the FILTERING round holds the lower number
  const highNum = funding.number;    // and FUNDING holds the higher — swap them
  const earlier = filtering.createdAt < funding.createdAt ? filtering.createdAt : funding.createdAt;
  const later = filtering.createdAt < funding.createdAt ? funding.createdAt : filtering.createdAt;

  await prisma.$transaction(async (tx) => {
    await tx.round.update({ where: { id: filtering.id }, data: { number: 99990 } }); // park (number is @unique)
    await tx.round.update({
      where: { id: funding.id },
      data: { number: lowNum, name: 'Round Beta (demo)', createdAt: earlier },
    });
    await tx.round.update({
      where: { id: filtering.id },
      data: { number: highNum, name: 'Round Gamma (demo)', createdAt: later },
    });
  });

  console.log(`Swapped: FUNDING round is now #${lowNum} "Round Beta (demo)" (created ${earlier.toISOString().slice(0,16)});`);
  console.log(`         FILTERING round is now #${highNum} "Round Gamma (demo)" (created ${later.toISOString().slice(0,16)}).`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
