/**
 * Cardano integration surface (§22–§23). This package defines the *interfaces*
 * the backend depends on; concrete Blockfrost/Koios/Lucid implementations are
 * added when the wallet-auth and treasury slices land. Keeping the seams here
 * lets us swap providers behind a circuit breaker (design risk R1).
 */
import type { CardanoNetwork, AnchorKind } from '@drep-dao/shared';

export * from './anchor';
export * from './address';
export * from './governance-metadata';

/** Resolve provider base URLs / params per network. */
export interface NetworkConfig {
  network: CardanoNetwork;
  blockfrostProjectId?: string;
  koiosUrl: string;
}

export const KOIOS_URLS: Record<CardanoNetwork, string> = {
  Mainnet: 'https://api.koios.rest/api/v1',
  Preprod: 'https://preprod.koios.rest/api/v1',
  Preview: 'https://preview.koios.rest/api/v1',
};

/** Minimal on-chain TX view used for fee/pledge verification (§22.4). */
export interface TxOutputView {
  address: string;
  lovelace: bigint;
}

export interface TxView {
  txHash: string;
  confirmations: number;
  blockHeight: number | null;
  outputs: TxOutputView[];
  /** Stake key hash of the (first) input's owner, for sender cross-check (§16.2). */
  senderStakeKeyHash: string | null;
}

export interface DRepOnChain {
  drepId: string;
  registered: boolean;
  /** Total delegated stake in Lovelace. */
  votingPowerLovelace: bigint;
  delegatorCount: number;
}

/**
 * §22.4 read-only Cardano queries. No transaction submission lives here —
 * submission goes through Lucid (anchoring hot wallet) or the multisig flow.
 */
export interface CardanoQueryService {
  /** Verify a submission-fee / pledge TX: confirmations, outputs, sender. */
  getTx(txHash: string): Promise<TxView | null>;
  /** DRep registration + on-chain voting power (CIP-95 / governance). */
  getDRep(drepId: string): Promise<DRepOnChain | null>;
  /** Latest block hash — seed for verifiable reviewer draws (§7.1). */
  getLatestBlockHash(): Promise<string>;
}

export type { CardanoNetwork, AnchorKind };
