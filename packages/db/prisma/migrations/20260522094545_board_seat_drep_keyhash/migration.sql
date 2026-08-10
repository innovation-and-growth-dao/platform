-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "drep_key_hash" TEXT;

-- CreateTable
CREATE TABLE "board_seat" (
    "id" UUID NOT NULL,
    "drep_key_hash" TEXT NOT NULL,
    "drep_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_seat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_seat_drep_key_hash_key" ON "board_seat"("drep_key_hash");
