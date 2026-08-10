-- §15.6 — extend the per-operation default flags to INBOUND ops too.
-- Outbound flags already exist: is_default_funding (milestone payouts),
-- is_default_rewards (DRep reward payouts), is_default_operations
-- (hot-wallet top-ups). The new flags route INBOUND money — the address
-- the platform tells submitters to pay into.
--   • is_default_submission_fees → where the fee endpoint + the public
--     /config tell submitters to send their submission-fee payment.
--   • is_default_pledge          → where the FUNDING-stage pledge ("skin
--     in the game") payment is requested.
-- Both fall back to the primary bucket when no explicit default is set.

ALTER TABLE "treasury_bucket" ADD COLUMN "is_default_submission_fees" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "treasury_bucket" ADD COLUMN "is_default_pledge"          BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "treasury_bucket_one_default_submission_fees_per_config"
  ON "treasury_bucket" ("configId") WHERE "is_default_submission_fees" = true;
CREATE UNIQUE INDEX "treasury_bucket_one_default_pledge_per_config"
  ON "treasury_bucket" ("configId") WHERE "is_default_pledge"          = true;
