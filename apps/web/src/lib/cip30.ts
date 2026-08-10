'use client';

import { stakeAddressFromHex, drepIdFromPubKeyHex } from '@drep-dao/cardano';

/** Minimal CIP-30 (+ CIP-95) typings — just what login and DRep apply need. */
export interface Cip30Api {
  getRewardAddresses(): Promise<string[]>; // hex reward addresses
  getUsedAddresses?(): Promise<string[]>;
  getNetworkId(): Promise<number>;
  signData(addressHex: string, payloadHex: string): Promise<{ signature: string; key: string }>;
  /** Sign a Cardano transaction body. partialSign=true asks the wallet to
   *  sign with whichever of its keys match required_signers / inputs, without
   *  refusing if the wallet doesn't own all inputs (needed for native-script
   *  multisig where the inputs sit at a script address). Returns the wallet's
   *  TransactionWitnessSet CBOR (vkey witnesses only — combine with the
   *  native script server-side). */
  signTx(txCbor: string, partialSign?: boolean): Promise<string>;
  /** CIP-95 — present on Lace/Eternl etc. */
  cip95?: { getPubDRepKey(): Promise<string> };
}

/** Best-effort DRep ID via CIP-95; null if the wallet doesn't support it. */
export async function detectDRepId(api: Cip30Api): Promise<string | null> {
  try {
    const hex = await api.cip95?.getPubDRepKey();
    return hex ? drepIdFromPubKeyHex(hex) : null;
  } catch {
    return null;
  }
}

/** Raw CIP-95 DRep public key hex (for the backend to match board/DRep status). */
export async function getDRepKeyHex(api: Cip30Api): Promise<string | undefined> {
  try {
    return (await api.cip95?.getPubDRepKey()) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface Cip30WalletEntry {
  key: string; // window.cardano key, e.g. "eternl"
  name: string;
  icon: string;
  enable(opts?: { extensions: { cip: number }[] }): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
  apiVersion?: string;
}

/**
 * §22 — enable the wallet REQUESTING the CIP-95 extension, so it exposes
 * cip95.getPubDRepKey() (the DRep identity used for board/DRep recognition).
 * A bare enable() leaves most wallets without the cip95 namespace, which made
 * board members/DReps show up as "Viewer". Falls back to a plain enable for
 * wallets that don't support CIP-95 (or if the user declines the extension).
 */
async function enableWallet(entry: Cip30WalletEntry): Promise<Cip30Api> {
  try {
    return await entry.enable({ extensions: [{ cip: 95 }] });
  } catch {
    return await entry.enable();
  }
}

type CardanoWindow = Window & {
  cardano?: Record<string, Cip30WalletEntry | undefined>;
};

/** Wallet keys exposed by window.cardano that aren't actually CIP-30 wallets. */
const NON_WALLET_KEYS = new Set(['enable', 'isEnabled', 'getApiVersion', 'getName']);

/** Enumerate injected CIP-30 wallets. Browser-only. */
export function listInjectedWallets(): Cip30WalletEntry[] {
  if (typeof window === 'undefined') return [];
  const cardano = (window as CardanoWindow).cardano;
  if (!cardano) return [];
  const out: Cip30WalletEntry[] = [];
  for (const key of Object.keys(cardano)) {
    if (NON_WALLET_KEYS.has(key)) continue;
    const w = cardano[key];
    if (w && typeof w.enable === 'function' && typeof w.name === 'string') {
      out.push({ ...w, key });
    }
  }
  return out;
}

function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export interface WalletSignResult {
  stakeAddress: string; // bech32
  signature: string;
  key: string;
}

/**
 * Connect a wallet and sign the given login message with its stake key.
 * Returns the bech32 stake address + CIP-8 data signature for /auth/verify.
 */
export async function connectAndSign(
  entry: Cip30WalletEntry,
  message: string,
): Promise<{ api: Cip30Api; stakeHex: string; stakeAddress: string; sign: () => Promise<WalletSignResult> }> {
  const api = await enableWallet(entry);
  const rewardAddrs = await api.getRewardAddresses();
  const stakeHex = rewardAddrs[0];
  if (!stakeHex) {
    throw new Error('Wallet returned no reward (stake) address. Is a stake key registered?');
  }
  const stakeAddress = stakeAddressFromHex(stakeHex);

  const sign = async (): Promise<WalletSignResult> => {
    const sig = await api.signData(stakeHex, utf8ToHex(message));
    return { stakeAddress, signature: sig.signature, key: sig.key };
  };

  return { api, stakeHex, stakeAddress, sign };
}

/** Sign an arbitrary message with the wallet's stake key (CIP-30 signData) — free, no tx. */
export async function signMessageWithStakeKey(
  api: Cip30Api,
  message: string,
): Promise<{ signature: string; key: string }> {
  const stakeHex = (await api.getRewardAddresses())[0];
  if (!stakeHex) throw new Error('Wallet returned no reward (stake) address.');
  return api.signData(stakeHex, utf8ToHex(message));
}

/** Resolve the bech32 stake address only (used to request the nonce first). */
export async function getStakeAddress(entry: Cip30WalletEntry): Promise<{ api: Cip30Api; stakeHex: string; stakeAddress: string }> {
  const api = await enableWallet(entry);
  const rewardAddrs = await api.getRewardAddresses();
  const stakeHex = rewardAddrs[0];
  if (!stakeHex) throw new Error('Wallet returned no reward (stake) address.');
  return { api, stakeHex, stakeAddress: stakeAddressFromHex(stakeHex) };
}

export { utf8ToHex };
