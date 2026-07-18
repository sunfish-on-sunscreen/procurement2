-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingPeriod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "supplierExternalId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPriceUsd" DOUBLE PRECISION NOT NULL,
    "totalValueUsd" DOUBLE PRECISION NOT NULL,
    "prDate" TIMESTAMP(3) NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "prToPoDays" INTEGER NOT NULL,
    "poToDeliveryDays" INTEGER NOT NULL,
    "deliveryToInvoiceDays" INTEGER NOT NULL,
    "invoiceToPaymentDays" INTEGER NOT NULL,
    "totalCycleDays" INTEGER NOT NULL,
    "onTimeDelivery" BOOLEAN NOT NULL,
    "threeWayMatchPass" BOOLEAN NOT NULL,
    "automationPeriod" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMetric" (
    "id" TEXT NOT NULL,
    "supplierExternalId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "totalSpendUsd" DOUBLE PRECISION NOT NULL,
    "numPos" INTEGER NOT NULL,
    "avgPoValueUsd" DOUBLE PRECISION NOT NULL,
    "avgLeadTimeDays" DOUBLE PRECISION NOT NULL,
    "avgCycleTimeDays" DOUBLE PRECISION NOT NULL,
    "onTimeDeliveryPct" DOUBLE PRECISION NOT NULL,
    "threeWayMatchPct" DOUBLE PRECISION NOT NULL,
    "defectRatePct" DOUBLE PRECISION NOT NULL,
    "complaintCountAnnual" INTEGER NOT NULL,
    "rfxResponseRatePct" DOUBLE PRECISION NOT NULL,
    "avgResponseTimeDays" DOUBLE PRECISION NOT NULL,
    "singleSourceRisk" INTEGER NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "deliveryScore" DOUBLE PRECISION NOT NULL,
    "serviceScore" DOUBLE PRECISION NOT NULL,
    "processScore" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "calculatedTier" TEXT NOT NULL,
    "tierMismatch" BOOLEAN NOT NULL,
    "periodId" TEXT NOT NULL,

    CONSTRAINT "SupplierMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "errorMessage" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "analysisType" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveSummary" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL,

    CONSTRAINT "ExecutiveSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingPeriod_name_key" ON "ReportingPeriod"("name");

-- CreateIndex
CREATE INDEX "Supplier_periodId_idx" ON "Supplier"("periodId");

-- CreateIndex
CREATE INDEX "Supplier_category_idx" ON "Supplier"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_externalId_periodId_key" ON "Supplier"("externalId", "periodId");

-- CreateIndex
CREATE INDEX "Purchase_periodId_idx" ON "Purchase"("periodId");

-- CreateIndex
CREATE INDEX "Purchase_supplierExternalId_periodId_idx" ON "Purchase"("supplierExternalId", "periodId");

-- CreateIndex
CREATE INDEX "Purchase_automationPeriod_idx" ON "Purchase"("automationPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_poId_periodId_key" ON "Purchase"("poId", "periodId");

-- CreateIndex
CREATE INDEX "SupplierMetric_periodId_idx" ON "SupplierMetric"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierMetric_supplierExternalId_periodId_key" ON "SupplierMetric"("supplierExternalId", "periodId");

-- CreateIndex
CREATE INDEX "Import_periodId_idx" ON "Import"("periodId");

-- CreateIndex
CREATE INDEX "Import_uploadedAt_idx" ON "Import"("uploadedAt");

-- CreateIndex
CREATE INDEX "AnalysisResult_periodId_idx" ON "AnalysisResult"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_periodId_analysisType_key" ON "AnalysisResult"("periodId", "analysisType");

-- CreateIndex
CREATE INDEX "ExecutiveSummary_periodId_idx" ON "ExecutiveSummary"("periodId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMetric" ADD CONSTRAINT "SupplierMetric_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveSummary" ADD CONSTRAINT "ExecutiveSummary_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveSummary" ADD CONSTRAINT "ExecutiveSummary_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
