-- §8.2 — board members vote on funding D&V proposals when this is true.
-- Default true so every existing board member is included unless they opt out.
ALTER TABLE "drep" ADD COLUMN "votes_on_funding_proposals" BOOLEAN NOT NULL DEFAULT true;
