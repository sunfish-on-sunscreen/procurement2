-- Drop the three denormalized kraljic columns from SupplierMetric.
--
-- They were WRITE-ONLY: rewritten by compute_analyses on every recompute and read
-- by zero application code (every consumer reads kraljic values from the `kraljic`
-- AnalysisResult payload instead). The architecture map already flagged
-- categoryCompetition as dead (V17); the same was true of the other two.
--
-- They were also the sole source of a non-determinism: the writeback UPDATE carried
-- no periodId filter, so all periods received the last-processed period's values,
-- and the period order came from an unordered SELECT (physical row order). Removing
-- the columns removes the writeback, and seed_compute now orders periods explicitly.

-- AlterTable
ALTER TABLE "SupplierMetric" DROP COLUMN "categoryCompetition",
DROP COLUMN "kraljicQuadrant",
DROP COLUMN "supplyRiskScore";

