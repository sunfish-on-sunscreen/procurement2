-- CreateTable
CREATE TABLE "SupplierChangeLog" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierChangeLog_supplierId_idx" ON "SupplierChangeLog"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierChangeLog_changedAt_idx" ON "SupplierChangeLog"("changedAt");

-- AddForeignKey
ALTER TABLE "SupplierChangeLog" ADD CONSTRAINT "SupplierChangeLog_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierChangeLog" ADD CONSTRAINT "SupplierChangeLog_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

