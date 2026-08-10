-- §2.1 — submitter application / role
CREATE TABLE "submitter_application" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "github_url" TEXT,
    "social_links" TEXT[],
    "logo_data_url" TEXT,
    "country" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    CONSTRAINT "submitter_application_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submitter_application_user_id_key" ON "submitter_application"("user_id");

ALTER TABLE "submitter_application" ADD CONSTRAINT "submitter_application_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grandfather everyone who has already submitted a proposal, so enforcing the new role doesn't
-- break the current round. They get an auto-approved application.
INSERT INTO "submitter_application" ("id", "user_id", "status", "display_name", "description", "social_links", "country", "created_at", "updated_at", "reviewed_at")
SELECT gen_random_uuid(), s.uid, 'APPROVED', COALESCE(u.display_name, 'Submitter'), 'Existing submitter (grandfathered when the submitter role was introduced).', ARRAY[]::TEXT[], 'unknown', now(), now(), now()
FROM (SELECT DISTINCT submitter_user_id AS uid FROM "proposal" WHERE submitter_user_id IS NOT NULL) s
JOIN "app_user" u ON u.id = s.uid
ON CONFLICT ("user_id") DO NOTHING;
