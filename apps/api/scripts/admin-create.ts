/**
 * Bootstrap the first Platform Admin (§18.5). This is the only way to create
 * the initial admin; subsequent admins are added in-app by an existing admin.
 * Also usable as a last-resort recovery against a live DB.
 *
 *   pnpm admin:create -- --username=satucha --email=you@example.com [--password=...] [--require-2fa]
 *
 * Prints the password (if generated), the TOTP secret + QR, and 10 recovery codes (once).
 */
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaClient } from '@drep-dao/db';
import { AdminStatus } from '@drep-dao/shared';
import {
  generateRecoveryCodes,
  hashSecret,
  newTotpSecret,
} from '../src/admin/admin-crypto';

const prisma = new PrismaClient();
const MAX_ADMINS = 3;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main() {
  const username = arg('username');
  const email = arg('email');
  if (!username || !email) {
    console.error('Usage: pnpm admin:create -- --username=NAME --email=EMAIL [--password=PW] [--require-2fa]');
    process.exit(1);
  }

  const active = await prisma.adminUser.count({ where: { status: AdminStatus.ACTIVE } });
  if (active >= MAX_ADMINS) {
    console.error(`Refusing: ${active} active admins already (cap ${MAX_ADMINS}). Remove one first.`);
    process.exit(1);
  }

  const generatedPw = !arg('password');
  const password = arg('password') ?? randomBytes(12).toString('base64url');
  const require2fa = flag('require-2fa') || process.env.CARDANO_NETWORK === 'Mainnet';

  const passwordHash = await hashSecret(password);
  const totp = newTotpSecret(username);
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c)));

  const admin = await prisma.adminUser.create({
    data: {
      username,
      email,
      passwordHash,
      status: AdminStatus.ACTIVE,
      twoFa: { create: { totpSecret: totp.base32, enrolledAt: new Date(), required: require2fa } },
      recoveryCodes: { create: recoveryHashes.map((codeHash) => ({ codeHash })) },
    },
  });

  const qr = await QRCode.toString(totp.uri, { type: 'terminal', small: true });

  console.log('\n=== Platform Admin created ===\n');
  console.log(`  id:       ${admin.id}`);
  console.log(`  username: ${username}`);
  console.log(`  email:    ${email}`);
  if (generatedPw) console.log(`  password: ${password}   <-- generated, save it now`);
  console.log(`  2FA required: ${require2fa}`);
  console.log('\nScan this QR in your authenticator app (or use the secret below):\n');
  console.log(qr);
  console.log(`  TOTP secret: ${totp.base32}`);
  console.log('\nRecovery codes (each usable once — store securely, shown only now):');
  for (const c of recoveryCodes) console.log(`  ${c}`);
  console.log('\nLog in at /sysadmin/login (API: POST /api/v1/sysadmin/login).\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
