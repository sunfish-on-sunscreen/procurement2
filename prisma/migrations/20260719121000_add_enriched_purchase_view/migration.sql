-- Derivation adapter: a PLAIN (non-materialized) view that reconstructs a PO-grain
-- "enriched purchase" from the normalized document tables, matching the shape the
-- old flat "Purchase" table exposed. It is the SINGLE derivation step — both the
-- Python compute layer (SELECT * FROM "EnrichedPurchase") and the TS read routes
-- consume it. Line-level detail (itemName / unitPriceUsd / quantity per line) is NOT
-- exposed here (meaningless at PO grain) — line consumers read "PoLine" directly.
--
-- Column names are BYTE-IDENTICAL to the old flat "Purchase" columns (spend =
-- "totalValueUsd", supplier = "supplierExternalId", camelCase dates/*Days/flags) so
-- python/scores.py's rename map applies unchanged and load_frames needs ZERO renames.
--
-- Raw facts only live in the base tables; every value below is DERIVED here:
--   totalValueUsd          = Σ(po_line.quantityOrdered × unitPriceUsd)
--   quantity               = Σ(po_line.quantityOrdered)              [total units ordered]
--   category               = category of the highest-value po_line   [dominant line]
--   deliveryDate           = MAX(goods_receipt.receiptDate)          [final receipt]
--   defectCount            = Σ(grn_line.defectCount)
--   *Days                  = whole-day date differences
--   onTimeDelivery         = deliveryDate ≤ promisedDeliveryDate
--   threeWayMatchPass      = BOOL_AND over lines of
--                            ( |billed − accepted| ≤ tol AND |invoicePrice − poPrice| ≤ tol ),
--                            accepted = Σ(received − rejected). Does NOT require
--                            accepted == ordered — a correctly billed partial delivery PASSES.

CREATE VIEW "EnrichedPurchase" AS
WITH line_agg AS (
  -- PO-grain spend + total units from the lines.
  SELECT
    pl."poId"                                        AS po_id,
    SUM(pl."quantityOrdered" * pl."unitPriceUsd")    AS total_value,
    SUM(pl."quantityOrdered")                        AS quantity
  FROM "PoLine" pl
  GROUP BY pl."poId"
),
dom_cat AS (
  -- Dominant (highest line-value) category per PO; id tiebreak for determinism.
  SELECT DISTINCT ON (pl."poId")
    pl."poId"    AS po_id,
    pl.category  AS category
  FROM "PoLine" pl
  ORDER BY pl."poId", (pl."quantityOrdered" * pl."unitPriceUsd") DESC, pl.id
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
  -- Per po_line accepted qty across all its GRN lines (received − rejected).
  SELECT gl."poLineId" AS po_line_id,
         SUM(gl."quantityReceived" - gl."quantityRejected") AS accepted_qty
  FROM "GrnLine" gl
  GROUP BY gl."poLineId"
),
line_bill AS (
  -- Per po_line billed qty + invoice unit price (1 invoice_line per po_line).
  SELECT il."poLineId" AS po_line_id,
         SUM(il."quantityBilled") AS billed_qty,
         MAX(il."unitPriceUsd")   AS invoice_unit_price
  FROM "InvoiceLine" il
  GROUP BY il."poLineId"
),
line_match AS (
  -- Per-line 3-way-match verdict (lock A): invoice matches receipt (no overpay) +
  -- price, NOT ordered-vs-received. Tolerances: qty 0.001 unit, price 1 cent.
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
LEFT JOIN pay             ON pay.po_id  = po.id;
