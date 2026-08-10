-- §7 — full per-edit snapshot of every editable proposal field, so the diff view
-- can show changes across title / pitch / descriptive fields / payout / expertise
-- / requested amount / commercial flag / milestones — not just the pitch text.
ALTER TABLE "proposal_version" ADD COLUMN "snapshot" JSONB;
