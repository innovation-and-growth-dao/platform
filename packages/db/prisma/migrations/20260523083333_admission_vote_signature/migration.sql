-- AlterTable
ALTER TABLE "admission_vote" ADD COLUMN     "signature" TEXT,
ADD COLUMN     "signed_at" TIMESTAMPTZ(6),
ADD COLUMN     "signing_key" TEXT;
