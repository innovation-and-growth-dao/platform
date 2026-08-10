-- §15.6 — per-operation default buckets. The platform auto-generates several
-- kinds of multisig actions (PROJECT_FUNDING for milestone payouts,
-- REWARD_PAYOUT for DRep rewards, OPS for hot-wallet top-ups). Each one is
-- routed to the bucket marked "default" for its operation type, falling
-- back to the primary if no default is set.
--
-- Boolean flags per bucket make the routing trivially indexable (one row →
-- one bucket) and let a single bucket be default for multiple ops (or have
-- a separate bucket per op). Partial unique indexes enforce "at most one
-- default per (config, op)".

ALTER TABLE "treasury_bucket" ADD COLUMN "is_default_funding"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "treasury_bucket" ADD COLUMN "is_default_rewards"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "treasury_bucket" ADD COLUMN "is_default_operations" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "treasury_bucket_one_default_funding_per_config"
  ON "treasury_bucket" ("configId") WHERE "is_default_funding"    = true;
CREATE UNIQUE INDEX "treasury_bucket_one_default_rewards_per_config"
  ON "treasury_bucket" ("configId") WHERE "is_default_rewards"    = true;
CREATE UNIQUE INDEX "treasury_bucket_one_default_operations_per_config"
  ON "treasury_bucket" ("configId") WHERE "is_default_operations" = true;
