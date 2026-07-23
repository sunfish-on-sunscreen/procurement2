import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * The correctable lines of one PO, with their CURRENT netted state, so the
 * correction dialog shows what a line stands at now rather than what it was
 * originally posted at. Correction rows themselves are excluded — a correction is
 * always posted against the original line.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const poId = new URL(request.url).searchParams.get("poId")?.trim();
  if (!poId) {
    return NextResponse.json({ error: "poId is required" }, { status: 400 });
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: {
      id: true,
      supplierId: true,
      poDate: true,
      supplier: { select: { supplierName: true } },
      voidRecord: { select: { poId: true } },
    },
  });
  if (!po) {
    return NextResponse.json({ error: `Purchase order ${poId} not found.` }, { status: 404 });
  }
  // The picker is built from the EnrichedPurchase view, so a voided order is already
  // absent from it. This guards the direct lookup: a client holding a stale list
  // could otherwise correct an order that counts towards nothing.
  if (po.voidRecord) {
    return NextResponse.json(
      { error: `${poId} is voided — a voided order cannot be corrected. Restore it first.` },
      { status: 409 },
    );
  }

  const lines = await prisma.poLine.findMany({
    where: { poId, correctsLineId: null },
    select: {
      id: true,
      itemName: true,
      category: true,
      unit: true,
      quantityOrdered: true,
      unitPriceUsd: true,
      corrections: { select: { quantityOrdered: true, unitPriceUsd: true } },
      invoiceLines: { select: { quantityBilled: true, unitPriceUsd: true } },
      grnLines: {
        select: { grnId: true, quantityReceived: true, quantityRejected: true, defectCount: true },
      },
    },
    orderBy: { id: "asc" },
  });

  // The rest of the chain, so the correction form can mirror the record-purchase
  // layout field for field. Everything here is READ-ONLY context: it is rendered
  // disabled, because none of it can be corrected — a wrong supplier or a wrong
  // date is fixed by voiding the order and re-recording it.
  const [chain, receipts] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        buyingMethod: true,
        frameworkId: true,
        justification: true,
        paymentTerms: true,
        complaintCount: true,
        poDate: true,
        promisedDeliveryDate: true,
        period: true,
        requisition: { select: { prDate: true, requester: true, department: true } },
        invoices: {
          select: {
            supplierInvoiceNo: true,
            invoiceDate: true,
            payments: { select: { paymentDate: true } },
          },
        },
      },
    }),
    prisma.goodsReceipt.findMany({
      where: { poId },
      select: { id: true, receiptDate: true, site: true, receivedBy: true, status: true },
      orderBy: { receiptDate: "asc" },
    }),
  ]);

  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const invoice = chain?.invoices[0] ?? null;

  return NextResponse.json({
    po: {
      id: po.id,
      supplierId: po.supplierId,
      supplierName: po.supplier.supplierName,
      poDate: po.poDate,
      buyingMethod: chain?.buyingMethod ?? "",
      frameworkId: chain?.frameworkId ?? null,
      justification: chain?.justification ?? null,
      paymentTerms: chain?.paymentTerms ?? "",
      complaintCount: chain?.complaintCount ?? 0,
      period: chain?.period ?? "",
      requester: chain?.requisition.requester ?? "",
      department: chain?.requisition.department ?? "",
      supplierInvoiceNo: invoice?.supplierInvoiceNo ?? "",
      dates: {
        pr: iso(chain?.requisition.prDate),
        po: iso(chain?.poDate),
        promised: iso(chain?.promisedDeliveryDate),
        invoice: iso(invoice?.invoiceDate),
        payment: iso(invoice?.payments[0]?.paymentDate),
      },
    },
    receipts: receipts.map((r) => ({
      id: r.id,
      receiptDate: iso(r.receiptDate),
      site: r.site,
      receivedBy: r.receivedBy,
      status: r.status,
    })),
    lines: lines.map((l) => {
      const netQty = l.quantityOrdered + l.corrections.reduce((s, c) => s + c.quantityOrdered, 0);
      const billedQty = l.invoiceLines.reduce((s, i) => s + i.quantityBilled, 0);
      const billedValue = l.invoiceLines.reduce((s, i) => s + i.quantityBilled * i.unitPriceUsd, 0);
      return {
        id: l.id,
        itemName: l.itemName,
        category: l.category,
        unit: l.unit,
        orderedQty: l.quantityOrdered,
        netQty,
        unitPriceUsd: l.unitPriceUsd,
        // Net billed quantity. Exposed so the dialog can price a billing
        // correction client-side (value moved = billedQty × price change)
        // without a server dry-run.
        billedQty,
        // Value-weighted effective billed price — the same figure the view compares.
        billedPrice: billedQty !== 0 ? billedValue / billedQty : null,
        defects: l.grnLines.reduce((s, g) => s + g.defectCount, 0),
        correctionCount: l.corrections.length,
        // Per-receipt quantities, so the receipt cards can mirror record-purchase.
        // ⚠️ Defects are NOT broken out per receipt here: a defect correction is
        // per PO LINE, aggregated across every GRN, so the form shows the total on
        // the order line instead. That divergence from record-purchase is
        // deliberate — see the correction form.
        receiptQuantities: l.grnLines.map((g) => ({
          grnId: g.grnId,
          received: g.quantityReceived,
          rejected: g.quantityRejected,
        })),
      };
    }),
  });
}
