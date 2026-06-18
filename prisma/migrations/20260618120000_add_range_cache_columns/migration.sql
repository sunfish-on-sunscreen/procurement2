-- AlterTable
ALTER TABLE "AnalysisResult" ADD COLUMN     "rangeEndDate" TIMESTAMP(3),
ADD COLUMN     "rangeStartDate" TIMESTAMP(3),
ALTER COLUMN "periodId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AnalysisResult_rangeStartDate_rangeEndDate_idx" ON "AnalysisResult"("rangeStartDate", "rangeEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_rangeStartDate_rangeEndDate_analysisType_key" ON "AnalysisResult"("rangeStartDate", "rangeEndDate", "analysisType");
