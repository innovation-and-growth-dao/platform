-- §3 — minimum word count enforced on each mandatory text field of a proposal.
-- Null = use the ROUND_SETTING_DEFAULTS value (1). 0 disables the check (test mode).
ALTER TABLE "round" ADD COLUMN "mandatory_words" INTEGER;
