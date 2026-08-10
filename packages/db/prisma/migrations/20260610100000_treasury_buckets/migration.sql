-- §15.5 — labeled treasury buckets (sub-addresses of the same multisig).
--
-- All buckets share the same board-signing requirement. We derive a unique
-- on-chain address per bucket by wrapping the active multisig script with
-- a label-derived "always satisfied" clause: the wrapped script's bytes
-- include the label hash, so its script_hash and bech32 address differ from
-- the primary, while spending still requires all N board signatures.
--
-- Script shape per labeled bucket:
--   ScriptAll [
--     <active multisig ScriptAll(N keys)>,
--     ScriptNOfK(0, [Ed25519KeyHash(blake2b224(label))])
--   ]
-- The 0-of-1 inner script is always satisfied (zero signatures required)
-- but its bytes embed the label hash, ensuring a distinct script hash.
-- The PRIMARY bucket is the bare multisig script (no label wrap).

CREATE TABLE "treasury_bucket" (
  "id"            UUID NOT NULL,
  "configId"      UUID NOT NULL,           -- which MultisigConfig this bucket sits under
  "label"         TEXT NOT NULL,           -- "Submission fees", "Rewards", … (or "" for primary)
  "scriptJson"    JSONB NOT NULL,
  "scriptHash"    TEXT NOT NULL,
  "bech32Address" TEXT NOT NULL,
  "isPrimary"     BOOLEAN NOT NULL DEFAULT false,
  "createdById"   UUID,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "treasury_bucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_bucket_scriptHash_key"    UNIQUE ("scriptHash"),
  CONSTRAINT "treasury_bucket_bech32Address_key" UNIQUE ("bech32Address"),
  CONSTRAINT "treasury_bucket_configId_label_key" UNIQUE ("configId", "label"),
  CONSTRAINT "treasury_bucket_config_fkey"        FOREIGN KEY ("configId")    REFERENCES "multisig_config"("id") ON DELETE CASCADE,
  CONSTRAINT "treasury_bucket_createdBy_fkey"     FOREIGN KEY ("createdById") REFERENCES "app_user"("id")
);
-- Only ONE primary bucket per config (the unlabeled bare multisig).
CREATE UNIQUE INDEX "treasury_bucket_one_primary_per_config" ON "treasury_bucket" ("configId") WHERE "isPrimary" = true;

-- §15.5 — actions can target a specific bucket as their source. NULL means
-- the primary (default) bucket of the active multisig.
ALTER TABLE "multisig_action" ADD COLUMN "source_bucket_id" UUID;
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_source_bucket_fkey"
  FOREIGN KEY ("source_bucket_id") REFERENCES "treasury_bucket"("id");
CREATE INDEX "multisig_action_source_bucket_id_idx" ON "multisig_action" ("source_bucket_id");
