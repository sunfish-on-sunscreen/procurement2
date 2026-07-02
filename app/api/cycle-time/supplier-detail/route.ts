import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getRangeAnalyses } from "@/lib/range-analyses";
import {
  CYCLE_STAGES,
  type AbcClass,
  type CycleStageKey,
  type CycleSupplierDetail,
  type CyclePoRow,
} from "@/lib/cycle-time-types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Linear-interpolation quantile over a pre-sorted ascending array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next != null ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const STAGE_FIELD: Record<CycleStageKey, "prToPoDays" | "poToDeliveryDays" | "deliveryToInvoiceDays" | "invoiceToPaymentDays"> = {
  pr_to_po: "prToPoDays",
  po_to_delivery: "poToDeliveryDays",
  delivery_to_invoice: "deliveryToInvoiceDays",
  invoice_to_payment: "invoiceToPaymentDays",
};

/**
 * Per-supplier cycle-time drill-down for the selected span: identity +
 * classification context (ABC / Kraljic / composite, period-scoped via
 * getRangeAnalyses) + per-stage medians (supplier vs portfolio) + the supplier's
 * PO list with the slowest stage per PO and an anomaly flag (total cycle > 2σ
 * above the span mean, matching the cycle_time analysis). Login required.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const supplierId = sp.get("supplierId");
  const start = sp.get("start");
  const end = sp.get("end");
  if (!supplierId) {
    return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  }
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end must both be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (end < start) {
    return NextResponse.json(
      { error: "end must be on or after start" },
      { status: 400 },
    );
  }

  const dateFilter = {
    gte: new Date(`${start}T00:00:00`),
    lte: new Date(`${end}T23:59:59`),
  };

  // All in-span purchases (for the portfolio per-stage medians + the cycle
  // mean/std used by the anomaly flag) and the supplier identity, in parallel.
  const [allPurchases, supplier] = await Promise.all([
    prisma.purchase.findMany({
      where: { invoiceDate: dateFilter },
      select: {
        poId: true,
        supplierExternalId: true,
        invoiceDate: true,
        prToPoDays: true,
        poToDeliveryDays: true,
        deliveryToInvoiceDays: true,
        invoiceToPaymentDays: true,
        totalCycleDays: true,
      },
    }),
    prisma.supplier.findFirst({
      where: { externalId: supplierId },
      orderBy: { periodId: "desc" },
      select: { supplierName: true, category: true, country: true },
    }),
  ]);

  const mine = allPurchases.filter((p) => p.supplierExternalId === supplierId);
  if (!supplier && mine.length === 0) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Classification context (period-scoped, same source as the roster).
  const analyses = await getRangeAnalyses(start, end);
  const abcClass: AbcClass | null =
    (analyses?.abc?.classifications.find((c) => c.supplier_id === supplierId)
      ?.abc_class as AbcClass | undefined) ?? null;
  const perf = analyses?.performance_spend?.suppliers.find(
    (s) => s.supplier_id === supplierId,
  );

  // Portfolio cycle mean + sample std (ddof=1) for the anomaly z-score.
  const allCycles = allPurchases.map((p) => p.totalCycleDays);
  const n = allCycles.length;
  const mean = n ? allCycles.reduce((s, x) => s + x, 0) / n : 0;
  const std =
    n > 1
      ? Math.sqrt(allCycles.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
      : 0;

  // Per-stage means: this supplier vs the whole portfolio. Mean-based so the
  // panel's per-stage bars agree with the mean-based "Slowest stage" chip.
  const stages = CYCLE_STAGES.map((s) => {
    const field = STAGE_FIELD[s.key];
    return {
      key: s.key,
      label: s.label,
      supplier_mean: round2(avg(mine.map((p) => p[field]))),
      portfolio_mean: round2(avg(allPurchases.map((p) => p[field]))),
    };
  });

  // Supplier cycle distribution.
  const myCyclesSorted = [...mine.map((p) => p.totalCycleDays)].sort((a, b) => a - b);
  const p25 = quantile(myCyclesSorted, 0.25);
  const p75 = quantile(myCyclesSorted, 0.75);
  const med = quantile(myCyclesSorted, 0.5);

  // Slowest stage for the supplier overall (largest mean contribution).
  const stageMeans = CYCLE_STAGES.map((s) => {
    const field = STAGE_FIELD[s.key];
    const m = mine.length ? mine.reduce((acc, p) => acc + p[field], 0) / mine.length : 0;
    return { key: s.key, label: s.label, mean: m };
  });
  const slowest = stageMeans.reduce((m, c) => (c.mean > m.mean ? c : m), stageMeans[0]);

  // PO list: slowest stage per PO + anomaly flag (z > 2 over the span mean).
  const labelOf = (k: CycleStageKey) => CYCLE_STAGES.find((s) => s.key === k)!.label;
  const pos: CyclePoRow[] = mine
    .map((p) => {
      const perStage = CYCLE_STAGES.map((s) => ({ key: s.key, days: p[STAGE_FIELD[s.key]] }));
      const slow = perStage.reduce((m, c) => (c.days > m.days ? c : m), perStage[0]);
      const z = std > 0 ? (p.totalCycleDays - mean) / std : 0;
      return {
        po_id: p.poId,
        invoice_date: iso(p.invoiceDate),
        total_cycle_days: p.totalCycleDays,
        slowest_stage: slow.key,
        slowest_stage_label: labelOf(slow.key),
        is_anomaly: z > 2,
      };
    })
    .sort((a, b) => b.total_cycle_days - a.total_cycle_days);

  const detail: CycleSupplierDetail = {
    supplier: {
      id: supplierId,
      name: supplier?.supplierName ?? mine[0]?.supplierExternalId ?? supplierId,
      category: supplier?.category ?? null,
      country: supplier?.country ?? null,
      abc_class: abcClass,
      kraljic_quadrant: perf?.kraljic_quadrant ?? null,
      zone: perf?.zone ?? null,
      composite: perf?.performance_score != null ? round2(perf.performance_score) : null,
    },
    cycle: {
      median_cycle: round2(med),
      p25: round2(p25),
      p75: round2(p75),
      iqr: round2(p75 - p25),
      po_count: mine.length,
      slowest_stage: slowest.key,
      slowest_stage_label: slowest.label,
    },
    stages,
    pos,
  };

  return NextResponse.json(detail);
}
