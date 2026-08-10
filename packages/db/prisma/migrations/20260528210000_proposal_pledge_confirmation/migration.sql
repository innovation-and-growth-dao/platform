-- §3 — proposer pledge: the team commits to a refundable pledge at proposal
-- creation, then sends the actual on-chain payment AFTER the proposal is APPROVED
-- (FUNDING stage). The board verifies the payment and confirms it. Mirrors the
-- §12/§16 submission-fee flow (txHash + on-chain verification + board approval).

ALTER TABLE "proposal" ADD COLUMN "pledge_confirmed_at" TIMESTAMPTZ(6);
ALTER TABLE "proposal" ADD COLUMN "pledge_feedback"     TEXT;
