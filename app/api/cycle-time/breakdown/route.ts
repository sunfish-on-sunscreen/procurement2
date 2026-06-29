import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getRangeAnalyses } from "@/lib/range-analyses";
import {
  CYCLE_STAGES,
  type AbcClass,
  type CycleBreakdown,
  type CycleStageKey,
  type CycleSupplierRow,
  type CycleCategoryRow,
} from "@/lib/cycle-time-types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Per-supplier (median/IQR/PO count/slowest stage) and per-category (stage
 * means) cycle-time breakdown for the selected span. Filters by invoice date
 * (1:1 non-null, matches the period tag). Login required; any role.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
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

  const purchases = await prisma.purchase.findMany({
    where: {
      invoiceDate: {
        gte: new Date(`${start}T00:00:00`),
        lte: new Date(`${end}T23:59:59`),
      },
    },
    select: {
      supplierExternalId: true,
      supplierName: true,
      category: true,
      prToPoDays: true,
      poToDeliveryDays: true,
      deliveryToInvoiceDays: true,
      invoiceToPaymentDays: true,
      totalCycleDays: true,
    },
  });

  // ---- Per-supplier aggregation ------------------------------------------- #
  type Acc = {
    name: string;
    cycles: number[];
    stageSums: Record<CycleStageKey, number>;
  };
  const bySup = new Map<string, Acc>();

  for (const p of purchases) {
    let a = bySup.get(p.supplierExternalId);
    if (!a) {
      a = {
        name: p.supplierName,
        cycles: [],
        stageSums: { pr_to_po: 0, po_to_delivery: 0, delivery_to_invoice: 0, invoice_to_payment: 0 },
      };
      bySup.set(p.supplierExternalId, a);
    }
    a.cycles.push(p.totalCycleDays);
    a.stageSums.pr_to_po += p.prToPoDays;
    a.stageSums.po_to_delivery += p.poToDeliveryDays;
    a.stageSums.delivery_to_invoice += p.deliveryToInvoiceDays;
    a.stageSums.invoice_to_payment += p.invoiceToPaymentDays;
  }

  const labelOf = (k: CycleStageKey) =>
    CYCLE_STAGES.find((s) => s.key === k)!.label;

  // Classification context (ABC / Kraljic / composite), period-scoped via the
  // same getRangeAnalyses source the ranking + spend-detail panel use, so the
  // roster chips agree with the rest of the dashboard. Null on compute failure
  // → chips render "—".
  const analyses = await getRangeAnalyses(start, end);
  const abcById = new Map(
    (analyses?.abc?.classifications ?? []).map((c) => [c.supplier_id, c.abc_class as AbcClass]),
  );
  const perfById = new Map(
    (analyses?.performance_spend?.suppliers ?? []).map((s) => [s.supplier_id, s]),
  );

  const bySupplier: CycleSupplierRow[] = [...bySup.entries()]
    .map(([supplier_id, a]) => {
      const sorted = [...a.cycles].sort((x, y) => x - y);
      const n = sorted.length;
      const p25 = quantile(sorted, 0.25);
      const p75 = quantile(sorted, 0.75);
      const median = quantile(sorted, 0.5);
      // Slowest stage = the one with the largest mean contribution.
      const means = (Object.keys(a.stageSums) as CycleStageKey[]).map((k) => ({
        key: k,
        mean: a.stageSums[k] / n,
      }));
      const totalStageMean = means.reduce((s, m) => s + m.mean, 0) || 1;
      const slowest = means.reduce((m, c) => (c.mean > m.mean ? c : m));
      const perf = perfById.get(supplier_id);
      return {
        supplier_id,
        supplier_name: a.name,
        po_count: n,
        median_cycle: round1(median),
        p25: round1(p25),
        p75: round1(p75),
        iqr: round1(p75 - p25),
        slowest_stage: slowest.key,
        slowest_stage_label: labelOf(slowest.key),
        slowest_stage_pct: Math.round((slowest.mean / totalStageMean) * 100),
        abc_class: abcById.get(supplier_id) ?? null,
        kraljic_quadrant: perf?.kraljic_quadrant ?? null,
        composite: perf?.performance_score ?? null,
      };
    })
    .sort((a, b) => b.median_cycle - a.median_cycle);

  // ---- Per-category stage means ------------------------------------------- #
  type CatAcc = { count: number; sums: Record<CycleStageKey, number> };
  const byCat = new Map<string, CatAcc>();
  for (const p of purchases) {
    let c = byCat.get(p.category);
    if (!c) {
      c = { count: 0, sums: { pr_to_po: 0, po_to_delivery: 0, delivery_to_invoice: 0, invoice_to_payment: 0 } };
      byCat.set(p.category, c);
    }
    c.count += 1;
    c.sums.pr_to_po += p.prToPoDays;
    c.sums.po_to_delivery += p.poToDeliveryDays;
    c.sums.delivery_to_invoice += p.deliveryToInvoiceDays;
    c.sums.invoice_to_payment += p.invoiceToPaymentDays;
  }

  const byCategory: CycleCategoryRow[] = [...byCat.entries()]
    .map(([category, c]) => {
      const m = (k: CycleStageKey) => round1(c.sums[k] / c.count);
      const pr_to_po = m("pr_to_po");
      const po_to_delivery = m("po_to_delivery");
      const delivery_to_invoice = m("delivery_to_invoice");
      const invoice_to_payment = m("invoice_to_payment");
      return {
        category,
        po_count: c.count,
        pr_to_po,
        po_to_delivery,
        delivery_to_invoice,
        invoice_to_payment,
        total_mean: round1(
          pr_to_po + po_to_delivery + delivery_to_invoice + invoice_to_payment,
        ),
      };
    })
    .sort((a, b) => b.total_mean - a.total_mean);

  const result: CycleBreakdown = { bySupplier, byCategory };
  return NextResponse.json(result);
}
