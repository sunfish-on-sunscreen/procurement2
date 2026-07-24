"use client";

import type { AbcResult } from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cardElevation } from "@/lib/utils";
import { StatBlock, type StatBlockProps } from "@/components/ui/stat-block";
import { ParetoChart } from "@/components/charts/ParetoChart";
import {
  buildSpendConcentration,
  ratioLabel,
  EVEN_REFERENCE_PCT,
  PARETO_REFERENCE_PCT,
} from "@/lib/spend-concentration";

const ABC_CLASSES = ["A", "B", "C"] as const;
const ABC_ACCENT: Record<"A" | "B" | "C", StatBlockProps["accent"]> = {
  A: "destructive",
  B: "warning",
  C: "success",
};
const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

/**
 * Compact Pareto / ABC analysis card for the Spend Overview page (the ABC
 * Analysis page was merged here). Class-A/B/C summary blocks over a reused
 * ParetoChart (bars by class colour + cumulative-% line + 80/95 thresholds).
 * The full per-supplier classification + crosstabs still live in the report
 * editor's ABC section; the supplier ranking table below carries ABC class too.
 */
export function AbcParetoCard({ abc }: { abc: AbcResult }) {
  const conc = buildSpendConcentration(abc);
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Pareto / ABC Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {ABC_CLASSES.map((cls) => (
            <StatBlock
              key={cls}
              accent={ABC_ACCENT[cls]}
              label={`Class ${cls}`}
              value={`${abc.summary[cls].n} suppliers`}
              sublabel={`${pct1(abc.summary[cls].pct_of_spend)} of spend`}
            />
          ))}
        </div>

        <ParetoChart data={abc.classifications} />

        {/* ⚠️ The premise this card rests on, MEASURED rather than assumed. Window-scoped
            (it reads the selected span's own `abc` payload), client-side, no payload field.
            Stated here because this is where the 80/20 citation is made. */}
        {conc && (
          <p className="text-xs text-muted-foreground">
            Observed on this spend base: the top {conc.topCount} suppliers — a fifth of{" "}
            {conc.supplierCount} — hold {conc.topSharePct.toFixed(1)}% of spend, a{" "}
            <strong className="font-medium text-foreground">{ratioLabel(conc)}</strong> split
            against the textbook{" "}
            <strong className="font-medium text-foreground">
              {EVEN_REFERENCE_PCT}/{PARETO_REFERENCE_PCT}
            </strong>
            .{" "}
            {conc.meetsPareto
              ? "Spend follows the Pareto premise, so Class A isolates a short list of vital few."
              : "Spend is flatter than the Pareto premise, so Class A is a broad group rather than a selective one."}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Pareto Principle: 80/20 spend concentration. Thresholds fixed at
          80% / 95%.
        </p>
      </CardContent>
    </Card>
  );
}
