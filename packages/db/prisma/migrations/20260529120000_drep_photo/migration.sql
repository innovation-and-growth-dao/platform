-- profile photo as a data URL; overrides the on-chain (CIP-119) image when set
ALTER TABLE "drep" ADD COLUMN "photo" TEXT;
