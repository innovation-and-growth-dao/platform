-- §12 — record the vote/check count that earned each reward entry (for the overview)
ALTER TABLE "reward_entry" ADD COLUMN "units" INTEGER;
