-- AlterTable: declared tier removed entirely (full tier rip-out)
ALTER TABLE "Supplier" DROP COLUMN "tier";
ALTER TABLE "SupplierMetric" DROP COLUMN "tier";
