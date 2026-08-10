-- §15 — multisig setup foundation. The platform collects ONE
-- verification-key per board seat (from a HW wallet, attested via CIP-30
-- signature), then auto-assembles an `atLeast 3 of 5` native script + its
-- script address. That script address replaces the static TREASURY_ADDRESS
-- everywhere as the real on-chain multisig home.

-- Per-board-member signing-key submission.
CREATE TABLE "board_multisig_key" (
  "id"                   UUID         NOT NULL,
  "board_seat_id"        UUID         NOT NULL,
  "user_id"              UUID         NOT NULL,
  -- 28-byte payment-verification-key hash (hex), used directly in the native
  -- script as `{type:sig, keyHash}`.
  "payment_key_hash"     TEXT         NOT NULL,
  -- Optional bech32 payment address of the same key — kept for display +
  -- so the board can be paid rewards directly (not just sign).
  "payment_bech32"       TEXT,
  -- User-asserted HW-wallet attestation (we can't verify this on-chain).
  "hardware_attested"    BOOLEAN      NOT NULL DEFAULT false,
  -- CIP-30 proof that the user actually controls `payment_key_hash`. They
  -- sign a canonical message; we verify it before recording the key.
  "attestation_signature" TEXT        NOT NULL,
  "attestation_key"       TEXT        NOT NULL,
  "attestation_ts"        TEXT        NOT NULL,
  "submitted_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "board_multisig_key_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_multisig_key_board_seat_id_key" UNIQUE ("board_seat_id"),
  CONSTRAINT "board_multisig_key_payment_key_hash_key" UNIQUE ("payment_key_hash"),
  CONSTRAINT "board_multisig_key_board_seat_id_fkey" FOREIGN KEY ("board_seat_id") REFERENCES "board_seat"("id"),
  CONSTRAINT "board_multisig_key_user_id_fkey"       FOREIGN KEY ("user_id")       REFERENCES "app_user"("id")
);
CREATE INDEX "board_multisig_key_user_id_idx" ON "board_multisig_key" ("user_id");

-- The assembled multisig (one row at a time; future rotations just insert
-- another row, latest by assembled_at is active). Keeping history makes the
-- treasury page able to label past payments at their then-current address.
CREATE TABLE "multisig_config" (
  "id"             UUID NOT NULL,
  -- Canonical native-script JSON exactly as accepted by CSL/Lucid:
  --   {"type":"atLeast","required":3,"scripts":[{"type":"sig","keyHash":"..."}, ...]}
  "script_json"    JSONB NOT NULL,
  -- 28-byte script hash (hex) — input to the bech32 address.
  "script_hash"    TEXT NOT NULL,
  "bech32_address" TEXT NOT NULL,
  "threshold"      INTEGER NOT NULL,
  "total_keys"     INTEGER NOT NULL,
  "assembled_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "multisig_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "multisig_config_script_hash_key"    UNIQUE ("script_hash"),
  CONSTRAINT "multisig_config_bech32_address_key" UNIQUE ("bech32_address")
);

-- DReps (and board members) provide a payment address to receive rewards. We
-- store on app_user so EVERY user can collect (DReps + board are users too).
-- Historical reward payments are unaffected by later edits — RewardEntry
-- stamps the address it was paid to at the time of payment.
ALTER TABLE "app_user" ADD COLUMN "reward_payment_address" TEXT;

-- Snapshot the address each RewardEntry was actually paid to (or queued for),
-- so the treasury history shows the right destination even after the DRep
-- updates their profile address later.
ALTER TABLE "reward_entry" ADD COLUMN "paid_to_address" TEXT;
