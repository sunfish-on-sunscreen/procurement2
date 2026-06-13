"use client";

import type {
  PerformanceSpendResult,
  PerformanceSpendSupplier,
  ZoneProfile,
  PerformanceZone,
} from "@/lib/analysis-types";
import { ZONE_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { PerformanceSpendScatter } from "@/components/charts/PerformanceSpendScatter";
import { PerformanceByQuadrantChart } from "@/components/charts/PerformanceByQuadrantChart";
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

// Zone-profiles table order.
const ZONE_TABLE_ORDER: PerformanceZone[] = [
  "Stars",
  "Critical Issues",
  "Hidden Gems",
  "Long Tail",
];

// Narrative-card order mirrors the scatter's spatial layout:
//   Hidden Gems (top-left)    Stars            (top-right)
//   Long Tail   (bottom-left) Critical Issues  (bottom-right)
const CARD_ORDER: PerformanceZone[] = [
  "Hidden Gems",
  "Stars",
  "Long Tail",
  "Critical Issues",
];

// Understated monochrome ramp for legacy tier seniority (no semantic clash with
// the zone / quadrant colour schemes).
const TIER_DOT: Record<string, string> = {
  Strategic: "#475569",
  Preferred: "#94a3b8",
  Approved: "#cbd5e1",
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

const num = (n: number | null, digits = 1) =>
  n == null ? "—" : n.toFixed(digits);

function Dot({ color }: { color: string }) {
  return (
    <span
      className="mr-1 inline-block h-3 w-3 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

function cardCopy(
  z: PerformanceZone,
  n: number,
  pct: string,
): { body: string; action: string; listHint?: string } {
  switch (z) {
    case "Hidden Gems":
      return {
        body: `${n} suppliers performing above the median despite small spend. Often overlooked, these are promotion candidates worth evaluating for expanded scope.`,
        action:
          "Review for tier promotion. Consider awarding more volume. Top performers in this zone listed below.",
        listHint: "gems",
      };
    case "Stars":
      return {
        body: `${n} suppliers carrying strong performance under high spend volume. Preserve these relationships. ${pct}% of total spend.`,
        action: "Strategic partnership, long-term contracts, joint planning.",
      };
    case "Long Tail":
      return {
        body: `${n} suppliers with limited engagement on both dimensions. Often candidates for consolidation or removal from the active vendor list.`,
        action: "Rationalize, simplify, or move to catalog buys.",
      };
    case "Critical Issues":
      return {
        body: `${n} suppliers absorbing high spend with concerning performance. ${pct}% of total spend. These are the highest-priority engagement targets.`,
        action:
          "Immediate supplier development, performance improvement plans, or sourcing alternatives. Top exposures listed below.",
        listHint: "critical",
      };
  }
}

/** Compact inline list rendered inside the Hidden Gems / Critical Issues cards. */
function InlineList({ rows }: { rows: PerformanceSpendSupplier[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t pt-2">
      {rows.map((r) => (
        <li key={r.supplier_id} className="flex justify-between gap-2 text-xs">
          <span className="truncate font-medium text-foreground">
            {r.supplier_name}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {usd(r.total_spend_usd)} &middot; perf {r.performance_score.toFixed(0)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DetailTable({
  title,
  rows,
  orderBy,
}: {
  title: string;
  rows: PerformanceSpendSupplier[];
  orderBy: "spend" | "performance";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suppliers in this zone for the selected period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Kraljic Quadrant</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead className="text-right">Performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.supplier_id}>
                  <TableCell className="text-muted-foreground">
                    {i + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.supplier_name}
                  </TableCell>
                  <TableCell>
                    <Dot color={TIER_DOT[r.tier] ?? "#cbd5e1"} />
                    {r.tier}
                  </TableCell>
                  <TableCell>
                    <Dot color={QUADRANT_COLORS[r.kraljic_quadrant]} />
                    {r.kraljic_quadrant}
                  </TableCell>
                  <TableCell
                    className={`text-right ${orderBy === "spend" ? "font-semibold" : ""}`}
                  >
                    {usd(r.total_spend_usd)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${orderBy === "performance" ? "font-semibold" : ""}`}
                  >
                    {r.performance_score.toFixed(1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function PerformanceSpendView({
  data,
}: {
  data: PerformanceSpendResult;
  period: string;
}) {
  const byZone = new Map<PerformanceZone, ZoneProfile>();
  for (const p of data.zone_profiles) byZone.set(p.zone, p);
  const profileOf = (z: PerformanceZone): ZoneProfile =>
    byZone.get(z) ?? {
      zone: z,
      n_suppliers: 0,
      total_spend_usd: 0,
      pct_of_total_spend: 0,
      avg_performance: 0,
    };

  return (
    <>
      {/* Methodology */}
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This diagnostic compares spend volume against supplier performance.
            The median lines split suppliers into 4 zones:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Stars</strong> — high spend, high performance: preserve
              relationships.
            </li>
            <li>
              <strong>Critical Issues</strong> — high spend, low performance:
              top priority for engagement.
            </li>
            <li>
              <strong>Hidden Gems</strong> — low spend, high performance:
              promotion candidates.
            </li>
            <li>
              <strong>Long Tail</strong> — low spend, low performance: simplify
              or rationalize.
            </li>
          </ul>
          <p>
            Each dot is colored by Kraljic quadrant for cross-reference with the
            Supplier Quadrant analysis.
          </p>
        </CardContent>
      </Card>

      {/* Scatter */}
      <Card>
        <CardHeader>
          <CardTitle>Performance vs Spend</CardTitle>
        </CardHeader>
        <CardContent>
          <PerformanceSpendScatter
            suppliers={data.suppliers}
            thresholds={data.axis_thresholds}
            colorBy="quadrant"
          />
        </CardContent>
      </Card>

      {/* Zone profiles */}
      <Card>
        <CardHeader>
          <CardTitle>Zone Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zone</TableHead>
                <TableHead className="text-right">Suppliers</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead className="text-right">% of Spend</TableHead>
                <TableHead className="text-right">Avg Performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ZONE_TABLE_ORDER.map((z) => {
                const p = profileOf(z);
                return (
                  <TableRow key={z}>
                    <TableCell className="font-medium">
                      <Dot color={ZONE_COLORS[z]} /> {z}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.n_suppliers}
                    </TableCell>
                    <TableCell className="text-right">
                      {usd(p.total_spend_usd)}
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.pct_of_total_spend)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.avg_performance)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Narrative cards — 2×2 grid matching the scatter layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARD_ORDER.map((z) => {
          const p = profileOf(z);
          const { body, action, listHint } = cardCopy(
            z,
            p.n_suppliers,
            num(p.pct_of_total_spend),
          );
          return (
            <Card key={z} style={{ borderLeft: `4px solid ${ZONE_COLORS[z]}` }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {z}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({p.n_suppliers} suppliers)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {body}{" "}
                <span className="font-semibold text-foreground">Action:</span>{" "}
                {action}
                {listHint === "gems" && (
                  <InlineList rows={data.top_hidden_gems} />
                )}
                {listHint === "critical" && (
                  <InlineList rows={data.top_critical_issues} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detail tables */}
      <DetailTable
        title="Top Critical Issues (by spend exposure)"
        rows={data.top_critical_issues}
        orderBy="spend"
      />
      <DetailTable
        title="Top Hidden Gems (by performance)"
        rows={data.top_hidden_gems}
        orderBy="performance"
      />

      {/* Tier mismatch by zone */}
      {data.tier_mismatch_by_zone && (
        <Card>
          <CardHeader>
            <CardTitle>Tier Mismatch by Zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Mismatched / Total</TableHead>
                  <TableHead className="text-right">% Mismatched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ZONE_TABLE_ORDER.map((z) => {
                  const m = data.tier_mismatch_by_zone![z] ?? {
                    mismatched: 0,
                    total: 0,
                  };
                  const pctVal = m.total ? (m.mismatched / m.total) * 100 : 0;
                  return (
                    <TableRow key={z}>
                      <TableCell className="font-medium">
                        <Dot color={ZONE_COLORS[z]} /> {z}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.mismatched} / {m.total}
                      </TableCell>
                      <TableCell className="text-right">
                        {pctVal.toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {(() => {
              const totalMismatch = ZONE_TABLE_ORDER.reduce(
                (a, z) => a + (data.tier_mismatch_by_zone![z]?.mismatched ?? 0),
                0,
              );
              const gemNames = data.top_hidden_gems
                .slice(0, 3)
                .map((g) => g.supplier_name);
              return (
                <div className="rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm leading-relaxed">
                  <p className="mb-1 font-semibold">Insights</p>
                  <p className="text-muted-foreground">
                    {totalMismatch} total tier mismatch
                    {totalMismatch === 1 ? "" : "es"} across all zones. The most
                    actionable group is Hidden Gems (Approved suppliers
                    performing well — promotion candidates
                    {gemNames.length ? `: ${gemNames.join(", ")}` : ""}).
                  </p>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Performance by Kraljic quadrant */}
      <Card>
        <CardHeader>
          <CardTitle>Average Performance Score by Kraljic Quadrant</CardTitle>
          <p className="text-sm text-muted-foreground">
            Shows whether high-impact suppliers (Strategic, Leverage) are also
            high-performing.
          </p>
        </CardHeader>
        <CardContent>
          <PerformanceByQuadrantChart data={data.performance_by_quadrant} />
        </CardContent>
      </Card>
    </>
  );
}
