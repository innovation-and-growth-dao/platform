-- CreateTable
CREATE TABLE "drep_removal" (
    "id" UUID NOT NULL,
    "target_drep_id" UUID NOT NULL,
    "proposed_by" UUID NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "drep_removal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drep_removal_vote" (
    "removal_id" UUID NOT NULL,
    "board_drep_id" UUID NOT NULL,
    "choice" TEXT NOT NULL,
    "rationale" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drep_removal_vote_pkey" PRIMARY KEY ("removal_id","board_drep_id")
);

-- CreateIndex
CREATE INDEX "drep_removal_target_drep_id_status_idx" ON "drep_removal"("target_drep_id", "status");

-- AddForeignKey
ALTER TABLE "drep_removal_vote" ADD CONSTRAINT "drep_removal_vote_removal_id_fkey" FOREIGN KEY ("removal_id") REFERENCES "drep_removal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
