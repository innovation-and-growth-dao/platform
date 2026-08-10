ALTER TABLE "submitter_application" ADD COLUMN "previous_funding" TEXT NOT NULL DEFAULT '';
ALTER TABLE "submitter_application_history" ADD COLUMN "previous_funding" TEXT NOT NULL DEFAULT '';
