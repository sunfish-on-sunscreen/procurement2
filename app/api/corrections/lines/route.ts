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
    select: { id: true, supplierId: true, poDate: true, supplier: { select: { supplierName: true } } },
  });
  if (!po) {
    return NextResponse.json({ error: `Purchase order ${poId} not found.` }, { status: 404 });
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
      grnLines: { select: { defectCount: true } },
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({
    po: { id: po.id, supplierId: po.supplierId, supplierName: po.supplier.supplierName, poDate: po.poDate },
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
        // Value-weighted effective billed price — the same figure the view compares.
        billedPrice: billedQty !== 0 ? billedValue / billedQty : null,
        defects: l.grnLines.reduce((s, g) => s + g.defectCount, 0),
        correctionCount: l.corrections.length,
      };
    }),
  });
}
