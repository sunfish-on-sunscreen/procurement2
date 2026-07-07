import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  CreatePurchaseBody,
  parsePurchaseDates,
  toPurchaseCreateData,
} from "@/lib/purchase-import";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

/**
 * Edit ONE purchase (admin). The PO id is LOCKED (its identity). Everything else
 * is editable — including the SUPPLIER (re-point): the recompute is global across
 * suppliers, so both the old and new supplier's aggregates move in one pass. The
 * derived fields (total_value + all 5 cycle-days) are RECOMPUTED via the shared
 * computeDerivedFields (in toPurchaseCreateData); date-ordering is enforced so
 * cycle days can't go negative; and the row is re-tagged to its (possibly new)
 * PAYMENT-year period. Then all periods recompute.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreatePurchaseBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await prisma.purchase.findFirst({ where: { poId: id }, select: { poId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  // Supplier must exist (existing-only re-point → orphan-proof); denormalize its
  // name + category onto the purchase.
  const supplier = await prisma.supplier.findFirst({
    where: { externalId: data.supplier_id },
    select: { supplierName: true, category: true },
    orderBy: { periodId: "desc" },
  });
  if (!supplier) {
    return NextResponse.json(
      { error: `Unknown supplier "${data.supplier_id}" — pick an existing supplier.` },
      { status: 400 },
    );
  }

  const dates = parsePurchaseDates(data);
  if (!dates.ok) {
    return NextResponse.json({ error: dates.error }, { status: 400 });
  }

  // Re-tag to the PAYMENT-year period (a payment-date edit can move the PO to a
  // different year); create the period if it doesn't exist yet.
  const year = dates.paymentDate.getUTCFullYear();
  const period = await prisma.reportingPeriod.upsert({
    where: { name: String(year) },
    create: {
      name: String(year),
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
    },
    update: {},
    select: { id: true },
  });

  // Build the full row via the shared mapper (derived fields recomputed here),
  // then update every column except the locked poId.
  const { poId: _locked, ...updateData } = toPurchaseCreateData({
    poId: id,
    supplierExternalId: data.supplier_id,
    supplierName: supplier.supplierName,
    category: supplier.category,
    itemName: data.item_name,
    unit: data.unit,
    quantity: data.quantity,
    unitPriceUsd: data.unit_price_usd,
    defectCount: data.defect_count,
    complaintCount: data.complaint_count,
    onTimeDelivery: data.on_time_delivery,
    threeWayMatchPass: data.three_way_match_pass,
    prDate: dates.prDate,
    poDate: dates.poDate,
    deliveryDate: dates.deliveryDate,
    invoiceDate: dates.invoiceDate,
    paymentDate: dates.paymentDate,
    periodId: period.id,
  });
  void _locked;

  await prisma.purchase.updateMany({ where: { poId: id }, data: updateData });

  const { ok, failedPeriods } = await recomputeAllPeriods();

  return NextResponse.json({
    success: true,
    purchase: {
      poId: id,
      totalValueUsd: updateData.totalValueUsd,
      totalCycleDays: updateData.totalCycleDays,
    },
    recomputed: true,
    recomputeWarning: ok ? null : `Recompute failed for: ${failedPeriods.join(", ")}`,
  });
}

/**
 * Delete ONE purchase (admin). No block rule — deleting a purchase can't orphan
 * anything; it just drops its supplier's aggregate for that PO. Delete + recompute.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.purchase.findFirst({ where: { poId: id }, select: { poId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  await prisma.purchase.deleteMany({ where: { poId: id } });

  const { ok, failedPeriods } = await recomputeAllPeriods();

  return NextResponse.json({
    success: true,
    deleted: id,
    recomputed: true,
    recomputeWarning: ok ? null : `Recompute failed for: ${failedPeriods.join(", ")}`,
  });
}
