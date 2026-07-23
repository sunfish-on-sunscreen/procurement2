import { getEnrichedPurchases } from "@/lib/enriched-purchase";
import { getRangeAnalyses } from "@/lib/range-analyses";
import type {
  CycleAnomaly,
  AbcResult,
  PerformanceSpendResult,
} from "@/lib/analysis-types";
import {
  CYCLE_STAGES,
  type AbcClass,
  type CycleBreakdown,
  type CycleStageKey,
  type CycleSupplierRow,
  type CycleCategoryRow,
} from "@/lib/cycle-time-types";

/** Just the fields the bySupplier roster-context join needs. */
type BreakdownClassification = {
  abc: AbcResult | null;
  performance_spend: PerformanceSpendResult | null;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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
 * Per-supplier (median/IQR/PO count/slowest stage) and per-category (stage means)
 * cycle-time breakdown for a span, plus per-PO stage anomalies and 3-way-match
 * control exposure. Filters by order-year (poDate) via the EnrichedPurchase view.
 *
 * Extracted VERBATIM from the /api/cycle-time/breakdown route so the SAME
 * computation feeds both the live route (Process Health / the anomaly hub / the
 * modal) AND the server-side report assembly — one source of truth, no client
 * fetch needed in reports. `start`/`end` are YYYY-MM-DD (already validated by the
 * caller). PURE-ish: reads Purchase + the cached range analyses; no request/response.
 *
 * `preloaded` (optional) supplies the ABC / performance analyses for the roster
 * chips; when omitted, they're loaded via getRangeAnalyses (the live route path,
 * unchanged). Callers that already hold those analyses (the report assembler, the
 * persisted report page) pass them to avoid a redundant load / recompute.
 */
export async function computeCycleBreakdown(
  start: string,
  end: string,
  preloaded?: BreakdownClassification,
): Promise<CycleBreakdown> {
  const purchases = await getEnrichedPurchases({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T23:59:59`),
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
  const analyses = preloaded ?? (await getRangeAnalyses(start, end));
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

  // ---- Stage anomalies: POs where one stage dominates the cycle ----------- #
  // A PO is a "stage anomaly" when a single stage's share of its total cycle
  // exceeds 60% (decision: surfacing existing per-PO stage shares — no new
  // methodology). The z_score below is computed only because CycleAnomaly requires
  // the field; it is never read or displayed for these rows — see the WARNING on
  // CycleBreakdown.stageAnomalies.
  const allCycles = purchases.map((p) => p.totalCycleDays);
  const cn = allCycles.length;
  const cMean = cn ? allCycles.reduce((s, x) => s + x, 0) / cn : 0;
  const cStd =
    cn > 1
      ? Math.sqrt(allCycles.reduce((s, x) => s + (x - cMean) ** 2, 0) / (cn - 1))
      : 0;

  const stageAnomalies: CycleAnomaly[] = purchases
    .filter((p) => {
      const total = p.totalCycleDays;
      if (total <= 0) return false;
      const maxStage = Math.max(
        p.prToPoDays,
        p.poToDeliveryDays,
        p.deliveryToInvoiceDays,
        p.invoiceToPaymentDays,
      );
      return maxStage / total > 0.6;
    })
    .map((p) => ({
      po_id: p.poId,
      supplier_id: p.supplierExternalId,
      supplier_name: p.supplierName,
      invoice_date: iso(p.invoiceDate),
      cycle_days: p.totalCycleDays,
      // WRITE-ONLY (see CycleBreakdown.stageAnomalies): required by CycleAnomaly,
      // read by no consumer, and deliberately never displayed for a stage-dominated
      // PO - it measures distance from the mean TOTAL cycle, which says nothing
      // about whether one stage dominated that PO.
      z_score: cStd > 0 ? Math.round(((p.totalCycleDays - cMean) / cStd) * 100) / 100 : 0,
    }))
    .sort((a, b) => (b.cycle_days ?? 0) - (a.cycle_days ?? 0));

  // ---- 3-way-match control exposure (spend-at-risk) ----------------------- #
  // Value of POs that FAILED the 3-way match vs total spend, over the same span.
  const failedPos = purchases.filter((p) => !p.threeWayMatchPass);
  const failedSpend = failedPos.reduce((s, p) => s + p.totalValueUsd, 0);
  const totalSpend = purchases.reduce((s, p) => s + p.totalValueUsd, 0);
  const controlExposure = {
    failed_spend: failedSpend,
    total_spend: totalSpend,
    pct_at_risk: totalSpend > 0 ? (failedSpend / totalSpend) * 100 : 0,
    n_failed: failedPos.length,
    n_total: purchases.length,
    n_failing_suppliers: new Set(failedPos.map((p) => p.supplierExternalId)).size,
    n_total_suppliers: new Set(purchases.map((p) => p.supplierExternalId)).size,
  };

  // Per-PO buying method. The slowest-order lists lean almost entirely to
  // `direct` (the only method whose cycle range reaches the flag threshold at
  // all), so showing the method next to each order lets a reader see that
  // immediately instead of reading a process failure into it.
  const methodByPo: Record<string, string> = {};
  for (const p of purchases) if (p.buyingMethod) methodByPo[p.poId] = p.buyingMethod;

  return { bySupplier, byCategory, stageAnomalies, controlExposure, methodByPo };
}
