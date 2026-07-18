-- AlterTable: tier_mismatch + calculated_tier removed (methodology cleanup)
ALTER TABLE "SupplierMetric" DROP COLUMN "calculatedTier";
ALTER TABLE "SupplierMetric" DROP COLUMN "tierMismatch";
