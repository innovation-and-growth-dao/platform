-- CreateTable
CREATE TABLE "platform_secret" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_secret_pkey" PRIMARY KEY ("key")
);
