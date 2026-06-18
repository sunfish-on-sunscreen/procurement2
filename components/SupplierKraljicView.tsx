"use client";

import type {
  KraljicResult,
  QuadrantProfile,
  KraljicQuadrant,
} from "@/lib/analysis-types";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import { KraljicScatterChart } from "@/components/charts/KraljicScatterChart";
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

// Legend / profile-table order: high-priority quadrants first.
const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

// Narrative-card order mirrors the chart's spatial layout:
//   Bottleneck (top-left)   Strategic (top-right)
//   Routine    (bottom-left) Leverage  (bottom-right)
const CARD_ORDER: KraljicQuadrant[] = [
  "Bottleneck",
  "Strategic",
  "Routine",
  "Leverage",
];

// Declared (legacy) tier order for the crosstab rows.
const TIER_ORDER = ["Core", "Established", "Standard"];

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

const num = (n: number | null, digits = 1) =>
  n == null ? "—" : n.toFixed(digits);

function ColorDot({ quadrant }: { quadrant: KraljicQuadrant }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full align-middle"
      style={{ backgroundColor: QUADRANT_COLORS[quadrant] }}
    />
  );
}

/** The action-oriented narrative copy for each quadrant. */
function cardCopy(
  q: KraljicQuadrant,
  n: number,
  pct: string,
): { body: string; action: string } {
  switch (q) {
    case "Strategic":
      return {
        body: `${n} high-spend, high-risk suppliers. Critical to operations AND difficult to replace. Account for ${pct}% of total spend.`,
        action:
          "Build long-term partnerships, joint planning, collaborative innovation. These suppliers warrant senior-level relationship management.",
      };
    case "Leverage":
      return {
        body: `${n} high-spend suppliers in competitive categories. Significant spend exposure but multiple alternatives exist. ${pct}% of total spend.`,
        action:
          "Use buying power for negotiation. Run regular competitive RFx events. Consolidate volume across fewer suppliers for better terms.",
      };
    case "Bottleneck":
      return {
        body: `${n} low-spend, high-risk suppliers. Small dollars but hard to replace if they fail. ${pct}% of total spend.`,
        action:
          "Develop alternative suppliers. Build inventory buffers for critical items. Consider redesigning around standardized parts where possible.",
      };
    case "Routine":
      return {
        body: `${n} low-spend, low-risk suppliers in competitive markets. ${pct}% of total spend.`,
        action:
          "Automate and simplify. Use catalog buys, P-cards, framework agreements. Minimize transaction overhead.",
      };
  }
}

export function SupplierKraljicView({
  kraljic,
}: {
  kraljic: KraljicResult;
  period: string;
}) {
  const byQuadrant = new Map<KraljicQuadrant, QuadrantProfile>();
  for (const p of kraljic.quadrant_profiles) byQuadrant.set(p.quadrant, p);

  // Profile lookups, defaulting an absent quadrant to a zeroed profile.
  const profileOf = (q: KraljicQuadrant): QuadrantProfile =>
    byQuadrant.get(q) ?? {
      quadrant: q,
      n_suppliers: 0,
      total_spend: 0,
      pct_of_total_spend: 0,
      avg_performance_score: 0,
      median_risk: 0,
      median_spend: 0,
    };

  // Tier × quadrant crosstab + mis-tiering insights, computed from the
  // supplier-level assignments (declared tier vs. computed quadrant).
  const counts = new Map<string, Map<KraljicQuadrant, number>>();
  for (const a of kraljic.quadrant_assignments) {
    if (!counts.has(a.tier)) counts.set(a.tier, new Map());
    const row = counts.get(a.tier)!;
    row.set(a.quadrant, (row.get(a.quadrant) ?? 0) + 1);
  }
  const presentTiers = [
    ...TIER_ORDER.filter((t) => counts.has(t)),
    ...[...counts.keys()].filter((t) => !TIER_ORDER.includes(t)),
  ];

  const misTiered = kraljic.quadrant_assignments.filter(
    (a) => a.tier === "Core" && a.quadrant !== "Strategic",
  ).length;
  const underTiered = kraljic.quadrant_assignments.filter(
    (a) =>
      a.tier === "Standard" &&
      (a.quadrant === "Strategic" || a.quadrant === "Leverage"),
  ).length;

  return (
    <>
      {/* Methodology */}
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The Kraljic Matrix segments suppliers across two dimensions:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Profit Impact</strong> (X-axis, spend volume): how much we
              spend with this supplier.
            </li>
            <li>
              <strong>Supply Risk</strong> (Y-axis): how difficult they would be
              to replace, based on single-source status, category competition,
              country distance, and switching cost.
            </li>
          </ul>
          <p>
            Median lines divide the dataset into 4 quadrants, each requiring a
            different management approach.
          </p>
        </CardContent>
      </Card>

      {/* Scatter */}
      <Card>
        <CardHeader>
          <CardTitle>Kraljic Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <KraljicScatterChart
            assignments={kraljic.quadrant_assignments}
            thresholds={kraljic.axis_thresholds}
          />
        </CardContent>
      </Card>

      {/* Quadrant profiles */}
      <Card>
        <CardHeader>
          <CardTitle>Quadrant Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quadrant</TableHead>
                <TableHead className="text-right">Suppliers</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead className="text-right">% of Spend</TableHead>
                <TableHead className="text-right">Avg Performance</TableHead>
                <TableHead className="text-right">Median Risk</TableHead>
                <TableHead className="text-right">Median Spend (log)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {QUADRANT_ORDER.map((q) => {
                const p = profileOf(q);
                return (
                  <TableRow key={q}>
                    <TableCell className="font-medium">
                      <ColorDot quadrant={q} /> {q}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.n_suppliers}
                    </TableCell>
                    <TableCell className="text-right">
                      {usd(p.total_spend)}
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.pct_of_total_spend)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.avg_performance_score)}
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.median_risk)}
                    </TableCell>
                    <TableCell className="text-right">
                      {num(p.median_spend, 2)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Narrative cards — 2×2 grid matching chart positions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {CARD_ORDER.map((q) => {
          const p = profileOf(q);
          const { body, action } = cardCopy(
            q,
            p.n_suppliers,
            num(p.pct_of_total_spend),
          );
          return (
            <Card
              key={q}
              style={{ borderLeft: `4px solid ${QUADRANT_COLORS[q]}` }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {q}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({p.n_suppliers} suppliers)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {body}{" "}
                <span className="font-semibold text-foreground">
                  Recommended action:
                </span>{" "}
                {action}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quadrant × legacy tier crosstab */}
      <Card>
        <CardHeader>
          <CardTitle>Declared Tier vs. Kraljic Quadrant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tier</TableHead>
                {QUADRANT_ORDER.map((q) => (
                  <TableHead key={q} className="text-right">
                    <ColorDot quadrant={q} /> {q}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {presentTiers.map((tier) => (
                <TableRow key={tier}>
                  <TableCell className="font-medium">{tier}</TableCell>
                  {QUADRANT_ORDER.map((q) => (
                    <TableCell key={q} className="text-right">
                      {counts.get(tier)?.get(q) ?? 0}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm leading-relaxed">
            <p className="mb-1 font-semibold">Insights</p>
            <p className="text-muted-foreground">
              {misTiered} supplier{misTiered === 1 ? "" : "s"} labeled
              Core {misTiered === 1 ? "doesn't" : "don't"} sit in the
              Strategic quadrant — candidates for tier review. {underTiered}{" "}
              Standard supplier{underTiered === 1 ? "" : "s"} carr
              {underTiered === 1 ? "ies" : "y"} meaningful spend impact —
              promotion candidates.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
