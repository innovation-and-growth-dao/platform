-- AlterTable
ALTER TABLE "round_schedule" ADD COLUMN     "auto_start" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "confirmed_by" UUID;
