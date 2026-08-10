-- §10.5 — Spending internal proposal
ALTER TABLE "proposal" ADD COLUMN "spending_amount_ada" BIGINT;
ALTER TABLE "proposal" ADD COLUMN "spending_source_bucket_id" UUID;
ALTER TABLE "proposal" ADD COLUMN "spending_dest_address" TEXT;
ALTER TABLE "proposal" ADD COLUMN "spending_action_id" UUID;
