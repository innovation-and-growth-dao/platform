-- Audit batch: milestone paid/extensions, pledge grace, tx-poller dedupe, quick-poll power,
-- delivery reminders, admin reset/rotation, treasury reconciliation, double-payout guard.

ALTER TABLE "milestone" ADD COLUMN "paid_at" TIMESTAMPTZ(6);
ALTER TABLE "milestone" ADD COLUMN "paid_in_tx" TEXT;
ALTER TABLE "milestone" ADD COLUMN "auto_extended_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "milestone" ADD COLUMN "board_extension_days" INTEGER;
ALTER TABLE "milestone" ADD COLUMN "board_extended_at" TIMESTAMPTZ(6);

ALTER TABLE "proposal" ADD COLUMN "pledge_grace_ends_at" TIMESTAMPTZ(6);
ALTER TABLE "proposal" ADD COLUMN "pledge_grace_notified_at" TIMESTAMPTZ(6);
ALTER TABLE "proposal" ADD COLUMN "fee_seen_onchain_at" TIMESTAMPTZ(6);
ALTER TABLE "proposal" ADD COLUMN "pledge_seen_onchain_at" TIMESTAMPTZ(6);

ALTER TABLE "quick_poll" ADD COLUMN "eligible_drep_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "quick_poll_vote" ADD COLUMN "power" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "proposal" ADD COLUMN "delivery_reminded_at" TIMESTAMPTZ(6);

ALTER TABLE "admin_invitation" ADD COLUMN "rotation_id" UUID;

CREATE TABLE "admin_password_reset" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    CONSTRAINT "admin_password_reset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_password_reset_admin_id_idx" ON "admin_password_reset"("admin_id");

CREATE TABLE "admin_rotation" (
    "id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "admin_rotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treasury_daily_snapshot" (
    "id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "total_lovelace" BIGINT NOT NULL,
    "prev_lovelace" BIGINT,
    "explained_lovelace" BIGINT NOT NULL DEFAULT 0,
    "mismatch" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_daily_snapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_daily_snapshot_day_key" ON "treasury_daily_snapshot"("day");

-- A3 — double-payout guard: at most ONE live PROJECT_FUNDING action per milestone.
-- Partial unique index (Prisma can't express it) — FAILED actions don't block a retry.
CREATE UNIQUE INDEX "multisig_action_funding_per_milestone"
  ON "multisig_action"("milestone_id")
  WHERE "kind" = 'PROJECT_FUNDING' AND "status" NOT IN ('FAILED');
