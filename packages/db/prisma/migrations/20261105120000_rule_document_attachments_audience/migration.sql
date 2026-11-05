-- §27 — rule documents: comment audience + editable-by + attachments.
ALTER TABLE "rule_document" ADD COLUMN "comment_audience" TEXT NOT NULL DEFAULT 'MEMBERS';
ALTER TABLE "rule_document" ADD COLUMN "doc_editable_by" TEXT NOT NULL DEFAULT 'PROPOSER';

CREATE TABLE "rule_document_attachment" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT,
    "source_url" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_data_url" TEXT,
    "extracted_text" TEXT NOT NULL DEFAULT '',
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_document_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rule_document_attachment_document_id_sort_idx_idx" ON "rule_document_attachment"("document_id", "sort_idx");

ALTER TABLE "rule_document_attachment" ADD CONSTRAINT "rule_document_attachment_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rule_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
