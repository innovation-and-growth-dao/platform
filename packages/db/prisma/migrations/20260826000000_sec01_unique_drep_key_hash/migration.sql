-- SEC-01 (defense-in-depth): one AppUser per DRep key hash. Postgres treats NULLs as distinct,
-- so this enforces uniqueness only across users that have actually bound a DRep key.
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_drep_key_hash_key" ON "app_user"("drep_key_hash");
