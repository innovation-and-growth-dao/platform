-- §15 — multisig rotation. When the board is re-elected, the OLD multisig
-- must remain accessible (its UTxOs need a migration tx signed by the OLD
-- board), so we:
--   1. soft-delete board seats instead of hard-deleting (preserves the link
--      between past keys and the people who can still sign for old funds);
--   2. mark a MultisigConfig as `replacedAt` once a successor is assembled,
--      so the UI can distinguish "active" from "history" and the migration
--      flow can target the right addresses.

-- Soft-delete column on the board seat. Existing seats stay active (NULL).
ALTER TABLE "board_seat" ADD COLUMN "removed_at" TIMESTAMPTZ(6);

-- Active board seats are the ones where removedAt IS NULL; this index keeps
-- "find current board" cheap.
CREATE INDEX "board_seat_removed_at_idx" ON "board_seat" ("removed_at");

-- Drop the unique constraint on drep_key_hash and replace with a PARTIAL
-- unique index that only enforces uniqueness on ACTIVE seats. Otherwise a
-- former board member who is later re-elected (or anyone re-using the same
-- DRep keyhash) would conflict with their own soft-deleted prior row.
ALTER TABLE "board_seat" DROP CONSTRAINT IF EXISTS "board_seat_drep_key_hash_key";
CREATE UNIQUE INDEX "board_seat_active_drep_key_hash_key"
  ON "board_seat" ("drep_key_hash") WHERE "removed_at" IS NULL;

-- Mark a MultisigConfig as superseded when a new one is assembled. The
-- latest non-replaced row is the active multisig; everything with a
-- replacedAt is a prior wallet that may still hold un-migrated funds.
ALTER TABLE "multisig_config" ADD COLUMN "replaced_at"          TIMESTAMPTZ(6);
ALTER TABLE "multisig_config" ADD COLUMN "replaced_by_config_id" UUID;
ALTER TABLE "multisig_config" ADD CONSTRAINT "multisig_config_replaced_by_fkey"
  FOREIGN KEY ("replaced_by_config_id") REFERENCES "multisig_config" ("id");

-- A MIGRATION-kind MultisigAction needs to track which old config the funds
-- come from + which new config they go to, so the platform can render the
-- right context and (later) assemble the right native script witnesses.
ALTER TABLE "multisig_action" ADD COLUMN "from_config_id" UUID;
ALTER TABLE "multisig_action" ADD COLUMN "to_config_id"   UUID;
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_from_config_fkey"
  FOREIGN KEY ("from_config_id") REFERENCES "multisig_config" ("id");
ALTER TABLE "multisig_action" ADD CONSTRAINT "multisig_action_to_config_fkey"
  FOREIGN KEY ("to_config_id")   REFERENCES "multisig_config" ("id");
