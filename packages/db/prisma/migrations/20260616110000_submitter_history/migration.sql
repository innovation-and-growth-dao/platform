-- §2.1 — change history for approved submitter profiles
CREATE TABLE "submitter_application_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "github_url" TEXT,
    "social_links" TEXT[],
    "logo_data_url" TEXT,
    "country" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submitter_application_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "submitter_application_history_user_id_idx" ON "submitter_application_history"("user_id");
