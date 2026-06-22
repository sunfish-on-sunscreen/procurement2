"use client";

import type { AbcResult } from "@/lib/analysis-types";
import { ABC_COLORS } from "@/lib/chart-colors";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ParetoChart } from "@/components/charts/ParetoChart";

const ABC_CLASSES = ["A", "B", "C"] as const;
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
        <CardDescription>
          Suppliers ranked by spend; the top 80% form Class A, the next 15%
          Class B, the bottom 5% Class C.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {ABC_CLASSES.map((cls) => (
            <div
              key={cls}
              className="rounded-md border p-3"
              style={{ borderLeft: `4px solid ${ABC_COLORS[cls]}` }}
            >
              <div className="text-xs text-muted-foreground">Class {cls}</div>
              <div className="text-lg font-semibold">
                {abc.summary[cls].n} suppliers
              </div>
              <div className="text-xs text-muted-foreground">
                {pct1(abc.summary[cls].pct_of_spend)} of spend
              </div>
            </div>
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
