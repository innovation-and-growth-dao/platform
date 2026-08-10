-- §12 reward system: multi-output payouts, expert + board rewards

ALTER TABLE "reward_calculation" ALTER COLUMN "round_id" DROP NOT NULL;
ALTER TABLE "reward_calculation" ADD COLUMN "period_key" TEXT;

ALTER TABLE "reward_entry" ALTER COLUMN "drep_id" DROP NOT NULL;
ALTER TABLE "reward_entry" ADD COLUMN "expert_id" UUID;
ALTER TABLE "reward_entry" ADD COLUMN "override_ada" BIGINT;
ALTER TABLE "reward_entry" ADD COLUMN "payout_action_id" UUID;
ALTER TABLE "reward_entry" ADD CONSTRAINT "reward_entry_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reward_entry" ADD CONSTRAINT "reward_entry_payout_action_id_fkey" FOREIGN KEY ("payout_action_id") REFERENCES "multisig_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "expert_reward" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "expert_id" UUID NOT NULL,
    "filtering_ada" BIGINT NOT NULL DEFAULT 0,
    "dv_ada" BIGINT NOT NULL DEFAULT 0,
    "milestone_ada" BIGINT NOT NULL DEFAULT 0,
    "milestone_like_drep" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "expert_reward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expert_reward_round_id_expert_id_key" ON "expert_reward"("round_id", "expert_id");
ALTER TABLE "expert_reward" ADD CONSTRAINT "expert_reward_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expert_reward" ADD CONSTRAINT "expert_reward_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
