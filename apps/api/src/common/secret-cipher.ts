import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// SEC-02 — envelope-encrypt sensitive at-rest secrets (the anchor hot-wallet mnemonic, admin TOTP
// seeds, on-chain API tokens) with AES-256-GCM under a KEK from the environment (SECRET_ENC_KEY),
// so a DB read or a leaked backup no longer exposes them. Backward-compatible: decrypt() returns a
// legacy plaintext value unchanged, so migration is non-breaking and idempotent.
const PREFIX = 'enc:v1:';

function kek(): Buffer {
  const raw = process.env.SECRET_ENC_KEY;
  if (!raw) throw new Error('SECRET_ENC_KEY is not set — cannot encrypt/decrypt secrets (SEC-02)');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex'); // 32-byte hex
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64; // 32-byte base64
  return createHash('sha256').update(raw, 'utf8').digest(); // any other string → derive 32 bytes
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt an encrypted value; pass legacy plaintext through unchanged (returns null for null). */
export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext — backward compatible
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', kek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Fail-fast at startup: in production the KEK must be present and usable. */
export function assertSecretKek(): void {
  const isProd = process.env.NODE_ENV === 'production' || process.env.CARDANO_NETWORK === 'Mainnet';
  if (!isProd) return;
  const roundtrip = decryptSecret(encryptSecret('kek-selftest'));
  if (roundtrip !== 'kek-selftest') throw new Error('SECRET_ENC_KEY self-test failed (SEC-02)');
}
