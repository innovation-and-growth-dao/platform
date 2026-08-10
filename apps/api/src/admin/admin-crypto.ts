import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Secret, TOTP } from 'otpauth';

/** Argon2id hashing for passwords and recovery codes (§18.4). */
export function hashSecret(secret: string): Promise<string> {
  return hash(secret, { algorithm: Algorithm.Argon2id });
}

export function verifySecret(hashStr: string, secret: string): Promise<boolean> {
  return verify(hashStr, secret).catch(() => false);
}

/** 10 one-time recovery codes (shown once at enrollment). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(8).toString('hex'); // 16 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`);
  }
  return codes;
}

const TOTP_PARAMS = { issuer: 'DRep DAO', digits: 6, period: 30 } as const;

/** New TOTP secret + provisioning URI (for the authenticator QR). */
export function newTotpSecret(username: string): { base32: string; uri: string } {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({ ...TOTP_PARAMS, label: username, secret });
  return { base32: secret.base32, uri: totp.toString() };
}

/** Verify a TOTP code against a stored base32 secret (±1 step window). */
export function verifyTotp(base32: string, token: string): boolean {
  try {
    const totp = new TOTP({ ...TOTP_PARAMS, secret: Secret.fromBase32(base32) });
    return totp.validate({ token: token.trim(), window: 1 }) !== null;
  } catch {
    return false;
  }
}
