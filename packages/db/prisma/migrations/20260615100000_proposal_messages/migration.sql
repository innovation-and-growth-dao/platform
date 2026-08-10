-- §3.5 — board ↔ submitter messaging per proposal
CREATE TABLE "proposal_message_thread" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(6),
    CONSTRAINT "proposal_message_thread_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_message_thread_proposal_id_idx" ON "proposal_message_thread"("proposal_id");

CREATE TABLE "proposal_message_entry" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "from_board" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proposal_message_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_message_entry_thread_id_idx" ON "proposal_message_entry"("thread_id");

ALTER TABLE "proposal_message_thread" ADD CONSTRAINT "proposal_message_thread_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposal_message_entry" ADD CONSTRAINT "proposal_message_entry_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "proposal_message_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
