-- §15 — board-provided context for treasury transactions
CREATE TABLE "treasury_tx_annotation" (
    "id" UUID NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "by_user_id" UUID NOT NULL,
    "by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "treasury_tx_annotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treasury_tx_annotation_tx_hash_key" ON "treasury_tx_annotation"("tx_hash");
