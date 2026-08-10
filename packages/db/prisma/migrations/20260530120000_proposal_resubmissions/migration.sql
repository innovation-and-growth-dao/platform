-- §7.4 — how many times the submitter may revise + resubmit a filter-rejected
-- proposal while the round is still in FILTERING (per-round override of
-- ROUND_SETTING_DEFAULTS.filterResubmissionsAllowed = 2).
ALTER TABLE "round" ADD COLUMN "filter_resubmissions_allowed" INTEGER;

-- §7.4 — running count of resubmissions on each proposal.
ALTER TABLE "proposal" ADD COLUMN "filter_resubmissions_used" INTEGER NOT NULL DEFAULT 0;
