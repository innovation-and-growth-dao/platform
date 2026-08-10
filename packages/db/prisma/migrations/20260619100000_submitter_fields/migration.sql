-- §2.1 — submitter profile: multiple GitHub links, conflict-of-interest disclosure,
-- no-self-vote pledge (informative), mandatory Telegram + email contact.
ALTER TABLE "submitter_application" ADD COLUMN "github_urls" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "submitter_application" SET "github_urls" = ARRAY["github_url"] WHERE "github_url" IS NOT NULL AND "github_url" <> '';
ALTER TABLE "submitter_application" DROP COLUMN "github_url";
ALTER TABLE "submitter_application" ADD COLUMN "conflict_of_interest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "submitter_application" ADD COLUMN "no_self_vote_pledge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "submitter_application" ADD COLUMN "telegram" TEXT NOT NULL DEFAULT '';
ALTER TABLE "submitter_application" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

ALTER TABLE "submitter_application_history" ADD COLUMN "github_urls" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "submitter_application_history" SET "github_urls" = ARRAY["github_url"] WHERE "github_url" IS NOT NULL AND "github_url" <> '';
ALTER TABLE "submitter_application_history" DROP COLUMN "github_url";
ALTER TABLE "submitter_application_history" ADD COLUMN "conflict_of_interest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "submitter_application_history" ADD COLUMN "no_self_vote_pledge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "submitter_application_history" ADD COLUMN "telegram" TEXT NOT NULL DEFAULT '';
ALTER TABLE "submitter_application_history" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
