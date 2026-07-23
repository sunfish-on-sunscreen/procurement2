-- Drop the seven SupplierMetric OPERATIONAL AGGREGATE columns.
--
-- They were rewritten on every recompute by python/seed_compute.py and read by
-- NOTHING: all four app-side SupplierMetric queries use an explicit `select` and
-- none names them, and no Python references them (compute_analyses loads the row
-- with SELECT */m.* but immediately narrows to supplier_id/supplier_name/category).
-- Every surface derives spend / PO count / OTD / 3-way-match / lead + cycle days
-- LIVE from the EnrichedPurchase view instead, so these were a stale-read trap.
--
-- ⚠️ The identically-named snake_case fields in python/scores.py are NOT these
-- columns and are LOAD-BEARING: on_time_delivery_pct and avg_lead_time_days build
-- delivery_score, three_way_match_pct builds process_score. Only the persisted
-- columns are dropped; the engine still computes all of them in memory.
--
-- Score columns are UNTOUCHED (qualityScore / deliveryScore / processScore /
-- riskScore / compositeScore are read by the evolution + spend-detail routes).
-- No figure changes: nothing reads what is being removed.

-- AlterTable
ALTER TABLE "SupplierMetric" DROP COLUMN "avgCycleTimeDays",
DROP COLUMN "avgLeadTimeDays",
DROP COLUMN "avgPoValueUsd",
DROP COLUMN "numPos",
DROP COLUMN "onTimeDeliveryPct",
DROP COLUMN "threeWayMatchPct",
DROP COLUMN "totalSpendUsd";
