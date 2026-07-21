import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * LINE-level read access (lock C). Item detail — itemName / unit / per-line
 * quantity + unit price — lives on `PoLine`, NOT on the PO-grain EnrichedPurchase
 * view. Every item-level consumer (spend-by-item, evolution product-mix, report
 * supplier-brief item breakdown) reads it here, joined to its PurchaseOrder for the
 * order-year (`poDate`) filter + period. `lineValueUsd` = quantityOrdered × unitPrice.
 *
 * ⚠️ CORRECTIONS FOLD INTO THE CORRECTED ITEM. A correction is an appended line with
 * a signed quantity and `correctsLineId` pointing at the original. Its own
 * itemName/unit/category are NOT authoritative — a correction is a statement about
 * the original transaction, not a new item — so the identity columns resolve to the
 * ORIGINAL line. The signed quantity and value then net against that item instead of
 * appearing as a phantom negative-quantity row in any breakdown.
 */
export interface PoLineRow {
  poId: string;
  supplierExternalId: string;
  itemName: string;
  unit: string;
  category: string; // the line's own category (not the PO's dominant one)
  quantity: number; // quantityOrdered for this line
  unitPriceUsd: number;
  lineValueUsd: number;
  poDate: Date;
  period: string; // order-year, from the PurchaseOrder
}

export interface PoLineFilter {
  start?: Date;
  end?: Date;
  supplierExternalId?: string;
}

/** PoLine rows joined to their PurchaseOrder, filtered by poDate span + supplier. */
export async function getPoLines(filter: PoLineFilter = {}): Promise<PoLineRow[]> {
  // ⚠️ UNCONDITIONAL, and seeded first so it survives every filter combination.
  // This is one of only two analytics readers that joins PoLine to PurchaseOrder
  // directly rather than reading the EnrichedPurchase view (the other is Python's
  // load_po_lines), so the view's void exclusion does NOT reach it. Without this a
  // voided order would still appear in spend-by-item, the evolution product mix and
  // the report supplier brief, while being absent from every PO-grain number.
  const conds: Prisma.Sql[] = [
    Prisma.sql`NOT EXISTS (SELECT 1 FROM "PurchaseOrderVoid" v WHERE v."poId" = po.id)`,
  ];
  if (filter.start) conds.push(Prisma.sql`po."poDate" >= ${filter.start}`);
  if (filter.end) conds.push(Prisma.sql`po."poDate" <= ${filter.end}`);
  if (filter.supplierExternalId)
    conds.push(Prisma.sql`po."supplierId" = ${filter.supplierExternalId}`);
  const where = conds.length
    ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`
    : Prisma.empty;
  return prisma.$queryRaw<PoLineRow[]>(Prisma.sql`
    SELECT
      pl."poId"                                  AS "poId",
      po."supplierId"                            AS "supplierExternalId",
      COALESCE(orig."itemName", pl."itemName")   AS "itemName",
      COALESCE(orig."unit", pl."unit")           AS "unit",
      COALESCE(orig."category", pl."category")   AS "category",
      pl."quantityOrdered"                       AS "quantity",
      pl."unitPriceUsd"                          AS "unitPriceUsd",
      (pl."quantityOrdered" * pl."unitPriceUsd") AS "lineValueUsd",
      po."poDate"                                AS "poDate",
      po."period"                                AS "period"
    FROM "PoLine" pl
    JOIN "PurchaseOrder" po ON po.id = pl."poId"
    LEFT JOIN "PoLine" orig ON orig.id = pl."correctsLineId"
    ${where}
  `);
}
