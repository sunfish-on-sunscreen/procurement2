import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { CONFIG_BY_TABLE, type BrowserRow } from "@/lib/data-browser-config";
import { REQUIRED_COLUMNS, type SheetName } from "@/lib/dataset-import";

export const runtime = "nodejs";

/**
 * Read-only browser over the 12 dataset tables.
 *
 * STRICTLY READ-ONLY: selects only, no writes, no recompute, no analytics. One
 * route for every table — the config says which columns to show, this says how to
 * fetch them and how to resolve the two filter dimensions.
 *
 * ⚠️ Returns the WHOLE table (largest is grn_lines at ~1.5k rows); the client then
 * filters and paginates in memory, so filtering is instant rather than a round trip
 * per keystroke. If any single table ever passes ~10k rows, switch to skip/take +
 * a count here — the row contract and all 12 configs stay unchanged, so the change
 * is contained to this file plus the pagination hook.
 */

/** Dates render as plain ISO days: stable, sortable, and hydration-safe. */
const d = (v: Date | null): string | null => (v ? v.toISOString().slice(0, 10) : null);

/**
 * The browser config cannot import `REQUIRED_COLUMNS` (that module pulls in xlsx,
 * which must not reach the client bundle), so the two are checked against each
 * other here instead. A column added to the sheet schema but missed in the config
 * fails loudly rather than quietly disappearing from the browser.
 */
function assertNoColumnDrift(table: string, configKeys: string[]): string | null {
  const required = REQUIRED_COLUMNS[table as SheetName];
  if (!required) return null;
  const have = new Set(configKeys);
  const missing = required.filter((c) => !have.has(c));
  return missing.length > 0
    ? `Data-browser config for "${table}" is missing required column(s): ${missing.join(", ")}.`
    : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { session, stale } = await readSession();
  if (stale) {
    return NextResponse.json(
      { error: "Your session is no longer valid — sign out and sign in again." },
      { status: 401 },
    );
  }
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { table } = await params;
  const config = CONFIG_BY_TABLE.get(table);
  if (!config) {
    return NextResponse.json({ error: `Unknown table "${table}".` }, { status: 400 });
  }

  const drift = assertNoColumnDrift(table, config.columns.map((c) => c.key));
  if (drift) return NextResponse.json({ error: drift }, { status: 500 });

  let rows: BrowserRow[];

  switch (table) {
    case "suppliers": {
      const recs = await prisma.supplier.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          supplierName: true,
          country: true,
          category: true,
          status: true,
          isMiningService: true,
          iujpNo: true,
          iujpValidUntil: true,
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          supplier_id: r.id,
          supplier_name: r.supplierName,
          country: r.country,
          category: r.category,
          status: r.status,
          is_mining_service: r.isMiningService,
          iujp_no: r.iujpNo,
          iujp_valid_until: d(r.iujpValidUntil),
        },
        // Supplier IS the dimension here; there is no period on master data.
        _supplierId: r.id,
        _supplierName: r.supplierName,
        _period: null,
      }));
      break;
    }

    case "purchase_orders": {
      const recs = await prisma.purchaseOrder.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          prId: true,
          sourcingEventId: true,
          supplierId: true,
          buyingMethod: true,
          frameworkId: true,
          justification: true,
          poDate: true,
          promisedDeliveryDate: true,
          paymentTerms: true,
          complaintCount: true,
          status: true,
          period: true,
          supplier: { select: { supplierName: true } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          po_id: r.id,
          pr_id: r.prId,
          sourcing_event_id: r.sourcingEventId,
          supplier_id: r.supplierId,
          buying_method: r.buyingMethod,
          framework_id: r.frameworkId,
          justification: r.justification,
          po_date: d(r.poDate),
          promised_delivery_date: d(r.promisedDeliveryDate),
          payment_terms: r.paymentTerms,
          complaint_count: r.complaintCount,
          status: r.status,
          period: r.period,
        },
        _supplierId: r.supplierId,
        _supplierName: r.supplier.supplierName,
        _period: r.period,
      }));
      break;
    }

    case "payments": {
      const recs = await prisma.payment.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          invoiceId: true,
          paymentDate: true,
          amountPaidUsd: true,
          method: true,
          // Two hops for the filter keys: the payment itself carries neither.
          invoice: {
            select: {
              supplierId: true,
              supplier: { select: { supplierName: true } },
              po: { select: { period: true } },
            },
          },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          payment_id: r.id,
          invoice_id: r.invoiceId,
          payment_date: d(r.paymentDate),
          amount_paid_usd: r.amountPaidUsd,
          method: r.method,
        },
        _supplierId: r.invoice.supplierId,
        _supplierName: r.invoice.supplier.supplierName,
        _period: r.invoice.po.period,
      }));
      break;
    }

    default:
      return NextResponse.json(
        { error: `Table "${table}" is configured but has no query yet.` },
        { status: 501 },
      );
  }

  return NextResponse.json({ rows });
}
