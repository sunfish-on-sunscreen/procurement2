-- CreateTable
CREATE TABLE "ReportPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportPreset_createdBy_idx" ON "ReportPreset"("createdBy");

