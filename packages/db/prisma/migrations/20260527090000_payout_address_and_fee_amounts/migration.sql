-- Submitter's payout/refund Cardano address + the old/new total fee on a budget-change settlement.
ALTER TABLE "proposal" ADD COLUMN "payout_address" TEXT;
ALTER TABLE "fee_adjustment" ADD COLUMN "prev_fee_ada" BIGINT;
ALTER TABLE "fee_adjustment" ADD COLUMN "new_fee_ada" BIGINT;
