-- CreateTable
CREATE TABLE "admission_vote" (
    "id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "board_drep_id" UUID NOT NULL,
    "choice" TEXT NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_vote_drep_id_board_drep_id_key" ON "admission_vote"("drep_id", "board_drep_id");

-- AddForeignKey
ALTER TABLE "admission_vote" ADD CONSTRAINT "admission_vote_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_vote" ADD CONSTRAINT "admission_vote_board_drep_id_fkey" FOREIGN KEY ("board_drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
