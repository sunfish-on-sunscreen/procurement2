"use client";

import { useState } from "react";
import type {
  KraljicResult,
  PerformanceSpendResult,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";
import { QUADRANT_COLORS, ZONE_COLORS } from "@/lib/chart-colors";
import { cardElevation } from "@/lib/utils";
import { PillTabs } from "@/components/PillTabs";
import { KraljicScatterChart } from "@/components/charts/KraljicScatterChart";
import { PerformanceSpendScatter } from "@/components/charts/PerformanceSpendScatter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];
const ZONE_ORDER: PerformanceZone[] = [
  "Stars",
  "Critical Issues",
  "Hidden Gems",
  "Long Tail",
];

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const num = (n: number | null, d = 1) => (n == null ? "—" : n.toFixed(d));

function Dot({ color }: { color: string }) {
  return (
    <span
      className="mr-1 inline-block h-3 w-3 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

function KraljicTab({ kraljic }: { kraljic: KraljicResult | null }) {
  if (!kraljic) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No Kraljic data for this period.
      </p>
    );
  }
  const byQuadrant = new Map(kraljic.quadrant_profiles.map((p) => [p.quadrant, p]));
  return (
    <div className="flex flex-col gap-4">
      <KraljicScatterChart
        assignments={kraljic.quadrant_assignments}
        thresholds={kraljic.axis_thresholds}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quadrant</TableHead>
            <TableHead className="text-right">Suppliers</TableHead>
            <TableHead className="text-right">Total spend</TableHead>
            <TableHead className="text-right">% of spend</TableHead>
            <TableHead className="text-right">Avg performance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {QUADRANT_ORDER.map((q) => {
            const p = byQuadrant.get(q);
            return (
              <TableRow key={q}>
                <TableCell className="font-medium">
                  <Dot color={QUADRANT_COLORS[q]} /> {q}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p?.n_suppliers ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(p?.total_spend ?? 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.pct_of_total_spend ?? 0)}%</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.avg_performance_score ?? null)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PerformanceTab({ perf }: { perf: PerformanceSpendResult }) {
  const byZone = new Map(perf.zone_profiles.map((p) => [p.zone, p]));
  return (
    <div className="flex flex-col gap-4">
      <PerformanceSpendScatter
        suppliers={perf.suppliers}
        thresholds={perf.axis_thresholds}
        colorBy="quadrant"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Zone</TableHead>
            <TableHead className="text-right">Suppliers</TableHead>
            <TableHead className="text-right">Total spend</TableHead>
            <TableHead className="text-right">% of spend</TableHead>
            <TableHead className="text-right">Avg performance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ZONE_ORDER.map((z) => {
            const p = byZone.get(z);
            return (
              <TableRow key={z}>
                <TableCell className="font-medium">
                  <Dot color={ZONE_COLORS[z]} /> {z}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p?.n_suppliers ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(p?.total_spend_usd ?? 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.pct_of_total_spend ?? 0)}%</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.avg_performance ?? null)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Two-tab card: Kraljic matrix and Performance vs spend, each chart + profiles. */
export function ClassificationTabs({
  kraljic,
  perf,
}: {
  kraljic: KraljicResult | null;
  perf: PerformanceSpendResult;
}) {
  const [tab, setTab] = useState<"kraljic" | "performance">("kraljic");

  return (
    <Card className={cardElevation}>
      <CardHeader className="pb-2">
        <CardTitle>Classification views</CardTitle>
        <PillTabs
          className="mt-2"
          tabs={[["kraljic", "Kraljic matrix"], ["performance", "Performance vs spend"]] as const}
          active={tab}
          onChange={setTab}
        />
      </CardHeader>
      <CardContent className="p-4">
        {tab === "kraljic" ? (
          <KraljicTab kraljic={kraljic} />
        ) : (
          <PerformanceTab perf={perf} />
        )}
      </CardContent>
    </Card>
  );
}
