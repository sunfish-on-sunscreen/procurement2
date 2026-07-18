-- Per-PO quality inputs on Purchase. Add with a transient DEFAULT 0 so the
-- existing rows validate, then DROP the default so new inserts must supply a
-- value (the sample re-import overwrites every row with real counts).
ALTER TABLE "Purchase" ADD COLUMN "defectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "complaintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "defectCount" DROP DEFAULT;
ALTER TABLE "Purchase" ALTER COLUMN "complaintCount" DROP DEFAULT;

-- Drop the removed SupplierMetric soft-survey inputs + the Service sub-score.
ALTER TABLE "SupplierMetric" DROP COLUMN "defectRatePct";
ALTER TABLE "SupplierMetric" DROP COLUMN "complaintCountAnnual";
ALTER TABLE "SupplierMetric" DROP COLUMN "rfxResponseRatePct";
ALTER TABLE "SupplierMetric" DROP COLUMN "avgResponseTimeDays";
ALTER TABLE "SupplierMetric" DROP COLUMN "singleSourceRisk";
ALTER TABLE "SupplierMetric" DROP COLUMN "serviceScore";
