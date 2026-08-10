-- §3.4 — revenue-sharing gate: team checks a box at submit/edit if their proposal
-- needs the board to verify a one-off action (e.g. 10% of token supply sent to
-- the Treasury) before milestone work starts. Milestone POAs are blocked until
-- revenue_sharing_verified_at is set, same pattern as the pledge gate.
ALTER TABLE "proposal" ADD COLUMN "revenue_sharing_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "proposal" ADD COLUMN "revenue_sharing_verified_at" TIMESTAMPTZ(6);
