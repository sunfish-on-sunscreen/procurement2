import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * PO-grain read access to the derived `EnrichedPurchase` VIEW — the single
 * derivation of the old flat-`Purchase` shape from the normalized document model.
 * Column names are byte-identical to the old `Purchase` table, so consumers read
 * them unchanged. Period membership is ORDER YEAR: filter by `poDate`.
 *
 * ⚠️ Item-level columns (itemName / unitPriceUsd / per-line quantity) are NOT on
 * the view — they are line-level. Read those from `PoLine` via `lib/po-lines.ts`.
 */
export interface EnrichedPurchaseRow {
  poId: string;
  supplierExternalId: string;
  supplierName: string;
  category: string;
  quantity: number; // total units ordered across the PO's lines
  totalValueUsd: number; // Σ(line qty × unit price)
  prDate: Date;
  poDate: Date;
  deliveryDate: Date;
  invoiceDate: Date;
  paymentDate: Date;
  prToPoDays: number;
  poToDeliveryDays: number;
  deliveryToInvoiceDays: number;
  invoiceToPaymentDays: number;
  totalCycleDays: number;
  onTimeDelivery: boolean;
  threeWayMatchPass: boolean;
  defectCount: number;
  complaintCount: number;
  period: string; // order-year "2024" | "2025" | "2026"
  /** rfq | tender | spot_buy | call_off | direct. Already returned by the
   *  `SELECT *` above — this only declares a column the view has carried since
   *  `20260723130000_add_buying_method_to_enriched_view`. No query change. */
  buyingMethod: string;
}

export interface EnrichedPurchaseFilter {
  /** Inclusive lower bound on poDate (order-year period membership). */
  start?: Date;
  /** Inclusive upper bound on poDate. */
  end?: Date;
  supplierExternalId?: string;
}

/** Rows from the EnrichedPurchase view, filtered by poDate span + optional supplier. */
export async function getEnrichedPurchases(
  filter: EnrichedPurchaseFilter = {},
): Promise<EnrichedPurchaseRow[]> {
  const conds: Prisma.Sql[] = [];
  if (filter.start) conds.push(Prisma.sql`"poDate" >= ${filter.start}`);
  if (filter.end) conds.push(Prisma.sql`"poDate" <= ${filter.end}`);
  if (filter.supplierExternalId)
    conds.push(Prisma.sql`"supplierExternalId" = ${filter.supplierExternalId}`);
  const where = conds.length
    ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`
    : Prisma.empty;
  return prisma.$queryRaw<EnrichedPurchaseRow[]>(
    Prisma.sql`SELECT * FROM "EnrichedPurchase" ${where}`,
  );
}
