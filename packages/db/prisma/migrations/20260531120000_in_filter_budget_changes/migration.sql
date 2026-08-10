-- §12/§7 — per-round cap on how many budget-change requests a submitter may make
-- while the round is in FILTERING. Each accepted change clears the jury's
-- filtering votes and they vote again on the revised budget. Default 2
-- (ROUND_SETTING_DEFAULTS.filterBudgetChangesAllowed); null = use the default.
ALTER TABLE "round" ADD COLUMN "filter_budget_changes_allowed" INTEGER;

-- Running count on each proposal.
ALTER TABLE "proposal" ADD COLUMN "budget_changes_used" INTEGER NOT NULL DEFAULT 0;
