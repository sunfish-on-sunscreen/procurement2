-- DropIndex
DROP INDEX "Purchase_automationPeriod_idx";

-- AlterTable
ALTER TABLE "Purchase" DROP COLUMN "automationPeriod";
