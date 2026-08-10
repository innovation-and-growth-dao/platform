-- §12 submission-fee settlement when an ACTIVE proposal's budget changes (top-up / refund).
CREATE TABLE "fee_adjustment" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_ada" BIGINT NOT NULL,
    "prev_amount_ada" BIGINT NOT NULL,
    "new_amount_ada" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tx_hash" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(6),
    "settled_by_user_id" UUID,
    CONSTRAINT "fee_adjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_adjustment_status_created_at_idx" ON "fee_adjustment"("status", "created_at");

ALTER TABLE "fee_adjustment" ADD CONSTRAINT "fee_adjustment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
