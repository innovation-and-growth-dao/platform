-- §12 — submitter's request to change a proposal's budget while ACTIVE. The board
-- approves or rejects; only on APPROVE does the proposal mutate + filtering votes clear.
CREATE TABLE "budget_change_request" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id"         UUID NOT NULL REFERENCES "proposal"("id"),
  "requester_id"        UUID NOT NULL REFERENCES "app_user"("id"),
  "prev_amount_ada"     BIGINT NOT NULL,
  "proposed_amount_ada" BIGINT NOT NULL,
  "proposed_milestones" JSONB NOT NULL,
  "reason"              TEXT,
  "status"              TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id"  UUID REFERENCES "app_user"("id"),
  "decided_feedback"    TEXT,
  "decided_at"          TIMESTAMPTZ(6),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "budget_change_request_proposal_id_status_idx" ON "budget_change_request"("proposal_id", "status");
