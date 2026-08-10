-- Human-readable, globally-unique proposal id (e.g. "R6-P3"), assigned when a proposal
-- first becomes ACTIVE. Nullable; unique (Postgres treats NULLs as distinct).
ALTER TABLE "proposal" ADD COLUMN "public_id" TEXT;
CREATE UNIQUE INDEX "proposal_public_id_key" ON "proposal"("public_id");
