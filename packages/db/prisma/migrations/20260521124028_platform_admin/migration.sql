-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_2fa" (
    "admin_id" UUID NOT NULL,
    "totp_secret" TEXT NOT NULL,
    "enrolled_at" TIMESTAMPTZ(6),
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "admin_2fa_pkey" PRIMARY KEY ("admin_id")
);

-- CreateTable
CREATE TABLE "admin_recovery_code" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_invitation" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_login_attempt" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "ip" INET NOT NULL,
    "success" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "genesis_approved_at" TIMESTAMPTZ(6),
    "genesis_approved_by" UUID,
    "genesis_payload" JSONB,
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "platform_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_username_key" ON "admin_user"("username");

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_id_occurred_at_idx" ON "admin_audit_log"("admin_id", "occurred_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_occurred_at_idx" ON "admin_audit_log"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "admin_login_attempt_username_attempted_at_idx" ON "admin_login_attempt"("username", "attempted_at");

-- CreateIndex
CREATE INDEX "admin_login_attempt_ip_attempted_at_idx" ON "admin_login_attempt"("ip", "attempted_at");

-- AddForeignKey
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_2fa" ADD CONSTRAINT "admin_2fa_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_recovery_code" ADD CONSTRAINT "admin_recovery_code_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitation" ADD CONSTRAINT "admin_invitation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_state" ADD CONSTRAINT "platform_state_genesis_approved_by_fkey" FOREIGN KEY ("genesis_approved_by") REFERENCES "admin_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
