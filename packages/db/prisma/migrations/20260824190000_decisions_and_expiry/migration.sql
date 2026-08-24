-- AlterTable
ALTER TABLE "proposal" ADD COLUMN     "decision_content_hash" TEXT,
ADD COLUMN     "decision_delete_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decision_id" UUID;

-- AlterTable
ALTER TABLE "rule_document" ADD COLUMN     "expires_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "decision" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRIVATE',
    "owner_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_comment" (
    "id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "decision_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_status_idx" ON "decision"("status");

-- CreateIndex
CREATE INDEX "decision_comment_decision_id_idx" ON "decision_comment"("decision_id");

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_comment" ADD CONSTRAINT "decision_comment_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_comment" ADD CONSTRAINT "decision_comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_comment" ADD CONSTRAINT "decision_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "decision_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

