import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * LINE-level read access (lock C). Item detail — itemName / unit / per-line
 * quantity + unit price — lives on `PoLine`, NOT on the PO-grain EnrichedPurchase
 * view. Every item-level consumer (spend-by-item, evolution product-mix, report
 * supplier-brief item breakdown) reads it here, joined to its PurchaseOrder for the
 * order-year (`poDate`) filter + period. `lineValueUsd` = quantityOrdered × unitPrice.
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
  const conds: Prisma.Sql[] = [];
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
      pl."itemName"                              AS "itemName",
      pl."unit"                                  AS "unit",
      pl."category"                              AS "category",
      pl."quantityOrdered"                       AS "quantity",
      pl."unitPriceUsd"                          AS "unitPriceUsd",
      (pl."quantityOrdered" * pl."unitPriceUsd") AS "lineValueUsd",
      po."poDate"                                AS "poDate",
      po."period"                                AS "period"
    FROM "PoLine" pl
    JOIN "PurchaseOrder" po ON po.id = pl."poId"
    ${where}
  `);
}
