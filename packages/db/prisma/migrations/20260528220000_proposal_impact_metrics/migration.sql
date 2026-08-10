-- §3.4 — additional optional proposal fields requested by the team:
--   ecosystem_impact_md — "Expected Ecosystem Impact" (markdown)
--   success_metrics_md  — "Success Metrics / KPIs" (markdown)

ALTER TABLE "proposal" ADD COLUMN "ecosystem_impact_md" TEXT;
ALTER TABLE "proposal" ADD COLUMN "success_metrics_md"  TEXT;
