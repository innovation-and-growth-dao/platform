-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "stake_key_hash" TEXT NOT NULL,
    "stake_address" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drep" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "drep_id_onchain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bio" TEXT,
    "socials" JSONB,
    "contact" JSONB,
    "subcategory_ids" TEXT[],
    "kyc_optin" BOOLEAN NOT NULL DEFAULT false,
    "calls_optin" BOOLEAN NOT NULL DEFAULT false,
    "admission_call_optin" BOOLEAN NOT NULL DEFAULT false,
    "admitted_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "drep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_membership" (
    "id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "board_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expert" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "subcategory_ids" TEXT[],
    "approved_by_board" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "subcategory" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_idx" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL,
    "budget_ada" BIGINT NOT NULL,
    "rewards_pool_ada" BIGINT NOT NULL,
    "multisig_address" TEXT NOT NULL,
    "intersect_tx_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_category" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "conditions" TEXT,
    "min_ada" BIGINT,
    "max_ada" BIGINT,
    "allocated_ada" BIGINT NOT NULL,

    CONSTRAINT "round_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_drep_eligibility" (
    "round_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_drep_eligibility_pkey" PRIMARY KEY ("round_id","drep_id")
);

-- CreateTable
CREATE TABLE "round_schedule" (
    "round_id" UUID NOT NULL,
    "stage_key" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "prolonged_from" TIMESTAMPTZ(6),

    CONSTRAINT "round_schedule_pkey" PRIMARY KEY ("round_id","stage_key")
);

-- CreateTable
CREATE TABLE "proposal" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "submitter_user_id" UUID,
    "submitter_drep_id" UUID,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "category_id" UUID,
    "subcategory_ids" TEXT[],
    "round_id" UUID,
    "is_commercial" BOOLEAN,
    "requested_amount_ada" BIGINT,
    "submission_fee_ada" BIGINT,
    "submission_fee_tx_hash" TEXT,
    "pledge_amount_ada" BIGINT,
    "pledge_return_method" TEXT,
    "pledge_tx_hash" TEXT,
    "team_info" JSONB,
    "cost_breakdown_md" TEXT,
    "revenue_sharing" JSONB,
    "internal_type" TEXT,
    "voters_scope" TEXT,
    "actors" JSONB,
    "delivery_date" TIMESTAMPTZ(6),
    "poll_options" JSONB,
    "threshold_kind" TEXT,
    "votingType" TEXT NOT NULL,
    "approval_threshold_pct" DECIMAL(5,2),
    "voting_start_at" TIMESTAMPTZ(6),
    "voting_end_at" TIMESTAMPTZ(6),
    "result_finalized_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_version" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content_md" TEXT NOT NULL,
    "edited_by" UUID,
    "edited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "description" TEXT,
    "amount_ada" BIGINT NOT NULL,
    "deadline_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_poa" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "content_md" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt" INTEGER NOT NULL,

    CONSTRAINT "milestone_poa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_assignment" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,

    CONSTRAINT "filter_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_assignment" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "reviewer_drep_id" UUID,
    "reviewer_expert_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_board_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "milestone_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_snapshot" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "taken_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anchor_id" UUID,

    CONSTRAINT "vote_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_snapshot_entry" (
    "snapshot_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "stake_lovelace" BIGINT NOT NULL,
    "merit_points" INTEGER NOT NULL,
    "base_power" DECIMAL(12,4),
    "merit_multiplier" DECIMAL(12,4),
    "final_power" DECIMAL(12,4),

    CONSTRAINT "vote_snapshot_entry_pkey" PRIMARY KEY ("snapshot_id","drep_id")
);

-- CreateTable
CREATE TABLE "vote" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "milestone_id" UUID,
    "choice" TEXT NOT NULL,
    "rationale" TEXT,
    "cast_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by" UUID,

    CONSTRAINT "vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_poll" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "candidates" UUID[],
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "extensions" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "winner_id" UUID,

    CONSTRAINT "quick_poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_poll_vote" (
    "quick_poll_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "choice" UUID NOT NULL,
    "cast_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_poll_vote_pkey" PRIMARY KEY ("quick_poll_id","drep_id")
);

-- CreateTable
CREATE TABLE "merit_ledger" (
    "id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "delta" DECIMAL(6,2) NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reference_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_calculation" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "pool_ada" BIGINT NOT NULL,
    "total_units" DECIMAL(65,30),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_entry" (
    "id" UUID NOT NULL,
    "reward_calculation_id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "amount_ada" BIGINT NOT NULL,
    "paid_in_tx" TEXT,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "reward_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multisig_action" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "tx_cbor" TEXT,
    "tx_hash" TEXT,
    "status" TEXT NOT NULL,
    "amount_ada" BIGINT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multisig_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multisig_signature" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "board_drep_id" UUID NOT NULL,
    "witness_cbor" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multisig_signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardano_tx_observation" (
    "tx_hash" TEXT NOT NULL,
    "block_height" BIGINT,
    "confirmed_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cardano_tx_observation_pkey" PRIMARY KEY ("tx_hash")
);

-- CreateTable
CREATE TABLE "anchor" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "round_id" UUID,
    "proposal_id" UUID,
    "hash" TEXT NOT NULL,
    "preimage" JSONB,
    "tx_hash" TEXT,
    "metadata_label" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_thread" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "private_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_message" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "channels_sent" TEXT[],
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "user_id" UUID NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "email_addr" TEXT,
    "telegram" BOOLEAN NOT NULL DEFAULT false,
    "telegram_chat_id" TEXT,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "drep_avoid_period" (
    "id" UUID NOT NULL,
    "drep_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drep_avoid_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drep_recommendation" (
    "id" UUID NOT NULL,
    "recommended_drep_id" UUID NOT NULL,
    "recommender_drep_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drep_recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_stake_key_hash_key" ON "app_user"("stake_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "drep_user_id_key" ON "drep"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drep_drep_id_onchain_key" ON "drep"("drep_id_onchain");

-- CreateIndex
CREATE UNIQUE INDEX "round_number_key" ON "round"("number");

-- CreateIndex
CREATE INDEX "proposal_round_id_status_idx" ON "proposal"("round_id", "status");

-- CreateIndex
CREATE INDEX "proposal_type_status_idx" ON "proposal"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_version_proposal_id_version_key" ON "proposal_version"("proposal_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_proposal_id_idx_key" ON "milestone"("proposal_id", "idx");

-- CreateIndex
CREATE INDEX "vote_proposal_id_drep_id_idx" ON "vote"("proposal_id", "drep_id");

-- CreateIndex
CREATE INDEX "merit_ledger_drep_id_occurred_at_idx" ON "merit_ledger"("drep_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_signature_action_id_board_drep_id_key" ON "multisig_signature"("action_id", "board_drep_id");

-- CreateIndex
CREATE INDEX "anchor_kind_created_at_idx" ON "anchor"("kind", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "drep" ADD CONSTRAINT "drep_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_membership" ADD CONSTRAINT "board_membership_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert" ADD CONSTRAINT "expert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_category" ADD CONSTRAINT "round_category_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_drep_eligibility" ADD CONSTRAINT "round_drep_eligibility_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_drep_eligibility" ADD CONSTRAINT "round_drep_eligibility_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_schedule" ADD CONSTRAINT "round_schedule_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_submitter_user_id_fkey" FOREIGN KEY ("submitter_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_submitter_drep_id_fkey" FOREIGN KEY ("submitter_drep_id") REFERENCES "drep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "round_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_version" ADD CONSTRAINT "proposal_version_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_version" ADD CONSTRAINT "proposal_version_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_poa" ADD CONSTRAINT "milestone_poa_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_assignment" ADD CONSTRAINT "filter_assignment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_assignment" ADD CONSTRAINT "filter_assignment_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_assignment" ADD CONSTRAINT "filter_assignment_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "drep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_assignment" ADD CONSTRAINT "milestone_assignment_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_assignment" ADD CONSTRAINT "milestone_assignment_reviewer_drep_id_fkey" FOREIGN KEY ("reviewer_drep_id") REFERENCES "drep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_assignment" ADD CONSTRAINT "milestone_assignment_reviewer_expert_id_fkey" FOREIGN KEY ("reviewer_expert_id") REFERENCES "expert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_snapshot" ADD CONSTRAINT "vote_snapshot_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_snapshot" ADD CONSTRAINT "vote_snapshot_anchor_id_fkey" FOREIGN KEY ("anchor_id") REFERENCES "anchor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_snapshot_entry" ADD CONSTRAINT "vote_snapshot_entry_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "vote_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_snapshot_entry" ADD CONSTRAINT "vote_snapshot_entry_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote" ADD CONSTRAINT "vote_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "vote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll" ADD CONSTRAINT "quick_poll_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll" ADD CONSTRAINT "quick_poll_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "round_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll" ADD CONSTRAINT "quick_poll_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll_vote" ADD CONSTRAINT "quick_poll_vote_quick_poll_id_fkey" FOREIGN KEY ("quick_poll_id") REFERENCES "quick_poll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll_vote" ADD CONSTRAINT "quick_poll_vote_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_poll_vote" ADD CONSTRAINT "quick_poll_vote_choice_fkey" FOREIGN KEY ("choice") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merit_ledger" ADD CONSTRAINT "merit_ledger_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_calculation" ADD CONSTRAINT "reward_calculation_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_entry" ADD CONSTRAINT "reward_entry_reward_calculation_id_fkey" FOREIGN KEY ("reward_calculation_id") REFERENCES "reward_calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_entry" ADD CONSTRAINT "reward_entry_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_signature" ADD CONSTRAINT "multisig_signature_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "multisig_action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_signature" ADD CONSTRAINT "multisig_signature_board_drep_id_fkey" FOREIGN KEY ("board_drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_thread" ADD CONSTRAINT "private_thread_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_message" ADD CONSTRAINT "private_message_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "private_thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_message" ADD CONSTRAINT "private_message_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drep_avoid_period" ADD CONSTRAINT "drep_avoid_period_drep_id_fkey" FOREIGN KEY ("drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drep_recommendation" ADD CONSTRAINT "drep_recommendation_recommended_drep_id_fkey" FOREIGN KEY ("recommended_drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drep_recommendation" ADD CONSTRAINT "drep_recommendation_recommender_drep_id_fkey" FOREIGN KEY ("recommender_drep_id") REFERENCES "drep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
