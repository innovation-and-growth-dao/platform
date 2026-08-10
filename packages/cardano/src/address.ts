/**
 * Minimal bech32 decoding for Cardano stake addresses — just enough to derive
 * the stake credential hash from a verified bech32 address. Dependency-free so
 * the backend doesn't need the full serialization lib for wallet login.
 *
 * NOTE: the standard bech32 90-char limit is intentionally NOT enforced —
 * Cardano addresses routinely exceed it.
 */

import { blake2b } from 'blakejs';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i]!;
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod(hrpExpand(hrp).concat(data)) === 1;
}

export interface Bech32Decoded {
  hrp: string;
  /** 5-bit data words, checksum stripped. */
  words: number[];
}

export function bech32Decode(bech: string): Bech32Decoded {
  const lower = bech.toLowerCase();
  const upper = bech.toUpperCase();
  if (bech !== lower && bech !== upper) {
    throw new Error('bech32: mixed-case string');
  }
  const s = lower;
  const sep = s.lastIndexOf('1');
  if (sep < 1 || sep + 7 > s.length) {
    throw new Error('bech32: invalid separator position');
  }
  const hrp = s.slice(0, sep);
  const words: number[] = [];
  for (let i = sep + 1; i < s.length; i++) {
    const d = CHARSET.indexOf(s.charAt(i));
    if (d === -1) throw new Error('bech32: invalid character');
    words.push(d);
  }
  if (!verifyChecksum(hrp, words)) {
    throw new Error('bech32: invalid checksum');
  }
  return { hrp, words: words.slice(0, words.length - 6) };
}

/** Convert between bit groups (e.g. 5-bit bech32 words → 8-bit bytes). */
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error('bech32: invalid data range');
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    throw new Error('bech32: invalid padding');
  }
  return out;
}

/** Raw payload bytes of a bech32 address: 1 header byte + credential(s). */
export function addressBytes(bech: string): Uint8Array {
  const { words } = bech32Decode(bech);
  return Uint8Array.from(convertBits(words, 5, 8, false));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex: odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex: invalid');
    out[i] = byte;
  }
  return out;
}

function createChecksum(hrp: string, words: number[]): number[] {
  const values = hrpExpand(hrp).concat(words, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) out.push((mod >> (5 * (5 - i))) & 31);
  return out;
}

/** Encode 5-bit data words to a bech32 string (no length cap, for Cardano). */
export function bech32Encode(hrp: string, words: number[]): string {
  const combined = words.concat(createChecksum(hrp, words));
  let s = hrp + '1';
  for (const d of combined) s += CHARSET.charAt(d);
  return s;
}

/**
 * Bech32-encode a raw address from its hex (e.g. CIP-30 getRewardAddresses()
 * returns hex). hrp is derived from the network nibble: stake / stake_test.
 */
export function stakeAddressFromHex(hex: string): string {
  const bytes = fromHex(hex);
  if (bytes.length !== 29) {
    throw new Error(`unexpected stake address length: ${bytes.length} bytes`);
  }
  const network = (bytes[0] ?? 0) & 0x0f;
  const hrp = network === 1 ? 'stake' : 'stake_test';
  return bech32Encode(hrp, convertBits(Array.from(bytes), 8, 5, true));
}

/** True for stake1.../stake_test1... reward addresses. */
export function isStakeAddress(bech: string): boolean {
  return /^stake(_test)?1[0-9a-z]+$/i.test(bech.trim());
}

/**
 * Stake credential hash (28-byte hex) from a bech32 stake address.
 * Stake address layout: [header byte][28-byte credential hash].
 */
export function stakeKeyHashFromBech32(stakeAddress: string): string {
  if (!isStakeAddress(stakeAddress)) {
    throw new Error('not a bech32 stake address');
  }
  const bytes = addressBytes(stakeAddress);
  if (bytes.length !== 29) {
    throw new Error(`unexpected stake address length: ${bytes.length} bytes`);
  }
  return toHex(bytes.subarray(1, 29));
}

/** Network id from the address header nibble: 0 = testnet, 1 = mainnet. */
export function networkIdFromBech32(bech: string): number {
  const bytes = addressBytes(bech);
  return (bytes[0] ?? 0) & 0x0f;
}

/** True for a bech32 drep1... governance id. */
export function isDRepId(bech: string): boolean {
  return /^drep1[0-9a-z]+$/i.test(bech.trim());
}

/** CIP-129 header byte for a key-hash DRep credential. */
const DREP_KEYHASH_HEADER = 0x22;

/** 28-byte DRep key hash from a CIP-95 DRep public key (hex). */
export function drepKeyHashFromPubKeyHex(pubKeyHex: string): string {
  return toHex(blake2b(fromHex(pubKeyHex), undefined, 28));
}

/**
 * 28-byte DRep key hash from a bech32 drep id, accepting both CIP-129
 * ([header byte][28-byte hash], 29 bytes) and legacy CIP-105 (28 bytes).
 * Used to match a wallet's DRep key against the genesis board, format-agnostically.
 */
export function drepKeyHashFromId(drepId: string): string {
  if (!isDRepId(drepId)) throw new Error('not a bech32 drep id');
  const bytes = addressBytes(drepId);
  if (bytes.length === 29) return toHex(bytes.subarray(1)); // CIP-129: drop header
  if (bytes.length === 28) return toHex(bytes); // CIP-105
  throw new Error(`unexpected drep id length: ${bytes.length} bytes`);
}

/** DRep ID (bech32 'drep', CIP-129) from a 28-byte DRep key-hash hex. */
export function drepIdFromKeyHashHex(keyHashHex: string): string {
  const bytes = [DREP_KEYHASH_HEADER, ...fromHex(keyHashHex)];
  return bech32Encode('drep', convertBits(bytes, 8, 5, true));
}

/** DRep ID (bech32 'drep', CIP-129) from a CIP-95 DRep public key (hex). */
export function drepIdFromPubKeyHex(pubKeyHex: string): string {
  return drepIdFromKeyHashHex(drepKeyHashFromPubKeyHex(pubKeyHex));
}
