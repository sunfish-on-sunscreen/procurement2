"use client";

import { useState } from "react";
import Link from "next/link";
import { X, ArrowRight } from "lucide-react";
import type {
  KraljicResult,
  PerformanceSpendResult,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";
import { QUADRANT_COLORS, ZONE_COLORS } from "@/lib/chart-colors";
import { cardElevation, formatCompactCurrency } from "@/lib/utils";
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

/** One member in the "who's here" list: name + its two positioning metrics. */
type Member = { id: string; name: string; metric: string };

/**
 * "Who's here" drill-down (Change 4a). Lists the suppliers in the selected group
 * with their key positioning metrics (spend + risk / performance) — the page's
 * job is WHO's in the group and WHERE they sit, NOT rankings or treatment recs
 * (that's the Action Dashboard's job), so it hands off there via a link. Each row
 * opens the supplier's detail panel; the group selection is reversible via Clear.
 */
function GroupMembersPanel({
  color,
  title,
  members,
  onSupplierClick,
  onClear,
}: {
  color: string;
  title: string;
  members: Member[];
  onSupplierClick: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          <Dot color={color} />
          {title} · {members.length} supplier{members.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-foreground/5"
        >
          Clear <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {members.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          No suppliers in this group for the selected period.
        </p>
      ) : (
        <ul className="max-h-56 divide-y overflow-y-auto">
          {members.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSupplierClick(m.id)}
                title={m.name}
                className="flex w-full items-center justify-between gap-3 px-1 py-1.5 text-left text-sm hover:bg-foreground/5"
              >
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{m.metric}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t pt-2">
        <Link
          href="/action-dashboard"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View &amp; treat these in Action Dashboard <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function KraljicTab({
  kraljic,
  onSupplierClick,
}: {
  kraljic: KraljicResult | null;
  onSupplierClick: (id: string) => void;
}) {
  const [selected, setSelected] = useState<KraljicQuadrant | null>(null);

  if (!kraljic) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No Exposure positioning data for this period.
      </p>
    );
  }
  const byQuadrant = new Map(kraljic.quadrant_profiles.map((p) => [p.quadrant, p]));

  // Members of the selected quadrant, highest spend first. Spend is recovered
  // from log_spend (expm1) — QuadrantAssignment carries no raw spend field.
  const members: Member[] = selected
    ? kraljic.quadrant_assignments
        .filter((a) => a.quadrant === selected)
        .map((a) => ({ raw: a, spend: Math.expm1(a.log_spend) }))
        .sort((a, b) => b.spend - a.spend)
        .map(({ raw, spend }) => ({
          id: raw.supplier_id,
          name: raw.supplier_name,
          metric: `${formatCompactCurrency(spend)} · Risk ${raw.supply_risk_score.toFixed(1)}`,
        }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <KraljicScatterChart
        assignments={kraljic.quadrant_assignments}
        thresholds={kraljic.axis_thresholds}
        highlightQuadrant={selected}
        onDotClick={onSupplierClick}
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
            const isSel = selected === q;
            return (
              <TableRow
                key={q}
                onClick={() => setSelected(isSel ? null : q)}
                className={`cursor-pointer ${
                  isSel ? "bg-foreground/5 ring-1 ring-inset ring-foreground/25" : "hover:bg-muted/40"
                }`}
              >
                <TableCell className="font-medium">
                  <Dot color={QUADRANT_COLORS[q]} /> {q}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p?.n_suppliers ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(p?.total_spend ?? 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.pct_of_total_spend ?? 0)}%</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.avg_performance_score ?? null, 2)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {selected && (
        <GroupMembersPanel
          color={QUADRANT_COLORS[selected]}
          title={selected}
          members={members}
          onSupplierClick={onSupplierClick}
          onClear={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function PerformanceTab({
  perf,
  onSupplierClick,
}: {
  perf: PerformanceSpendResult;
  onSupplierClick: (id: string) => void;
}) {
  const [selected, setSelected] = useState<PerformanceZone | null>(null);
  const byZone = new Map(perf.zone_profiles.map((p) => [p.zone, p]));

  const members: Member[] = selected
    ? perf.suppliers
        .filter((s) => s.zone === selected)
        .slice()
        .sort((a, b) => b.total_spend_usd - a.total_spend_usd)
        .map((s) => ({
          id: s.supplier_id,
          name: s.supplier_name,
          metric: `${formatCompactCurrency(s.total_spend_usd)} · Perf ${s.performance_score.toFixed(1)}`,
        }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <PerformanceSpendScatter
        suppliers={perf.suppliers}
        thresholds={perf.axis_thresholds}
        highlightZone={selected}
        onDotClick={onSupplierClick}
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
            const isSel = selected === z;
            return (
              <TableRow
                key={z}
                onClick={() => setSelected(isSel ? null : z)}
                className={`cursor-pointer ${
                  isSel ? "bg-foreground/5 ring-1 ring-inset ring-foreground/25" : "hover:bg-muted/40"
                }`}
              >
                <TableCell className="font-medium">
                  <Dot color={ZONE_COLORS[z]} /> {z}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p?.n_suppliers ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(p?.total_spend_usd ?? 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.pct_of_total_spend ?? 0)}%</TableCell>
                <TableCell className="text-right tabular-nums">{num(p?.avg_performance ?? null, 2)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {selected && (
        <GroupMembersPanel
          color={ZONE_COLORS[selected]}
          title={selected}
          members={members}
          onSupplierClick={onSupplierClick}
          onClear={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/**
 * Two-tab card: Exposure positioning (Kraljic) and Performance positioning, each
 * a scatter + a profile table. Clicking a profile row (Change 4a) highlights that
 * group in the scatter and expands a "who's here" panel below the table; clicking
 * a scatter point (Change 4b) opens that supplier's detail panel. Switching tabs
 * unmounts the other's local selection, so each tab resets its own view.
 */
export function ClassificationTabs({
  kraljic,
  perf,
  onSupplierClick,
}: {
  kraljic: KraljicResult | null;
  perf: PerformanceSpendResult;
  onSupplierClick: (id: string) => void;
}) {
  const [tab, setTab] = useState<"kraljic" | "performance">("kraljic");

  return (
    <Card className={cardElevation}>
      <CardHeader className="pb-2">
        <CardTitle>Classification views</CardTitle>
        <PillTabs
          className="mt-2"
          tabs={[["kraljic", "Exposure positioning"], ["performance", "Performance positioning"]] as const}
          active={tab}
          onChange={setTab}
        />
      </CardHeader>
      <CardContent className="p-4">
        {tab === "kraljic" ? (
          <KraljicTab kraljic={kraljic} onSupplierClick={onSupplierClick} />
        ) : (
          <PerformanceTab perf={perf} onSupplierClick={onSupplierClick} />
        )}
      </CardContent>
    </Card>
  );
}
