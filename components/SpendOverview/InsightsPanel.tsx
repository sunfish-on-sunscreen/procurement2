"use client";

import type { SpendOverviewResult, AbcResult } from "@/lib/analysis-types";
import type { SupplierRankingRow } from "@/lib/spend-overview-types";
import { cardElevation, formatCompactCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const num0 = new Intl.NumberFormat("en-US");
const pct1 = (value: number) => `${value.toFixed(1)}%`;
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** "from 2024 to 2026" (range) / "in 2025" (single year), tolerant of label shape. */
function periodPhrase(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "in this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `from ${parts[0]} to ${parts[1]}`;
    return `over ${periodLabel}`;
  }
  return `in ${periodLabel}`;
}

/** Smallest supplier count whose cumulative spend reaches `targetPct` of total. */
function suppliersToReach(rows: SupplierRankingRow[], total: number, targetPct: number): number {
  if (total <= 0) return 0;
  const sorted = [...rows].sort((a, b) => b.total_spend - a.total_spend);
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i].total_spend;
    if (share(cum, total) >= targetPct) return i + 1;
  }
  return sorted.length;
}

/**
 * Consolidated analytical summary at the top of Spend Overview. Replaces the
 * per-section card descriptions with one period-aware narrative computed
 * client-side from already-loaded analyses (no new API / Python). Insights are
 * spend-overview-internal only — cross-page insights are deferred to report sync.
 */
export function InsightsPanel({
  spendOverview,
  abc,
  ranking,
  periodLabel,
  isRangeMode,
}: {
  spendOverview: SpendOverviewResult;
  abc: AbcResult;
  ranking: SupplierRankingRow[];
  periodLabel: string;
  isRangeMode: boolean;
}) {
  const total = spendOverview.total_spend;
  const phrase = periodPhrase(periodLabel, isRangeMode);

  // Concentration (ABC).
  const aN = abc.summary.A.n;
  const cN = abc.summary.C.n;
  const aPct = abc.summary.A.pct_of_spend * 100;
  const cPct = abc.summary.C.pct_of_spend * 100;
  // Let the Class-A spend share pick the adjective — don't hardcode "heavily
  // concentrated" (it would contradict a genuinely distributed spend base).
  const concentrationWord =
    aPct >= 70 ? "heavily concentrated" : aPct >= 50 ? "concentrated" : "relatively distributed";
  const isConcentrated = aPct >= 50;

  // Categories (descending).
  const categories = [...spendOverview.by_category].sort((a, b) => b.total - a.total);
  const topCategory = categories[0];
  const secondCategory = categories[1] ?? null;
  const topCatPct = topCategory ? share(topCategory.total, total) : 0;
  // "Dominates" only when the top category's share is genuinely large — ≥ 40% or
  // ≥ 1.5× the second category. Otherwise it is merely "the largest".
  const topCatDominates =
    topCategory != null &&
    (topCatPct >= 40 ||
      (secondCategory != null &&
        secondCategory.total > 0 &&
        topCategory.total >= 1.5 * secondCategory.total));
  const top3 = categories.slice(0, 3);
  const top3Pct = share(
    top3.reduce((s, c) => s + c.total, 0),
    total,
  );
  // Categories carrying meaningful volume = those needed to cover 80% of spend.
  let catCum = 0;
  let catsTo80 = 0;
  for (const c of categories) {
    catCum += c.total;
    catsTo80 += 1;
    if (share(catCum, total) >= 80) break;
  }

  // Top supplier (with invoice count joined from the ranking).
  const topSupplier = spendOverview.top_suppliers[0];
  const topSupplierInvoices = topSupplier
    ? (ranking.find((r) => r.supplier_id === topSupplier.supplier_id)?.po_count ?? null)
    : null;

  // Monthly rhythm.
  const monthTotals = spendOverview.monthly_trend.map((m) => m.total);
  const hasRhythm = monthTotals.length >= 2;
  const sortedMonths = [...monthTotals].sort((a, b) => a - b);
  const median =
    sortedMonths.length === 0
      ? 0
      : sortedMonths.length % 2 === 1
        ? sortedMonths[(sortedMonths.length - 1) / 2]
        : (sortedMonths[sortedMonths.length / 2 - 1] + sortedMonths[sortedMonths.length / 2]) / 2;
  const minMonth = sortedMonths[0] ?? 0;
  const maxMonth = sortedMonths[sortedMonths.length - 1] ?? 0;

  // Spend concentration over ACTIVE suppliers (the ranking now also carries
  // $0/inactive rows, which must not inflate the long-tail count).
  const activeRanking = ranking.filter((r) => !r.inactive);
  const sup50 = suppliersToReach(activeRanking, total, 50);
  const sup80 = suppliersToReach(activeRanking, total, 80);

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Spend at a glance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        <p>
          You spent <strong>{formatCompactCurrency(total)}</strong> across{" "}
          {num0.format(spendOverview.total_pos)} invoices with{" "}
          {num0.format(spendOverview.active_suppliers)} suppliers {phrase}. Spend is{" "}
          {concentrationWord}: the top {aN} suppliers (Class A) account for{" "}
          <strong>{pct1(aPct)}</strong> of total expenditure, while the bottom {cN}{" "}
          suppliers (Class C) contribute just {pct1(cPct)}.
          {isConcentrated &&
            " This Pareto distribution is typical of capital-intensive procurement."}
        </p>

        {topCategory && (
          <div className="space-y-1">
            <h3 className="font-medium">Where the money goes</h3>
            <p>
              <strong>{topCategory.category}</strong>{" "}
              {topCatDominates ? "dominates at" : "is the largest at"}{" "}
              {formatCompactCurrency(topCategory.total)} ({pct1(topCatPct)})
              of total spend. The top{" "}
              {top3.length} categories — {top3.map((c) => c.category).join(", ")} — together
              account for {pct1(top3Pct)} of all spend.
              {topSupplier && (
                <>
                  {" "}
                  The largest supplier, <strong>{topSupplier.supplier_name}</strong>, alone
                  represents {formatCompactCurrency(topSupplier.total)} (
                  {pct1(share(topSupplier.total, total))})
                  {topSupplierInvoices != null
                    ? ` across ${num0.format(topSupplierInvoices)} invoices.`
                    : "."}
                </>
              )}
            </p>
          </div>
        )}

        <div className="space-y-1">
          <h3 className="font-medium">Patterns worth noting</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {hasRhythm && (
              <li>
                Monthly spend runs a median of {formatCompactCurrency(median)}, ranging{" "}
                {formatCompactCurrency(minMonth)} to {formatCompactCurrency(maxMonth)} across
                the period.
              </li>
            )}
            {activeRanking.length > 0 && (
              <li>
                Spend is steeply concentrated: just {sup50} supplier{sup50 === 1 ? "" : "s"} make
                up 50% of spend, and {sup80} cover 80% — the remaining{" "}
                {Math.max(0, activeRanking.length - sup80)} contribute the long tail.
              </li>
            )}
            {categories.length > 0 && (
              <li>
                Spend spans {categories.length} categor{categories.length === 1 ? "y" : "ies"};
                the top {catsTo80} cover 80% of it, so diversification is{" "}
                {catsTo80 <= 2 ? "narrow" : catsTo80 <= 5 ? "moderate" : "broad"}.
              </li>
            )}
          </ul>
        </div>

        <p className="text-xs italic text-muted-foreground">
          Click any supplier row below for product-level decomposition. Use the period
          selector above to filter to specific years.
        </p>
      </CardContent>
    </Card>
  );
}
