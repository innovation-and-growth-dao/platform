-- §9.2 — ranked priority quick-poll votes: a voter submits an ordered list of
-- candidate proposal ids (highest priority first) instead of a single choice.
ALTER TABLE "quick_poll_vote" ADD COLUMN "ranking" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
-- choice becomes the top pick (= ranking[0]); kept for the choiceProposal relation, now optional.
ALTER TABLE "quick_poll_vote" ALTER COLUMN "choice" DROP NOT NULL;
-- Backfill existing single-choice votes into a one-element ranking.
UPDATE "quick_poll_vote" SET "ranking" = ARRAY["choice"] WHERE "choice" IS NOT NULL AND cardinality("ranking") = 0;
