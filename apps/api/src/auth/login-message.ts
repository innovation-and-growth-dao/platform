/**
 * Canonical human-readable login message (§22.1). The server stores the exact
 * issued message in Redis and passes it to CIP-8 verification, so the wallet
 * must sign precisely this string. The embedded nonce binds it to one attempt;
 * the domain prevents cross-app replay.
 */
export interface LoginMessageParams {
  domain: string;
  stakeAddress: string;
  nonce: string;
  issuedAt: string;
}

export function buildLoginMessage(p: LoginMessageParams): string {
  return [
    `${p.domain} — sign in with your Cardano wallet`,
    '',
    `Stake address: ${p.stakeAddress}`,
    `Nonce: ${p.nonce}`,
    `Issued at: ${p.issuedAt}`,
    '',
    'Signing proves you control this wallet. It is free and is not a transaction.',
  ].join('\n');
}
