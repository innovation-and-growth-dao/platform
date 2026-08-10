-- §15.3 — persist hot-wallet → treasury sweep transactions so the board can
-- see a history of every move (with tx hash + explorer link), even after a
-- page refresh. Top-ups (treasury → hot wallet) are already persisted as
-- MultisigAction rows (kind=OPS, destAddress=hotWalletAddress); the history
-- endpoint merges both directions for the UI.
CREATE TABLE "hot_wallet_sweep" (
  "id"              UUID NOT NULL,
  "tx_hash"         TEXT NOT NULL,
  "amount_lovelace" BIGINT NOT NULL,
  "from_address"    TEXT NOT NULL,
  "to_address"      TEXT NOT NULL,
  "initiated_by_user_id" UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hot_wallet_sweep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hot_wallet_sweep_tx_hash_key" UNIQUE ("tx_hash"),
  CONSTRAINT "hot_wallet_sweep_user_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app_user"("id")
);
CREATE INDEX "hot_wallet_sweep_created_at_idx" ON "hot_wallet_sweep" ("created_at" DESC);
