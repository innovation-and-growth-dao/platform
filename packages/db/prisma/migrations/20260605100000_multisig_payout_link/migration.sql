-- §11/§15 — PROJECT_FUNDING payouts: link the multisig action back to the
-- proposal + milestone it pays out, store the full destination address and a
-- human-readable title, plus the broadcast tx hash (set when the board enters
-- the on-chain hash after the threshold of signatures has been collected).
ALTER TABLE "multisig_action" ADD COLUMN "proposal_id" UUID;
ALTER TABLE "multisig_action" ADD COLUMN "milestone_id" UUID;
ALTER TABLE "multisig_action" ADD COLUMN "milestone_idx" INTEGER;
ALTER TABLE "multisig_action" ADD COLUMN "proposal_title" TEXT;
ALTER TABLE "multisig_action" ADD COLUMN "dest_address" TEXT;
ALTER TABLE "multisig_action" ADD COLUMN "paid_at" TIMESTAMPTZ(6);

CREATE INDEX "multisig_action_proposal_id_idx" ON "multisig_action" ("proposal_id");
CREATE INDEX "multisig_action_milestone_id_idx" ON "multisig_action" ("milestone_id");
