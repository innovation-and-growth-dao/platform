-- AlterTable
ALTER TABLE "round" ADD COLUMN     "dv_approval_threshold_pct" DECIMAL(5,2),
ADD COLUMN     "filter_approval_votes" INTEGER,
ADD COLUMN     "filter_reviewer_count" INTEGER,
ADD COLUMN     "milestone_approval_votes" INTEGER,
ADD COLUMN     "milestone_reviewer_count" INTEGER;

-- CreateTable
CREATE TABLE "dv_board_opt_in" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "opted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dv_board_opt_in_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dv_board_opt_in_proposal_id_drep_id_key" ON "dv_board_opt_in"("proposal_id", "drep_id");
