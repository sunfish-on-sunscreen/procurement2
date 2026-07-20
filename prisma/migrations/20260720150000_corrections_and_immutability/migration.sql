-- AlterTable
ALTER TABLE "GrnLine" ADD COLUMN     "correctionId" TEXT,
ADD COLUMN     "correctsLineId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "correctionId" TEXT,
ADD COLUMN     "correctsLineId" TEXT;

-- AlterTable
ALTER TABLE "PoLine" ADD COLUMN     "correctionId" TEXT,
ADD COLUMN     "correctsLineId" TEXT;

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Correction_poId_idx" ON "Correction"("poId");

-- CreateIndex
CREATE INDEX "Correction_createdAt_idx" ON "Correction"("createdAt");

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoLine" ADD CONSTRAINT "PoLine_correctsLineId_fkey" FOREIGN KEY ("correctsLineId") REFERENCES "PoLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoLine" ADD CONSTRAINT "PoLine_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "Correction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnLine" ADD CONSTRAINT "GrnLine_correctsLineId_fkey" FOREIGN KEY ("correctsLineId") REFERENCES "GrnLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnLine" ADD CONSTRAINT "GrnLine_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "Correction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_correctsLineId_fkey" FOREIGN KEY ("correctsLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "Correction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- IMMUTABILITY: posted transactional documents can never be UPDATEd.
--
-- A posted record is a statement about something that happened. Changing it in
-- place destroys the audit trail, so it is corrected by APPENDING a signed
-- correction line that nets against it (see the Correction table + correctsLineId).
--
-- Scope: UPDATE only. INSERT is how corrections are posted, and DELETE stays open
-- because the Phase-3 replace-all importer wipes and rebuilds the whole dataset.
--
-- ⚠️ The FKs above use ON DELETE SET NULL, and a referential action fires triggers —
-- so deleting a corrected line issues an UPDATE on its correction rows. That is the
-- reason the bulk-import escape hatch exists, not just a convenience: the importer
-- runs `SET LOCAL app.bulk_import = 'on'` inside its transaction, which this
-- function honours. `current_setting(..., true)` returns NULL when unset, so the
-- default behaviour is to block.
-- ============================================================================

CREATE OR REPLACE FUNCTION block_posted_update() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bulk_import', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Posted record is immutable: "%" cannot be updated. Post a correction entry instead.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER immutable_requisition   BEFORE UPDATE ON "Requisition"   FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_sourcingevent BEFORE UPDATE ON "SourcingEvent" FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_response      BEFORE UPDATE ON "Response"      FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_purchaseorder BEFORE UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_poline        BEFORE UPDATE ON "PoLine"        FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_goodsreceipt  BEFORE UPDATE ON "GoodsReceipt"  FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_grnline       BEFORE UPDATE ON "GrnLine"       FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_invoice       BEFORE UPDATE ON "Invoice"       FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_invoiceline   BEFORE UPDATE ON "InvoiceLine"   FOR EACH ROW EXECUTE FUNCTION block_posted_update();
CREATE TRIGGER immutable_payment       BEFORE UPDATE ON "Payment"       FOR EACH ROW EXECUTE FUNCTION block_posted_update();
