-- SEC-01 — cryptographic DRep-key ownership proof.
ALTER TABLE "app_user" ADD COLUMN "drep_key_proven_at" TIMESTAMP(3);

CREATE TABLE "drep_key_proof" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "drep_key_hash" TEXT NOT NULL,
  "challenge_hash" TEXT NOT NULL,
  "signature_hex" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'cip95-signdata-v1',
  "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "drep_key_proof_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "drep_key_proof_drep_key_hash_idx" ON "drep_key_proof"("drep_key_hash");
CREATE INDEX "drep_key_proof_user_id_idx" ON "drep_key_proof"("user_id");
ALTER TABLE "drep_key_proof" ADD CONSTRAINT "drep_key_proof_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
