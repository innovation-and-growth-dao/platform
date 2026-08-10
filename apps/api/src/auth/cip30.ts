import verifyDataSignature from '@cardano-foundation/cardano-verify-datasignature';

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
