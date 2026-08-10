-- §11 — stop-funding: reviewers (or board) may propose terminating funding for a
-- FUNDING-stage proposal; board votes 1-person-1-vote, 3-of-5 closes; APPROVED
-- moves the proposal to FAILED. Anchored on-chain like other governance decisions.

CREATE TABLE "stop_funding_proposal" (
  "id"               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id"      UUID            NOT NULL REFERENCES "proposal"("id"),
  "proposer_drep_id" UUID            REFERENCES "drep"("id"),
  "proposer_user_id" UUID            REFERENCES "app_user"("id"),
  "proposer_role"    TEXT            NOT NULL, -- REVIEWER | BOARD
  "reason"           TEXT            NOT NULL,
  "status"           TEXT            NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | APPROVED | REJECTED | WITHDRAWN
  "created_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
  "decided_at"       TIMESTAMPTZ(6),
  "anchor_tx_hash"   TEXT
);
CREATE INDEX "stop_funding_proposal_proposal_id_status_idx"
  ON "stop_funding_proposal" ("proposal_id", "status");

-- One ACTIVE stop-funding per proposal at a time (case-insensitive partial unique index).
CREATE UNIQUE INDEX "stop_funding_proposal_proposal_id_active_uniq"
  ON "stop_funding_proposal" ("proposal_id") WHERE ("status" = 'ACTIVE');

CREATE TABLE "stop_funding_vote" (
  "id"            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  "stop_id"       UUID            NOT NULL REFERENCES "stop_funding_proposal"("id"),
  "board_drep_id" UUID            NOT NULL REFERENCES "drep"("id"),
  "choice"        TEXT            NOT NULL, -- YES | NO
  "rationale"     TEXT,
  "cast_at"       TIMESTAMPTZ(6)  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "stop_funding_vote_stop_board_uniq"
  ON "stop_funding_vote" ("stop_id", "board_drep_id");
