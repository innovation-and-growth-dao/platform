/**
 * Seat the two persona wallets from tools/persona-wallets.json:
 *   - regular → ADMITTED DRep (not board)
 *   - board   → ADMITTED DRep + active board member
 * DRep IDs are derived (CIP-105) from each wallet's DRep key.
 *
 *   pnpm seed:persona-wallets
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { drepIdFromKeyHashHex, stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { DRepStatus } from '@drep-dao/shared';

const prisma = new PrismaClient();

async function admit(stakeAddress: string, drepKeyHash: string, displayName: string, board: boolean) {
  const stakeKeyHash = stakeKeyHashFromBech32(stakeAddress);
  const user = await prisma.appUser.upsert({
    where: { stakeKeyHash },
    update: { stakeAddress, displayName },
    create: { stakeKeyHash, stakeAddress, displayName },
  });
  const drep = await prisma.drep.upsert({
    where: { userId: user.id },
    update: { status: DRepStatus.ADMITTED, drepIdOnchain: drepIdFromKeyHashHex(drepKeyHash), admittedAt: new Date() },
    create: {
      userId: user.id,
      drepIdOnchain: drepIdFromKeyHashHex(drepKeyHash),
      status: DRepStatus.ADMITTED,
      admittedAt: new Date(),
    },
  });
  if (board) {
    const active = await prisma.boardMembership.findFirst({ where: { drepId: drep.id, endedAt: null } });
    if (!active) await prisma.boardMembership.create({ data: { drepId: drep.id, startedAt: new Date() } });
  }
  console.log(`  ${board ? 'BOARD DRep ' : 'regular DRep'}: ${stakeAddress} → drep ${drep.drepIdOnchain}`);
}

async function main() {
  const file = path.join(__dirname, '..', '..', '..', 'tools', 'persona-wallets.json');
  if (!fs.existsSync(file)) throw new Error('tools/persona-wallets.json missing — run gen-persona-wallets first');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    regular: { stakeAddress: string; drepKeyHash: string };
    board: { stakeAddress: string; drepKeyHash: string };
  };
  await admit(data.regular.stakeAddress, data.regular.drepKeyHash, 'Alice', false);
  // The "board" wallet is the cast's funder (Bob) — NOT a seated board member; name it plainly
  // so the login card doesn't misleadingly read "Board DRep" for a non-board viewer.
  await admit(data.board.stakeAddress, data.board.drepKeyHash, 'Bob', true);

  const board = await prisma.boardMembership.count({ where: { endedAt: null } });
  const dreps = await prisma.drep.count({ where: { status: DRepStatus.ADMITTED } });
  console.log(`Board members: ${board} · admitted DReps: ${dreps}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
