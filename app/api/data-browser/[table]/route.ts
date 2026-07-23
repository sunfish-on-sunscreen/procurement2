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

    case "frameworks": {
      const recs = await prisma.framework.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          supplierId: true,
          title: true,
          category: true,
          startDate: true,
          endDate: true,
          status: true,
          supplier: { select: { supplierName: true } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          framework_id: r.id,
          supplier_id: r.supplierId,
          title: r.title,
          category: r.category,
          start_date: d(r.startDate),
          end_date: d(r.endDate),
          status: r.status,
        },
        _supplierId: r.supplierId,
        _supplierName: r.supplier.supplierName,
        // A framework's own validity window is not a reporting period.
        _period: null,
      }));
      break;
    }

    case "requisitions": {
      const recs = await prisma.requisition.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          prDate: true,
          requester: true,
          department: true,
          category: true,
          needByDate: true,
          estimatedValueUsd: true,
          status: true,
          // 1:1 with its order, so `take: 1` loses nothing.
          purchaseOrders: {
            select: { supplierId: true, period: true, supplier: { select: { supplierName: true } } },
            take: 1,
          },
        },
      });
      rows = recs.map((r) => {
        const po = r.purchaseOrders[0] ?? null;
        return {
          id: r.id,
          cells: {
            pr_id: r.id,
            pr_date: d(r.prDate),
            requester: r.requester,
            department: r.department,
            category: r.category,
            need_by_date: d(r.needByDate),
            estimated_value_usd: r.estimatedValueUsd,
            status: r.status,
          },
          _supplierId: po?.supplierId ?? null,
          _supplierName: po?.supplier.supplierName ?? null,
          _period: po?.period ?? null,
        };
      });
      break;
    }

    case "sourcing_events": {
      const recs = await prisma.sourcingEvent.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          prId: true,
          issueDate: true,
          closeDate: true,
          numSuppliersInvited: true,
          awardedSupplierId: true,
          awardedResponseId: true,
          purchaseOrders: {
            select: { supplierId: true, period: true, supplier: { select: { supplierName: true } } },
            take: 1,
          },
        },
      });
      rows = recs.map((r) => {
        const po = r.purchaseOrders[0] ?? null;
        return {
          id: r.id,
          cells: {
            sourcing_event_id: r.id,
            pr_id: r.prId,
            issue_date: d(r.issueDate),
            close_date: d(r.closeDate),
            num_suppliers_invited: r.numSuppliersInvited,
            awarded_supplier_id: r.awardedSupplierId,
            awarded_response_id: r.awardedResponseId,
          },
          // Resolved through the PO so every table shares one anchor; identical to
          // awardedSupplierId in the data, but non-null by construction.
          _supplierId: po?.supplierId ?? null,
          _supplierName: po?.supplier.supplierName ?? null,
          _period: po?.period ?? null,
        };
      });
      break;
    }

    case "responses": {
      const recs = await prisma.response.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          sourcingEventId: true,
          supplierId: true,
          quotedUnitPriceUsd: true,
          quotedLeadTimeDays: true,
          submittedDate: true,
          isAwarded: true,
          supplier: { select: { supplierName: true } },
          sourcingEvent: { select: { purchaseOrders: { select: { period: true }, take: 1 } } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          response_id: r.id,
          sourcing_event_id: r.sourcingEventId,
          supplier_id: r.supplierId,
          quoted_unit_price_usd: r.quotedUnitPriceUsd,
          quoted_lead_time_days: r.quotedLeadTimeDays,
          submitted_date: d(r.submittedDate),
          is_awarded: r.isAwarded,
        },
        // ⚠️ The BIDDER, not the awarded supplier — a losing bid still belongs to
        // the supplier that made it, which is what "filter by supplier" should mean
        // on this table.
        _supplierId: r.supplierId,
        _supplierName: r.supplier.supplierName,
        _period: r.sourcingEvent.purchaseOrders[0]?.period ?? null,
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
          // Void state travels with the row so the browser can mute it and offer
          // the reverse action. Voided orders are NOT filtered out here — staying
          // visible is the whole point of voiding rather than deleting.
          voidRecord: { select: { poId: true } },
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
        _voided: r.voidRecord !== null,
      }));
      break;
    }

    case "po_lines": {
      const recs = await prisma.poLine.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          poId: true,
          itemName: true,
          category: true,
          unit: true,
          quantityOrdered: true,
          unitPriceUsd: true,
          needByDate: true,
          correctsLineId: true,
          po: { select: { supplierId: true, period: true, supplier: { select: { supplierName: true } } } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          po_line_id: r.id,
          po_id: r.poId,
          item_name: r.itemName,
          category: r.category,
          unit: r.unit,
          quantity_ordered: r.quantityOrdered,
          unit_price_usd: r.unitPriceUsd,
          need_by_date: d(r.needByDate),
          corrects_line_id: r.correctsLineId,
        },
        _supplierId: r.po.supplierId,
        _supplierName: r.po.supplier.supplierName,
        _period: r.po.period,
      }));
      break;
    }

    case "goods_receipts": {
      const recs = await prisma.goodsReceipt.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          poId: true,
          receiptDate: true,
          receivedBy: true,
          site: true,
          status: true,
          po: { select: { supplierId: true, period: true, supplier: { select: { supplierName: true } } } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          grn_id: r.id,
          po_id: r.poId,
          receipt_date: d(r.receiptDate),
          received_by: r.receivedBy,
          site: r.site,
          status: r.status,
        },
        _supplierId: r.po.supplierId,
        _supplierName: r.po.supplier.supplierName,
        _period: r.po.period,
      }));
      break;
    }

    case "grn_lines": {
      const recs = await prisma.grnLine.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          grnId: true,
          poLineId: true,
          quantityReceived: true,
          quantityRejected: true,
          defectCount: true,
          correctsLineId: true,
          // Two hops: the receipt line reaches the anchor through its receipt.
          goodsReceipt: {
            select: {
              po: { select: { supplierId: true, period: true, supplier: { select: { supplierName: true } } } },
            },
          },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          grn_line_id: r.id,
          grn_id: r.grnId,
          po_line_id: r.poLineId,
          quantity_received: r.quantityReceived,
          quantity_rejected: r.quantityRejected,
          defect_count: r.defectCount,
          corrects_line_id: r.correctsLineId,
        },
        _supplierId: r.goodsReceipt.po.supplierId,
        _supplierName: r.goodsReceipt.po.supplier.supplierName,
        _period: r.goodsReceipt.po.period,
      }));
      break;
    }

    case "invoices": {
      const recs = await prisma.invoice.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          poId: true,
          supplierId: true,
          supplierInvoiceNo: true,
          invoiceDate: true,
          totalAmountUsd: true,
          status: true,
          supplier: { select: { supplierName: true } },
          po: { select: { period: true } },
        },
      });
      rows = recs.map((r) => ({
        id: r.id,
        cells: {
          invoice_id: r.id,
          po_id: r.poId,
          supplier_id: r.supplierId,
          supplier_invoice_no: r.supplierInvoiceNo,
          invoice_date: d(r.invoiceDate),
          total_amount_usd: r.totalAmountUsd,
          status: r.status,
        },
        _supplierId: r.supplierId,
        _supplierName: r.supplier.supplierName,
        _period: r.po.period,
      }));
      break;
    }

    case "invoice_lines": {
      const recs = await prisma.invoiceLine.findMany({
        orderBy: { id: "asc" },
        select: {
          id: true,
          invoiceId: true,
          poLineId: true,
          quantityBilled: true,
          unitPriceUsd: true,
          correctsLineId: true,
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
          invoice_line_id: r.id,
          invoice_id: r.invoiceId,
          po_line_id: r.poLineId,
          quantity_billed: r.quantityBilled,
          unit_price_usd: r.unitPriceUsd,
          corrects_line_id: r.correctsLineId,
        },
        _supplierId: r.invoice.supplierId,
        _supplierName: r.invoice.supplier.supplierName,
        _period: r.invoice.po.period,
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
