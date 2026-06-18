"use client";

import { useState } from "react";
import type { AbcResult } from "@/lib/analysis-types";
import { ABC_COLORS } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import { ParetoChart } from "@/components/charts/ParetoChart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const ABC_CLASSES = ["A", "B", "C"] as const;
const DECLARED_TIERS = ["Core", "Established", "Standard"] as const;

export function AbcView({ abc }: { abc: AbcResult }) {
  const tiers = Object.keys(abc.crosstab);

  // Tier chips for the classification table (declared tiers first, then any
  // others like "Unknown" that appear in the data). Visibility-only: the ABC
  // classification itself never changes — Class A stays Class A.
  const presentTiers = [
    ...DECLARED_TIERS.filter((t) =>
      abc.classifications.some((c) => c.tier === t),
    ),
    ...[...new Set(abc.classifications.map((c) => c.tier))].filter(
      (t) => !(DECLARED_TIERS as readonly string[]).includes(t),
    ),
  ];
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(
    new Set(presentTiers),
  );
  const toggleTier = (t: string) =>
    setSelectedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  const visibleClassifications = abc.classifications.filter((c) =>
    selectedTiers.has(c.tier),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          ABC classification (Pareto principle) ranks suppliers by spend. The top
          80% of spend forms Class A, the next 15% forms Class B, and the bottom 5%
          forms Class C. Thresholds are fixed at 80% / 95%.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ABC_CLASSES.map((cls) => (
          <Card key={cls} style={{ borderLeft: `4px solid ${ABC_COLORS[cls]}` }}>
            <CardHeader className="pb-2">
              <CardDescription>Class {cls}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {abc.summary[cls].n} suppliers
              </div>
              <div className="text-sm text-muted-foreground">
                {pct1(abc.summary[cls].pct_of_spend)} of spend
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pareto Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <ParetoChart data={abc.classifications} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier Classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Filter by tier:</span>
            {presentTiers.map((t) => {
              const on = selectedTiers.has(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    on
                      ? "border-foreground/40 text-foreground"
                      : "text-muted-foreground opacity-60 hover:opacity-100",
                  )}
                >
                  {t}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-muted-foreground">
              Showing {visibleClassifications.length} of{" "}
              {abc.classifications.length} suppliers
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Rank</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead className="text-right">% of Spend</TableHead>
                <TableHead className="text-right">Cumulative %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleClassifications.map((c) => (
                <TableRow key={c.supplier_id}>
                  <TableCell className="text-right">{c.rank}</TableCell>
                  <TableCell className="font-medium">{c.supplier_name}</TableCell>
                  <TableCell>{c.tier}</TableCell>
                  <TableCell>
                    <Badge
                      style={{
                        backgroundColor: ABC_COLORS[c.abc_class],
                        color: "#fff",
                        borderColor: "transparent",
                      }}
                    >
                      {c.abc_class}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {usdCompact.format(c.total)}
                  </TableCell>
                  <TableCell className="text-right">{pct1(c.pct)}</TableCell>
                  <TableCell className="text-right">
                    {pct1(c.cumulative_pct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Legacy Tier vs ABC Class</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tier</TableHead>
                {ABC_CLASSES.map((cls) => (
                  <TableHead key={cls} className="text-right">
                    Class {cls}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier}>
                  <TableCell className="font-medium">{tier}</TableCell>
                  {ABC_CLASSES.map((cls) => (
                    <TableCell key={cls} className="text-right">
                      {abc.crosstab[tier]?.[cls] ?? 0}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {abc.abc_vs_tier && (
        <Card>
          <CardHeader>
            <CardTitle>ABC Class × Declared Tier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  {DECLARED_TIERS.map((t) => (
                    <TableHead key={t} className="text-right">
                      {t}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ABC_CLASSES.map((cls) => (
                  <TableRow key={cls}>
                    <TableCell className="font-medium">Class {cls}</TableCell>
                    {DECLARED_TIERS.map((t) => (
                      <TableCell key={t} className="text-right">
                        {abc.abc_vs_tier![cls]?.[t] ?? 0}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {(() => {
              const A = abc.abc_vs_tier!.A ?? {};
              const C = abc.abc_vs_tier!.C ?? {};
              const aNotCore =
                (A.Established ?? 0) + (A.Standard ?? 0);
              const cCore = C.Core ?? 0;
              return (
                <div className="rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm leading-relaxed">
                  <p className="mb-1 font-semibold">Insights</p>
                  <p className="text-muted-foreground">
                    {aNotCore} high-spend Class A supplier
                    {aNotCore === 1 ? " isn't" : "s aren't"} classified as
                    Core in our tier system — tier review candidates.{" "}
                    {cCore} supplier
                    {cCore === 1 ? " is" : "s are"} labeled Core but
                    fall in Class C, contributing little to spend — possibly
                    stale designations or critical low-volume partners worth
                    keeping at Core.
                  </p>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </>
  );
}
