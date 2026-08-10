/**
 * Demo data top-up for the round-3 review:
 *  - admit two NON-board DReps (Heidi, Judy) so the members overview + voter base
 *    isn't only board members (seed shortcut: ADMITTED row, no on-chain admission);
 *  - add them to Round Beta (demo) eligibility so they can be drawn / vote there;
 *  - give the demo Expert (Ivan) expertise areas + a bio so the overview shows them.
 * Idempotent.
 *
 *   node tools/seed-demo-round3.cjs
 */
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
const { stakeKeyHashFromBech32, drepIdFromKeyHashHex } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');
const cfg = { get: (k) => process.env[k] };

(async () => {
  const prisma = new PrismaService(cfg);
  const users = new UsersService(prisma, new CardanoQueryService(cfg));

  const admit = async (key, name, subs, bio) => {
    const p = personas[key];
    const user = await users.upsertByStakeKey({
      stakeKeyHash: stakeKeyHashFromBech32(p.stakeAddress),
      stakeAddress: p.stakeAddress,
      drepKeyHash: p.drepKeyHash,
    });
    await prisma.appUser.update({ where: { id: user.id }, data: { displayName: name } });
    const drepIdOnchain = drepIdFromKeyHashHex(p.drepKeyHash);
    const data = { status: 'ADMITTED', admittedAt: new Date(), subcategoryIds: subs, bio };
    const existing = await prisma.drep.findUnique({ where: { userId: user.id } });
    const drep = existing
      ? await prisma.drep.update({ where: { id: existing.id }, data })
      : await prisma.drep.create({ data: { userId: user.id, drepIdOnchain, ...data } });
    console.log(`admitted ${name}: drep ${drep.id} (${drep.status})`);
    return drep;
  };

  const heidi = await admit('heidi', 'Heidi', ['defi', 'liquidity'], 'DeFi engineer; liquidity & AMM design.');
  const judy = await admit('judy', 'Judy', ['governance', 'tooling'], 'Governance researcher and tooling maintainer.');

  // Add them to the active FILTERING round's eligibility (by status, not name — names
  // get normalized so the newest round is the one filtering) so they can be drawn.
  const filtering = await prisma.round.findFirst({ where: { status: 'FILTERING', name: { contains: 'demo' } } });
  if (filtering) {
    for (const d of [heidi, judy]) {
      await prisma.roundDrepEligibility.upsert({
        where: { roundId_drepId: { roundId: filtering.id, drepId: d.id } },
        update: {},
        create: { roundId: filtering.id, drepId: d.id },
      });
    }
    console.log(`added Heidi + Judy to ${filtering.name} (filtering) eligibility`);
  }

  // Ivan (the demo Expert) — expertise areas + bio for the overview.
  const ivanUser = await prisma.appUser.findFirst({ where: { stakeKeyHash: stakeKeyHashFromBech32(personas.ivan.stakeAddress) } });
  if (ivanUser) {
    const ex = await prisma.expert.findFirst({ where: { userId: ivanUser.id } });
    if (ex) {
      await prisma.expert.update({
        where: { id: ex.id },
        data: { subcategoryIds: ['infrastructure', 'libraries'], bio: 'Infra & SRE; runs Cardano relays and indexers.' },
      });
      console.log('updated Ivan expert: infrastructure, libraries + bio');
    }
  }

  await prisma.$disconnect();
  console.log('✅ round-3 demo data seeded');
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
