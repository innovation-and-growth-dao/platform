-- §11/§12 — experts can review (vote on) milestones they're assigned to
CREATE TABLE "milestone_expert_vote" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "expert_id" UUID NOT NULL,
    "choice" TEXT NOT NULL,
    "rationale" TEXT,
    "cast_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "milestone_expert_vote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "milestone_expert_vote_milestone_id_expert_id_key" ON "milestone_expert_vote"("milestone_id", "expert_id");
ALTER TABLE "milestone_expert_vote" ADD CONSTRAINT "milestone_expert_vote_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "milestone_expert_vote" ADD CONSTRAINT "milestone_expert_vote_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
