/**
 * GENESIS BOARD SEED — an operator action, not in-app governance (§17).
 * Seats initial board members (Drep status ADMITTED + active BoardMembership)
 * from their bech32 stake addresses. After genesis, board changes go through
 * governance (removal proposals, future elections).
 *
 * Usage:
 *   pnpm bootstrap:board                      # seats BOARD accounts from tools/test-wallets.json
 *   pnpm bootstrap:board stake_test1... ...   # seats the given stake addresses
 *
 * The on-chain DRep ID is a placeholder until CIP-95 reconciliation; that's
 * fine for MVP, where the autonomous on-chain gate is deferred (§27.2).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { DRepStatus } from '@drep-dao/shared';

const prisma = new PrismaClient();

function resolveStakeAddresses(): string[] {
  const args = process.argv.slice(2).filter((a) => a.startsWith('stake'));
  if (args.length > 0) return args;

  const file = path.join(__dirname, '..', '..', '..', 'tools', 'test-wallets.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      'No stake addresses given and tools/test-wallets.json not found. ' +
        'Run `node tools/gen-test-wallets.cjs` or pass stake addresses as arguments.',
    );
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    wallets: { role: string; stakeAddress: string }[];
  };
  return data.wallets.filter((w) => w.role.startsWith('BOARD')).map((w) => w.stakeAddress);
}

async function seatBoardMember(stakeAddress: string): Promise<void> {
  const stakeKeyHash = stakeKeyHashFromBech32(stakeAddress);

  const user = await prisma.appUser.upsert({
    where: { stakeKeyHash },
    update: { stakeAddress },
    create: { stakeKeyHash, stakeAddress },
  });

  const drep = await prisma.drep.upsert({
    where: { userId: user.id },
    update: { status: DRepStatus.ADMITTED, admittedAt: new Date() },
    create: {
      userId: user.id,
      drepIdOnchain: `genesis:${stakeKeyHash}`,
      status: DRepStatus.ADMITTED,
      admittedAt: new Date(),
    },
  });

  const active = await prisma.boardMembership.findFirst({
    where: { drepId: drep.id, endedAt: null },
  });
  if (!active) {
    await prisma.boardMembership.create({ data: { drepId: drep.id, startedAt: new Date() } });
  }

  console.log(`  seated board member: ${stakeAddress}`);
}

async function main() {
  const addresses = resolveStakeAddresses();
  console.log(`Seating ${addresses.length} genesis board member(s)…`);
  for (const addr of addresses) await seatBoardMember(addr);

  const count = await prisma.boardMembership.count({ where: { endedAt: null } });
  console.log(`Active board members now: ${count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
