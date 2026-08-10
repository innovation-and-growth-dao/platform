-- §8 — archive of superseded Debate & Vote rationales (read-only history).
CREATE TABLE "dv_rationale" (
  "id"          UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "drep_id"     UUID NOT NULL,
  "choice"      TEXT NOT NULL,
  "rationale"   TEXT,
  "cast_at"     TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "dv_rationale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dv_rationale_proposal_id_drep_id_idx" ON "dv_rationale" ("proposal_id", "drep_id");
