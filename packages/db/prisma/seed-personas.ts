/**
 * Seed the test personas that aren't board members (those come from genesis):
 *  - account 5 → an ADMITTED DRep (NOT on the board) — for testing the plain DRep role.
 * Accounts 6/7 need no seeding: any wallet that logs in is a Viewer/Submitter.
 *
 *   pnpm seed:personas
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { drepIdFromKeyHashHex, stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { DRepStatus } from '@drep-dao/shared';

const prisma = new PrismaClient();

async function admitDrep(stakeAddress: string, drepKeyHash: string, displayName: string) {
  const stakeKeyHash = stakeKeyHashFromBech32(stakeAddress);
  const user = await prisma.appUser.upsert({
    where: { stakeKeyHash },
    update: { stakeAddress, displayName },
    create: { stakeKeyHash, stakeAddress, displayName },
  });
  const drepIdOnchain = drepIdFromKeyHashHex(drepKeyHash);
  await prisma.drep.upsert({
    where: { userId: user.id },
    update: { status: DRepStatus.ADMITTED, drepIdOnchain, admittedAt: new Date() },
    create: { userId: user.id, drepIdOnchain, status: DRepStatus.ADMITTED, admittedAt: new Date() },
  });
  console.log(`  admitted DRep (non-board): ${displayName} — ${stakeAddress}`);
}

async function main() {
  const file = path.join(__dirname, '..', '..', '..', 'tools', 'test-wallets.json');
  if (!fs.existsSync(file)) throw new Error('tools/test-wallets.json not found — run gen-test-wallets first');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    wallets: { accountIndex: number; stakeAddress: string; drepKeyHash: string }[];
  };
  const a5 = data.wallets.find((w) => w.accountIndex === 5);
  if (!a5) throw new Error('account 5 not found in test-wallets.json');

  await admitDrep(a5.stakeAddress, a5.drepKeyHash, 'Regular DRep (acct 5)');

  const board = await prisma.boardMembership.count({ where: { endedAt: null } });
  const dreps = await prisma.drep.count({ where: { status: DRepStatus.ADMITTED } });
  console.log(`Board members: ${board} · admitted DReps total: ${dreps}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
