import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  CreatePurchaseBody,
  nextPoId,
  toPurchaseCreateData,
} from "@/lib/purchase-import";

export const runtime = "nodejs";

/** Parse a YYYY-MM-DD body date as UTC midnight (matches the import's date
 *  handling, so day-differences are clean whole numbers). */
function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * Create ONE purchase (admin only). Mirrors the add-supplier single-create:
 * reuse the shared validation + id-gen + derived-field math (lib/purchase-import).
 * The supplier must ALREADY exist (existing-only reference → orphan-proof);
 * supplier_name + category are denormalized from it. total_value_usd + all 5
 * cycle-day fields are COMPUTED (the card never sends them). The PO is a targeted
 * INSERT tagged to its PAYMENT-year period (upserted if new) — no analyses
 * recompute and no range-cache clear, so cached scores stay byte-identical (the
 * new PO only shows in Purchase-derived LIVE views until a full reimport).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Supplier must exist — this is the single-create orphan guarantee. Denormalize
  // its name + category onto the purchase (purchase.category == supplier.category
  // holds for 100% of the imported data).
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

  // Parse + validate the 5 dates (format is guaranteed by zod; check validity +
  // ordering so a manual add can never produce a negative cycle-day).
  const prDate = parseDate(data.pr_date);
  const poDate = parseDate(data.po_date);
  const deliveryDate = parseDate(data.delivery_date);
  const invoiceDate = parseDate(data.invoice_date);
  const paymentDate = parseDate(data.payment_date);
  const dates = [prDate, poDate, deliveryDate, invoiceDate, paymentDate];
  if (dates.some((d) => Number.isNaN(d.getTime()))) {
    return NextResponse.json({ error: "One or more dates are invalid." }, { status: 400 });
  }
  for (let k = 1; k < dates.length; k++) {
    if (dates[k].getTime() < dates[k - 1].getTime()) {
      return NextResponse.json(
        {
          error:
            "Dates must be in order: PR ≤ PO ≤ Delivery ≤ Invoice ≤ Payment.",
        },
        { status: 400 },
      );
    }
  }

  // Tag to the PAYMENT-year period (same rule as the bulk import); create the
  // period if this is the first activity in that year.
  const year = paymentDate.getUTCFullYear();
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

  const base = {
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
    prDate,
    poDate,
    deliveryDate,
    invoiceDate,
    paymentDate,
    periodId: period.id,
  };

  // Server-assign the PO id from the DB max; retry on the rare unique collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.purchase.findMany({ select: { poId: true } });
    const poId = nextPoId(existing.map((p) => p.poId));
    try {
      const created = await prisma.purchase.create({
        data: toPurchaseCreateData({ ...base, poId }),
        select: {
          poId: true,
          supplierExternalId: true,
          totalValueUsd: true,
          totalCycleDays: true,
        },
      });
      return NextResponse.json({ success: true, purchase: created });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  return NextResponse.json(
    { error: "Could not assign a unique PO id — please retry." },
    { status: 409 },
  );
}
