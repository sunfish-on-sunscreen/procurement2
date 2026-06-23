"use client";

import type { AbcResult } from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatBlock, type StatBlockProps } from "@/components/ui/stat-block";
import { ParetoChart } from "@/components/charts/ParetoChart";

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
  return (
    <Card>
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

        <p className="text-xs text-muted-foreground">
          Pareto Principle: 80/20 spend concentration. Thresholds fixed at
          80% / 95%.
        </p>
      </CardContent>
    </Card>
  );
}
