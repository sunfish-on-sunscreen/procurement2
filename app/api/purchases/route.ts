import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import { CreateTransactionBody, createTransactionChain } from "@/lib/transaction-create";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const TX_TIMEOUT_MS = 60_000;

/**
 * Record ONE complete purchase — the whole document chain (requisition →
 * sourcing/response for rfq → PO + lines → goods receipt + lines → invoice +
 * lines → payment) in a single atomic transaction, then a full recompute.
 *
 * COMPLETE-CHAIN ONLY. A PO without its receipt/invoice/payment would be counted
 * as a three-way-match PASS by the view (which COALESCEs a PO with no invoice
 * lines to TRUE) while contributing to no other rate denominator, silently
 * inflating processScore. Open POs would need the rate denominators changed —
 * a formula change — so they are out of scope by decision.
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
  const parsed = CreateTransactionBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid input",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Referential checks before the write, so the common mistakes give a clear 400
  // rather than a rolled-back FK violation.
  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplier_id },
    select: { id: true, status: true, supplierName: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: `Supplier ${input.supplier_id} not found.` }, { status: 400 });
  }
  if (supplier.status !== "active") {
    return NextResponse.json(
      { error: `${supplier.supplierName} is inactive — reactivate it before ordering.` },
      { status: 400 },
    );
  }
  if (input.buying_method === "call_off") {
    const fw = await prisma.framework.findUnique({
      where: { id: input.framework_id! },
      select: { supplierId: true },
    });
    if (!fw) {
      return NextResponse.json(
        { error: `Framework ${input.framework_id} not found.` },
        { status: 400 },
      );
    }
    if (fw.supplierId !== input.supplier_id) {
      return NextResponse.json(
        { error: `Framework ${input.framework_id} belongs to a different supplier.` },
        { status: 400 },
      );
    }
  }

  // The order year must have a reporting period, or the compute layer would skip
  // the new PO entirely.
  const period = input.po_date.slice(0, 4);
  const year = Number(period);
  await prisma.reportingPeriod.upsert({
    where: { name: period },
    update: {},
    create: {
      name: period,
      startDate: new Date(Date.UTC(year, 0, 1, 0, 0, 0)),
      endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
    },
  });

  // Write the chain. On the rare id collision (a concurrent create took the same
  // sequence number) retry — the sequence heads are re-read inside the transaction.
  let created;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await prisma.$transaction((tx) => createTransactionChain(tx, input), {
        timeout: TX_TIMEOUT_MS,
        maxWait: 10_000,
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      const detail = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Could not record the purchase — nothing was written. ${detail}` },
        { status: 500 },
      );
    }
  }
  if (!created) {
    return NextResponse.json(
      { error: "Could not assign unique document ids — please retry." },
      { status: 409 },
    );
  }

  const recompute = await recomputeAllPeriods();
  if (!recompute.ok) {
    return NextResponse.json(
      {
        error: `Purchase ${created.poId} was recorded, but analytics failed to refresh. Re-run the recompute.`,
        detail: recompute.error,
        purchase: created,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    purchase: created,
    recompute: recompute.summary,
  });
}
