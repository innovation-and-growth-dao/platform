-- AlterTable
ALTER TABLE "proposal" ADD COLUMN     "rule_delete_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rule_doc_content_hash" TEXT,
ADD COLUMN     "rule_document_id" UUID;

-- CreateTable
CREATE TABLE "rule_document" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRIVATE',
    "owner_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_document_comment" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rule_document_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_document_status_idx" ON "rule_document"("status");

-- CreateIndex
CREATE INDEX "rule_document_comment_document_id_idx" ON "rule_document_comment"("document_id");

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_rule_document_id_fkey" FOREIGN KEY ("rule_document_id") REFERENCES "rule_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_document" ADD CONSTRAINT "rule_document_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_document_comment" ADD CONSTRAINT "rule_document_comment_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rule_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_document_comment" ADD CONSTRAINT "rule_document_comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_document_comment" ADD CONSTRAINT "rule_document_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rule_document_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

