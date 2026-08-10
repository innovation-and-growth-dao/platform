-- §2.1 — conflict-of-interest disclosure + no-self-vote pledge on DRep profiles
ALTER TABLE "drep" ADD COLUMN "conflict_of_interest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "drep" ADD COLUMN "no_self_vote_pledge" BOOLEAN NOT NULL DEFAULT false;
