import { z } from "zod";
import { makeIdGen } from "@/lib/supplier-import";

/**
 * Shared purchase logic used by BOTH the bulk import (app/api/imports/upload) and
 * the single-record create (app/api/purchases): the PO id scheme + the
 * derived-field math.
 *
 * ⚠️ On the derived fields: the BULK IMPORT reads total_value_usd and every
 * *_days column verbatim from the file (they're precomputed there — and the
 * synthetic file's total_value is deliberately NOT qty×price, so recomputing it
 * would move every spend/score). A MANUAL add has no file value, so it computes:
 *   total_value_usd = round(quantity × unit_price_usd, 2)   (the only sensible total)
 *   pr_to_po_days           = days(po_date − pr_date)
 *   po_to_delivery_days     = days(delivery_date − po_date)
 *   delivery_to_invoice_days= days(invoice_date − delivery_date)
 *   invoice_to_payment_days = days(payment_date − invoice_date)
 *   total_cycle_days        = days(payment_date − pr_date)   (= sum of the 4 gaps)
 * The 5 cycle-days reproduce the import's file convention EXACTLY (verified: the
 * file's *_days are exact date-differences on 100% of rows). computeDerivedFields
 * is the single home for this math — no Python is involved (pure date/number).
 */

const MS_PER_DAY = 86_400_000;

/** Whole-day difference between two dates (both parsed the same way, so clean). */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export const PO_ID_RE = /^PO-(\d+)$/;

/** Format a PO id from a sequence number: 648 -> "PO-0000648". */
export function formatPoId(seq: number): string {
  return `PO-${String(seq).padStart(7, "0")}`;
}

/** PO id generator continuing after the highest existing id (bulk: in-file ids;
 *  single-create: DB ids). Shares the exact scheme via makeIdGen. */
export function makePoIdGen(existing: (string | undefined)[]) {
  return makeIdGen(existing, "PO-", 7, PO_ID_RE);
}

/** The next PO id given the ids already in use. */
export function nextPoId(existing: (string | undefined)[]): string {
  return makePoIdGen(existing)();
}

export type DerivedFieldInputs = {
  quantity: number;
  unitPriceUsd: number;
  prDate: Date;
  poDate: Date;
  deliveryDate: Date;
  invoiceDate: Date;
  paymentDate: Date;
};

export type DerivedFields = {
  totalValueUsd: number;
  prToPoDays: number;
  poToDeliveryDays: number;
  deliveryToInvoiceDays: number;
  invoiceToPaymentDays: number;
  totalCycleDays: number;
};

/** The single source of truth for a purchase's computed fields (see file docs). */
export function computeDerivedFields(i: DerivedFieldInputs): DerivedFields {
  return {
    totalValueUsd: round2(i.quantity * i.unitPriceUsd),
    prToPoDays: daysBetween(i.prDate, i.poDate),
    poToDeliveryDays: daysBetween(i.poDate, i.deliveryDate),
    deliveryToInvoiceDays: daysBetween(i.deliveryDate, i.invoiceDate),
    invoiceToPaymentDays: daysBetween(i.invoiceDate, i.paymentDate),
    totalCycleDays: daysBetween(i.prDate, i.paymentDate),
  };
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

/**
 * Single-create request body. NOTE this is DELIBERATELY a different shape from
 * the bulk import's PurchasesRow: no total_value_usd and no *_days (those are
 * computed here), no po_id (server-assigned). supplier_id is a required
 * reference to an EXISTING supplier (validated in the route → orphan-proof).
 */
export const CreatePurchaseBody = z.object({
  supplier_id: z.string().trim().min(1, "Supplier is required"),
  item_name: z.string().trim().min(1, "Item name is required"),
  unit: z.string().trim().min(1, "Unit is required"),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_price_usd: z.number().nonnegative("Unit price cannot be negative"),
  defect_count: z.number().int().nonnegative("Defect count cannot be negative"),
  complaint_count: z.number().int().nonnegative("Complaint count cannot be negative"),
  on_time_delivery: z.boolean(),
  three_way_match_pass: z.boolean(),
  pr_date: dateStr,
  po_date: dateStr,
  delivery_date: dateStr,
  invoice_date: dateStr,
  payment_date: dateStr,
});

export type CreatePurchaseInput = z.infer<typeof CreatePurchaseBody>;

/** Parse a YYYY-MM-DD body date as UTC midnight (matches the import's date
 *  handling, so day-differences are clean whole numbers). */
export function parseBodyDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * Parse + validate the 5 purchase dates (shared by create + edit): they must be
 * valid AND non-decreasing (PR ≤ PO ≤ Delivery ≤ Invoice ≤ Payment) so a manual
 * write can never produce a negative cycle-day.
 */
export function parsePurchaseDates(b: {
  pr_date: string;
  po_date: string;
  delivery_date: string;
  invoice_date: string;
  payment_date: string;
}):
  | { ok: true; prDate: Date; poDate: Date; deliveryDate: Date; invoiceDate: Date; paymentDate: Date }
  | { ok: false; error: string } {
  const prDate = parseBodyDate(b.pr_date);
  const poDate = parseBodyDate(b.po_date);
  const deliveryDate = parseBodyDate(b.delivery_date);
  const invoiceDate = parseBodyDate(b.invoice_date);
  const paymentDate = parseBodyDate(b.payment_date);
  const ordered = [prDate, poDate, deliveryDate, invoiceDate, paymentDate];
  if (ordered.some((d) => Number.isNaN(d.getTime()))) {
    return { ok: false, error: "One or more dates are invalid." };
  }
  for (let k = 1; k < ordered.length; k++) {
    if (ordered[k].getTime() < ordered[k - 1].getTime()) {
      return {
        ok: false,
        error: "Dates must be in order: PR ≤ PO ≤ Delivery ≤ Invoice ≤ Payment.",
      };
    }
  }
  return { ok: true, prDate, poDate, deliveryDate, invoiceDate, paymentDate };
}

/** All the pieces a Purchase row needs, with derived fields computed here. */
export type PurchaseCreateArgs = {
  poId: string;
  supplierExternalId: string;
  supplierName: string;
  category: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPriceUsd: number;
  defectCount: number;
  complaintCount: number;
  onTimeDelivery: boolean;
  threeWayMatchPass: boolean;
  prDate: Date;
  poDate: Date;
  deliveryDate: Date;
  invoiceDate: Date;
  paymentDate: Date;
  periodId: string;
};

/** Map resolved inputs to a Prisma Purchase create object (derived fields via
 *  computeDerivedFields — the same math the bulk import's file values follow). */
export function toPurchaseCreateData(a: PurchaseCreateArgs) {
  const d = computeDerivedFields(a);
  return {
    poId: a.poId,
    supplierExternalId: a.supplierExternalId,
    supplierName: a.supplierName,
    category: a.category,
    itemName: a.itemName,
    unit: a.unit,
    quantity: a.quantity,
    unitPriceUsd: a.unitPriceUsd,
    totalValueUsd: d.totalValueUsd,
    prDate: a.prDate,
    poDate: a.poDate,
    deliveryDate: a.deliveryDate,
    invoiceDate: a.invoiceDate,
    paymentDate: a.paymentDate,
    prToPoDays: d.prToPoDays,
    poToDeliveryDays: d.poToDeliveryDays,
    deliveryToInvoiceDays: d.deliveryToInvoiceDays,
    invoiceToPaymentDays: d.invoiceToPaymentDays,
    totalCycleDays: d.totalCycleDays,
    onTimeDelivery: a.onTimeDelivery,
    threeWayMatchPass: a.threeWayMatchPass,
    defectCount: a.defectCount,
    complaintCount: a.complaintCount,
    periodId: a.periodId,
  };
}
