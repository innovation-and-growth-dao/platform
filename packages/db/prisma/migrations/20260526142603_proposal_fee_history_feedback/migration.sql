-- AlterTable
ALTER TABLE "proposal" ADD COLUMN     "fee_review_feedback" TEXT,
ADD COLUMN     "submission_fee_tx_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
