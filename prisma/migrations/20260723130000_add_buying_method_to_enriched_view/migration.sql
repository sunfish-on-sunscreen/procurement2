-- Expose PurchaseOrder.buyingMethod on the EnrichedPurchase view.
--
-- WHY THE VIEW, not a new query joining PurchaseOrder: the view already carries the
-- void exclusion (WHERE NOT EXISTS PurchaseOrderVoid), so routing buying_method
-- through it inherits that filter for free. A direct join in the compute layer would
-- have created a FIFTH void-filter site — the exact trap CLAUDE.md flags on
-- load_po_lines ("THE EASY ONE TO MISS"), where a voided order silently leaks back in.
--
-- PURELY ADDITIVE: the column is appended at the END of the select list, which is the
-- only shape CREATE OR REPLACE VIEW permits, so every existing column keeps its
-- ordinal position, name and type. No existing value changes — verified by the
-- unchanged md5 of every analysis other than cycle_time.
--
-- Feeds cycle_time.cycle_by_method + the mix-adjusted trend decomposition: cycle time
-- is near-deterministic in buying method (spot_buy ~44d -> direct ~130d), so the pooled
-- mean is a weighted mixture and a shift in method mix can reverse the apparent trend.

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
  po.period                                               AS "period",
  po."buyingMethod"                                       AS "buyingMethod"
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
