-- §15 — 2-phase multisig signing.
--
-- Cardano multisig has a wallet UX problem: without required_signers wallets
-- often refuse to sign script-locked txs (they return "nothing to sign");
-- with required_signers = all N keys, the chain enforces "all must sign"
-- which makes M-of-N impossible. The fix is to pick the M signers BEFORE
-- building the tx body — and the only way to do that without coordination
-- between board members is to ask each one to AUTHORIZE first (cheap CIP-30
-- data-signature, no HW wallet needed), then once M have authorized, build
-- the tx with exactly those M keyhashes in required_signers and ask THEM to
-- sign for real with their HW wallets.
--
-- This table holds phase-1 authorizations. Phase-2 tx witnesses keep going
-- in multisig_signature (existing); a "committedKeyHashes" array on
-- multisig_action snapshots whose keys are baked into required_signers.

CREATE TABLE "multisig_commitment" (
  "id"          UUID NOT NULL,
  "action_id"   UUID NOT NULL,
  "user_id"     UUID NOT NULL,
  "drep_id"     UUID NOT NULL,
  "key_hash"    TEXT NOT NULL,    -- the multisig payment-key hash this user holds
  "signature"   TEXT NOT NULL,    -- CIP-30 data-sig over a canonical commit message
  "signing_key" TEXT NOT NULL,
  "ts"          TEXT NOT NULL,
  "committed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "multisig_commitment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "multisig_commitment_action_user_key" UNIQUE ("action_id", "user_id"),
  CONSTRAINT "multisig_commitment_action_fkey" FOREIGN KEY ("action_id") REFERENCES "multisig_action"("id") ON DELETE CASCADE,
  CONSTRAINT "multisig_commitment_user_fkey"   FOREIGN KEY ("user_id")   REFERENCES "app_user"("id"),
  CONSTRAINT "multisig_commitment_drep_fkey"   FOREIGN KEY ("drep_id")   REFERENCES "drep"("id")
);
CREATE INDEX "multisig_commitment_action_id_idx" ON "multisig_commitment" ("action_id");

-- The snapshot of WHICH M keys were selected. Set when commitments reach
-- threshold, used by prepareTxBody to know whose keyhashes go into
-- required_signers and by submitWitness to gate which signers may submit.
ALTER TABLE "multisig_action" ADD COLUMN "committed_key_hashes" TEXT[];
