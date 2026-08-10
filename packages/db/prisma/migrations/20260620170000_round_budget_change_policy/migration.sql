-- §12 — budget-change policy round settings (YES/NO stored as 1/0; null = default).
ALTER TABLE "round" ADD COLUMN "ignore_budget_change" INTEGER;
ALTER TABLE "round" ADD COLUMN "require_fee_top_up" INTEGER;
ALTER TABLE "round" ADD COLUMN "require_fee_return" INTEGER;
