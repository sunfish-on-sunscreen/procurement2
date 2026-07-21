import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { readSession } from "@/lib/auth";
import { recomputeAllPeriods } from "@/lib/recompute";
import { z } from "zod";

export const runtime = "nodejs";

const VoidBody = z.object({
  reason: z.string().trim().min(3, "A reason is required (at least 3 characters)"),
});

/**
 * VOID / UN-VOID a purchase order (admin only).
 *
 * A void marks an order as entered in error — wrong supplier, wrong buying method,
 * any of the posted fields a correction cannot reach. The order and its whole chain
 * (PR -> sourcing -> PO -> GRN -> invoice -> payment) drop out of every analytic,
 * but NOTHING is deleted: the rows stay in the database and the data browser.
 *
 * ⚠️ The posted PurchaseOrder row is NEVER touched. Voiding APPENDS a
 * `PurchaseOrderVoid` row, so the immutability triggers stay intact and no bypass
 * flag exists — the same discipline as corrections. That row is also the audit
 * record (who / when / why); there is no separate log.
 *
 * Both directions recompute every period, because a void changes the population
 * every analysis is computed over.
 */
/**
 * What voiding this order would actually exclude — the value leaving the totals
 * plus the size of the chain. Fetched when the confirmation dialog opens rather
 * than shipped with all 647 browser rows, since it is only ever needed one at a
 * time. Read-only.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      period: true,
      supplier: { select: { supplierName: true } },
      voidRecord: { select: { reason: true, voidedAt: true } },
      _count: { select: { poLines: true, goodsReceipts: true, invoices: true } },
      invoices: { select: { _count: { select: { payments: true } } } },
    },
  });
  if (!po) {
    return NextResponse.json({ error: `Purchase order ${id} not found.` }, { status: 404 });
  }

  // Spend is read from the view, so a voided order reports 0 — it has already left
  // the totals. The dialog only needs the figure when voiding, and at that moment
  // the order is still live.
  const [row] = await prisma.$queryRaw<{ total: number | null }[]>(
    Prisma.sql`SELECT "totalValueUsd"::float8 AS total FROM "EnrichedPurchase" WHERE "poId" = ${id}`,
  );

  return NextResponse.json({
    poId: po.id,
    supplierName: po.supplier.supplierName,
    period: po.period,
    totalValueUsd: row?.total ?? null,
    voided: po.voidRecord !== null,
    voidReason: po.voidRecord?.reason ?? null,
    chain: {
      lines: po._count.poLines,
      receipts: po._count.goodsReceipts,
      invoices: po._count.invoices,
      payments: po.invoices.reduce((n, i) => n + i._count.payments, 0),
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = VoidBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      supplier: { select: { supplierName: true } },
      voidRecord: { select: { poId: true } },
    },
  });
  if (!po) {
    return NextResponse.json({ error: `Purchase order ${id} not found.` }, { status: 404 });
  }
  if (po.voidRecord) {
    return NextResponse.json({ error: `${id} is already voided.` }, { status: 409 });
  }

  try {
    await prisma.purchaseOrderVoid.create({
      data: { poId: id, reason: parsed.data.reason, voidedBy: session.userId },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `${id} was not voided — nothing was written.`, detail },
      { status: 500 },
    );
  }

  // ⚠️ The void row is already committed. A recompute failure leaves the order
  // voided but the dashboards stale, which the message has to say — the same
  // honesty rule the other write paths follow.
  const recompute = await recomputeAllPeriods();
  if (!recompute.ok) {
    return NextResponse.json(
      {
        error: `${id} was voided, but analytics failed to refresh. Re-run the recompute.`,
        detail: recompute.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    poId: id,
    supplierName: po.supplier.supplierName,
    voided: true,
    recompute: recompute.summary,
  });
}

/** Un-void: a plain DELETE of the void row. No trigger blocks it. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;

  const existing = await prisma.purchaseOrderVoid.findUnique({ where: { poId: id } });
  if (!existing) {
    return NextResponse.json({ error: `${id} is not voided.` }, { status: 404 });
  }

  try {
    await prisma.purchaseOrderVoid.delete({ where: { poId: id } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `${id} was not restored — nothing was changed.`, detail },
      { status: 500 },
    );
  }

  const recompute = await recomputeAllPeriods();
  if (!recompute.ok) {
    return NextResponse.json(
      {
        error: `${id} was restored, but analytics failed to refresh. Re-run the recompute.`,
        detail: recompute.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, poId: id, voided: false, recompute: recompute.summary });
}
