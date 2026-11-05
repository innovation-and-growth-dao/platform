-- §30 — "Document for public comment" internal proposals: who may comment + edit, and attachments.
ALTER TABLE "proposal" ADD COLUMN "comment_audience" TEXT;
ALTER TABLE "proposal" ADD COLUMN "doc_editable_by" TEXT;

-- Files/links attached to a document proposal (UPLOAD stored as base64 data URL + extracted text,
-- or LINK to an external/Drive URL). Several per proposal; frozen once voting opens. Prisma supplies
-- the uuid id (@default(uuid())), matching the existing tables' convention (no DB default on id).
CREATE TABLE "proposal_attachment" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "source_url" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_data_url" TEXT,
    "extracted_text" TEXT NOT NULL DEFAULT '',
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_attachment_proposal_id_sort_idx_idx" ON "proposal_attachment"("proposal_id", "sort_idx");

ALTER TABLE "proposal_attachment" ADD CONSTRAINT "proposal_attachment_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
