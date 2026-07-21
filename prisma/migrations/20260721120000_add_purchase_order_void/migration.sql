-- VOID a purchase order — audit-safe, by APPENDING rather than mutating.
--
-- A void marks an order as entered-in-error: it is excluded from every analytic,
-- but nothing is deleted and the row stays browsable. The posted PurchaseOrder is
-- NOT touched — no status flip, no immutability-trigger change, no bypass flag.
-- This is the same discipline the rest of the model already uses: corrections
-- append signed rows, supplier edits append history, and a void appends this row.
--
-- The void row IS the audit record (who / when / why), so there is no separate log.
-- Un-voiding is a plain DELETE of this row, which no trigger blocks.

CREATE TABLE "PurchaseOrderVoid" (
  -- PK = poId: an order is either void or not, so at most one row per order.
  "poId"     TEXT         NOT NULL,
  "reason"   TEXT         NOT NULL,
  "voidedBy" TEXT         NOT NULL,
  "voidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PurchaseOrderVoid_pkey" PRIMARY KEY ("poId")
);

-- ⚠️ CASCADE, deliberately. A replace-all import wipes PurchaseOrder wholesale; a
-- void is a statement about one specific posted order, so once that order is gone
-- the void refers to nothing and cannot be meaningfully reattached — the same
-- reasoning the importer already applies to corrections. RESTRICT here would make
-- any replace-all fail while a void existed. The importer counts and reports these
-- before the wipe, so the loss is never silent.
ALTER TABLE "PurchaseOrderVoid"
  ADD CONSTRAINT "PurchaseOrderVoid_poId_fkey"
  FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: the author of a void must remain resolvable, as with SupplierChangeLog.
ALTER TABLE "PurchaseOrderVoid"
  ADD CONSTRAINT "PurchaseOrderVoid_voidedBy_fkey"
  FOREIGN KEY ("voidedBy") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PurchaseOrderVoid_voidedAt_idx" ON "PurchaseOrderVoid"("voidedAt");

-- ---------------------------------------------------------------------------
-- Re-create the view with the void exclusion.
--
-- This single WHERE is the primary chokepoint: it covers the whole Python compute
-- layer (seed_compute + compute_analyses load_frames -> all six analyses and every
-- SupplierMetric), getEnrichedPurchases and its four callers, and the two raw
-- spend queries. The ONLY analytics readers it does NOT cover are the two that
-- join PoLine -> PurchaseOrder directly (compute_analyses.load_po_lines and
-- lib/po-lines.ts) plus lib/suppliers.ts getSupplierDirectory — those carry the
-- same NOT EXISTS in their own SQL.
--
-- Everything below the WHERE is unchanged from 20260720140000_correction_aware_view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW "EnrichedPurchase" AS
WITH line_agg AS (
  SELECT
    pl."poId"                                        AS po_id,
    SUM(pl."quantityOrdered" * pl."unitPriceUsd")    AS total_value,
    SUM(pl."quantityOrdered")                        AS quantity
  FROM "PoLine" pl
  GROUP BY pl."poId"
),
cat_value AS (
  -- Net value per (po, category) — corrections net against their own category.
  SELECT
    pl."poId"                                     AS po_id,
    pl.category                                   AS category,
    SUM(pl."quantityOrdered" * pl."unitPriceUsd") AS cat_value
  FROM "PoLine" pl
  GROUP BY pl."poId", pl.category
),
dom_cat AS (
  -- Dominant category = highest NET value; category name breaks ties deterministically.
  SELECT DISTINCT ON (cv.po_id)
    cv.po_id   AS po_id,
    cv.category AS category
  FROM cat_value cv
  ORDER BY cv.po_id, cv.cat_value DESC, cv.category
),
recv AS (
  SELECT gr."poId" AS po_id, MAX(gr."receiptDate") AS delivery_date
  FROM "GoodsReceipt" gr
  GROUP BY gr."poId"
),
defects AS (
  SELECT gr."poId" AS po_id, COALESCE(SUM(gl."defectCount"), 0) AS defect_count
  FROM "GoodsReceipt" gr
  JOIN "GrnLine" gl ON gl."grnId" = gr.id
  GROUP BY gr."poId"
),
line_accept AS (
  SELECT gl."poLineId" AS po_line_id,
         SUM(gl."quantityReceived" - gl."quantityRejected") AS accepted_qty
  FROM "GrnLine" gl
  GROUP BY gl."poLineId"
),
line_bill AS (
  -- Billed quantity nets; the price is the VALUE-WEIGHTED effective price actually
  -- billed. NULLIF guards a fully-reversed line (net qty 0) -> NULL price, which
  -- the price test below COALESCEs to the PO price, i.e. no price objection.
  SELECT il."poLineId" AS po_line_id,
         SUM(il."quantityBilled") AS billed_qty,
         SUM(il."quantityBilled" * il."unitPriceUsd")
           / NULLIF(SUM(il."quantityBilled"), 0) AS invoice_unit_price
  FROM "InvoiceLine" il
  GROUP BY il."poLineId"
),
line_match AS (
  SELECT
    pl."poId" AS po_id,
    (
      ABS(COALESCE(lb.billed_qty, 0) - COALESCE(la.accepted_qty, 0)) <= 0.001
      AND ABS(COALESCE(lb.invoice_unit_price, pl."unitPriceUsd") - pl."unitPriceUsd") <= 0.01
    ) AS line_pass
  FROM "PoLine" pl
  LEFT JOIN line_accept la ON la.po_line_id = pl.id
  LEFT JOIN line_bill   lb ON lb.po_line_id = pl.id
),
match_agg AS (
  SELECT po_id, BOOL_AND(line_pass) AS three_way_match_pass
  FROM line_match
  GROUP BY po_id
),
inv AS (
  SELECT i."poId" AS po_id, MIN(i."invoiceDate") AS invoice_date
  FROM "Invoice" i
  GROUP BY i."poId"
),
pay AS (
  SELECT i."poId" AS po_id, MAX(p."paymentDate") AS payment_date
  FROM "Invoice" i
  JOIN "Payment" p ON p."invoiceId" = i.id
  GROUP BY i."poId"
)
SELECT
  po.id                                                   AS "poId",
  po."supplierId"                                         AS "supplierExternalId",
  s."supplierName"                                        AS "supplierName",
  dc.category                                             AS "category",
  la.quantity                                             AS "quantity",
  la.total_value                                          AS "totalValueUsd",
  r."prDate"                                              AS "prDate",
  po."poDate"                                             AS "poDate",
  recv.delivery_date                                      AS "deliveryDate",
  inv.invoice_date                                        AS "invoiceDate",
  pay.payment_date                                        AS "paymentDate",
  (po."poDate"::date        - r."prDate"::date)           AS "prToPoDays",
  (recv.delivery_date::date - po."poDate"::date)          AS "poToDeliveryDays",
  (inv.invoice_date::date   - recv.delivery_date::date)   AS "deliveryToInvoiceDays",
  (pay.payment_date::date   - inv.invoice_date::date)     AS "invoiceToPaymentDays",
  (pay.payment_date::date   - r."prDate"::date)           AS "totalCycleDays",
  (recv.delivery_date <= po."promisedDeliveryDate")       AS "onTimeDelivery",
  COALESCE(ma.three_way_match_pass, TRUE)                 AS "threeWayMatchPass",
  COALESCE(def.defect_count, 0)::int                      AS "defectCount",
  po."complaintCount"                                     AS "complaintCount",
  po.period                                               AS "period"
FROM "PurchaseOrder" po
JOIN "Supplier"    s ON s.id  = po."supplierId"
JOIN "Requisition" r ON r.id  = po."prId"
LEFT JOIN line_agg   la   ON la.po_id  = po.id
LEFT JOIN dom_cat    dc   ON dc.po_id  = po.id
LEFT JOIN recv            ON recv.po_id = po.id
LEFT JOIN defects    def  ON def.po_id = po.id
LEFT JOIN match_agg  ma   ON ma.po_id  = po.id
LEFT JOIN inv             ON inv.po_id  = po.id
LEFT JOIN pay             ON pay.po_id  = po.id
WHERE NOT EXISTS (
  SELECT 1 FROM "PurchaseOrderVoid" v WHERE v."poId" = po.id
);
