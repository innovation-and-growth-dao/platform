-- §2 — cross-wallet profile linking between a submitter and a DAO member.
ALTER TABLE "submitter_application" ADD COLUMN "linked_drep_id_onchain" TEXT;
ALTER TABLE "drep" ADD COLUMN "linked_submitter_user_id" UUID;
