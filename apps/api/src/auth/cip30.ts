import verifyDataSignature from '@cardano-foundation/cardano-verify-datasignature';
import { drepKeyHashFromPubKeyHex, stakeAddrBech32FromKeyHashHex } from '@drep-dao/cardano';

/**
 * Verify a CIP-30 / CIP-8 data signature. Returns true only when:
 *  - the COSE_Sign1 signature is cryptographically valid for the COSE_Key, AND
 *  - the signed payload equals `message` (nonce binding), AND
 *  - the signing key resolves to `stakeAddress`.
 *
 * Wraps the (webpack-UMD) default export in one place so the import quirk is
 * isolated from the rest of the codebase.
 */
export function verifyCip30Signature(
  signature: string,
  key: string,
  message: string,
  stakeAddress: string,
): boolean {
  try {
    return verifyDataSignature(signature, key, message, stakeAddress) === true;
  } catch {
    // Malformed cbor / address → treat as a failed verification, never a 500.
    return false;
  }
}

/**
 * SEC-01 — verify a CIP-30 signData proof that the caller controls a specific DRep key.
 * Returns the proven 28-byte DRep key hash iff:
 *  - the COSE_Sign1 is cryptographically valid, AND
 *  - the signed payload equals `challenge` (server nonce binding), AND
 *  - the signing key resolves to the address built from the CLAIMED DRep key hash
 *    (so the signer necessarily holds the claimed governance credential).
 * `network`: 1 = mainnet, 0 = preprod/testnet. Returns null on any mismatch/parse error.
 */
export function verifyDrepKeySignature(
  drepKeyHex: string,
  signature: string,
  key: string,
  challenge: string,
  network: number,
): string | null {
  try {
    const claimedHash = drepKeyHashFromPubKeyHex(drepKeyHex);
    const addr = stakeAddrBech32FromKeyHashHex(claimedHash, network);
    return verifyDataSignature(signature, key, challenge, addr) === true ? claimedHash : null;
  } catch {
    return null;
  }
}
