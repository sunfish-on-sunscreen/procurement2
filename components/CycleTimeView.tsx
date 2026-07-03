"use client";

import { useState } from "react";
import type {
  CycleTimeResult,
  CycleDescriptive,
  KraljicQuadrant,
} from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Button } from "@/components/ui/button";
import { StatBlock } from "@/components/ui/stat-block";
import { MonthlyCycleTrendChart } from "@/components/charts/MonthlyCycleTrendChart";
import { CycleTimeBoxPlot } from "@/components/charts/CycleTimeBoxPlot";
import { CycleStatGrid } from "@/components/CycleTime/CycleStatGrid";
import { StageDecompositionTable } from "@/components/CycleTime/StageDecompositionTable";
import type { ControlExposure } from "@/lib/cycle-time-types";
import { SortArrow } from "@/components/RankingCells";
import { useTableSort, type SortDir } from "@/lib/use-table-sort";
import { cardElevation, formatCompactCurrency } from "@/lib/utils";

const QUAD_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

// 2-decimal medians (precision audit AA — cycle-time medians show 2dp).
const d2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

// ---- Sortable column header (shadcn TableHead + shared SortArrow) ---------- #
function SortHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  defaultDir = "desc",
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: SortDir;
  onSort: (key: string, defaultDir: SortDir) => void;
  align?: "left" | "right";
  defaultDir?: SortDir;
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <SortArrow active={active} dir={active ? dir : "desc"} />
      </button>
    </TableHead>
  );
}

// ---- Cycle time by Kraljic quadrant (descriptives, sortable) --------------- #
type QuadCycleRow = { order: number; quadrant: KraljicQuadrant } & CycleDescriptive;

function CycleByQuadrantTable({ data }: { data: CycleTimeResult }) {
  const rows: QuadCycleRow[] = QUAD_ORDER.map((q, i) => ({
    order: i,
    quadrant: q,
    ...data.cycle_by_quadrant[q],
  }));
  const { sorted, sort, toggle } = useTableSort<QuadCycleRow, string>(
    rows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "order",
    "asc",
  );
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Cycle Time by Exposure positioning</CardTitle>
        <CardDescription>Total cycle days per Exposure position (Kraljic matrix quadrants).</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Quadrant" sortKey="order" active={sort.key === "order"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
              <SortHead label="N" sortKey="n" active={sort.key === "n"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="Average" sortKey="mean" active={sort.key === "mean"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="Median" sortKey="median" active={sort.key === "median"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="P25" sortKey="p25" active={sort.key === "p25"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="P75" sortKey="p75" active={sort.key === "p75"} dir={sort.dir} onSort={toggle} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((q) => (
              <TableRow key={q.quadrant}>
                <TableCell className="font-medium">{q.quadrant}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{q.n}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(q.mean)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(q.median)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(q.p25)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(q.p75)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- 3-way match by Kraljic quadrant (pass rate, sortable) ----------------- #
type MatchRow = {
  order: number;
  quadrant: KraljicQuadrant;
  n: number;
  pass_rate_pct: number | null;
  is_worst: boolean;
};

// Spend-at-risk narrative — states only the factual magnitudes (rate, $ at risk,
// % of spend, suppliers spanned, value-vs-count share). Deliberately makes NO
// causal claim ("diffuse", "not tied to payment/quality/PO size") — those were a
// baked pre-recompute test result, never re-verified. Self-omits when nothing failed.
function ControlInsight({ c }: { c: ControlExposure }) {
  if (c.n_failed === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        No POs failed the 3-way match this period — no spend at risk.
      </p>
    );
  }
  const oneIn = Math.round(c.n_total / c.n_failed);
  const byCount = c.n_total > 0 ? (c.n_failed / c.n_total) * 100 : 0;
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      Roughly 1 in {oneIn} POs ({c.n_failed} of {c.n_total}) failed the 3-way match this period,
      carrying{" "}
      <strong className="font-medium text-foreground">{formatCompactCurrency(c.failed_spend)}</strong>{" "}
      of spend — <strong className="font-medium text-foreground">{c.pct_at_risk.toFixed(1)}%</strong>{" "}
      of the {formatCompactCurrency(c.total_spend)} total, spread across{" "}
      <strong className="font-medium text-foreground">{c.n_failing_suppliers}</strong> of{" "}
      {c.n_total_suppliers} active suppliers. Those failed POs are {c.pct_at_risk.toFixed(1)}% of spend
      by value and {byCount.toFixed(1)}% of POs by count.
    </p>
  );
}

function ThreeWayMatchTable({
  data,
  control,
}: {
  data: CycleTimeResult;
  control?: ControlExposure;
}) {
  const rows: MatchRow[] = QUAD_ORDER.map((q, i) => ({
    order: i,
    quadrant: q,
    ...data.three_way_match_by_quadrant[q],
  }));
  const { sorted, sort, toggle } = useTableSort<MatchRow, string>(
    rows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "order",
    "asc",
  );

  const quadTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead label="Quadrant" sortKey="order" active={sort.key === "order"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
          <SortHead label="N" sortKey="n" active={sort.key === "n"} dir={sort.dir} onSort={toggle} align="right" />
          <SortHead label="Pass Rate" sortKey="pass_rate_pct" active={sort.key === "pass_rate_pct"} dir={sort.dir} onSort={toggle} align="right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((m) => (
          <TableRow key={m.quadrant}>
            <TableCell className="font-medium">{m.quadrant}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{m.n}</TableCell>
            <TableCell
              className={`text-right tabular-nums ${m.is_worst ? "font-semibold text-destructive" : ""}`}
            >
              {m.pass_rate_pct != null ? `${m.pass_rate_pct.toFixed(1)}%` : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  // Reports / range-compute don't pass `control` → keep the original bare table.
  if (!control) {
    return (
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>3-Way Match by Exposure positioning</CardTitle>
          <CardDescription>
            Share of POs passing the 3-way match, by Exposure position (Kraljic matrix quadrants).
          </CardDescription>
        </CardHeader>
        <CardContent>{quadTable}</CardContent>
      </Card>
    );
  }

  // Dashboard: spend-at-risk control framing (headline + insight), quadrant table demoted.
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>3-Way Match — Control Exposure</CardTitle>
        <CardDescription>
          Spend that passed through POs where PO, delivery, and invoice didn&apos;t reconcile.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatBlock
            size="comfortable"
            label="Spend through failed matches"
            value={formatCompactCurrency(control.failed_spend)}
            sublabel="PO / delivery / invoice didn't reconcile"
          />
          <StatBlock
            size="comfortable"
            label="Share of total spend"
            value={`${control.pct_at_risk.toFixed(1)}%`}
            sublabel={`of ${formatCompactCurrency(control.total_spend)}`}
          />
          <StatBlock
            size="comfortable"
            label="Failed POs"
            value={String(control.n_failed)}
            sublabel={`across ${control.n_failing_suppliers} suppliers`}
          />
        </div>
        <ControlInsight c={control} />
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">
            Pass rate by exposure positioning
          </h4>
          {quadTable}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Outlier POs table (sortable, top 10 + show all) ----------------------- #
// Native z>2σ anomaly list. Rendered in reports / range-compute; the dashboard
// hides it (showAnomaliesTable={false}) since PO-level detail moved to the
// per-supplier drill-down.
function AnomaliesTable({ data }: { data: CycleTimeResult["anomalies"] }) {
  const [showAll, setShowAll] = useState(false);
  const { sorted, sort, toggle } = useTableSort<CycleTimeResult["anomalies"][number], string>(
    data,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "z_score",
    "desc",
  );
  const rows = showAll ? sorted : sorted.slice(0, 10);
  return (
    <Card id="cycle-anomalies" className={cardElevation}>
      <CardHeader>
        <CardTitle>Outlier POs</CardTitle>
        <CardDescription>
          POs with cycle time more than 2 standard deviations above the mean
          (Z-score &gt; 2), worth investigating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No POs exceeded the 2σ anomaly threshold this period.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="PO ID" sortKey="po_id" active={sort.key === "po_id"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
                  <SortHead label="Supplier" sortKey="supplier_name" active={sort.key === "supplier_name"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
                  <SortHead label="Invoice Date" sortKey="invoice_date" active={sort.key === "invoice_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
                  <SortHead label="Cycle Days" sortKey="cycle_days" active={sort.key === "cycle_days"} dir={sort.dir} onSort={toggle} align="right" />
                  <SortHead label="Z-Score" sortKey="z_score" active={sort.key === "z_score"} dir={sort.dir} onSort={toggle} align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.po_id}>
                    <TableCell className="font-medium">{a.po_id}</TableCell>
                    <TableCell>{a.supplier_name}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {a.invoice_date ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.cycle_days ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-destructive">
                      {a.z_score.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setShowAll((s) => !s)}
              >
                {showAll ? "Show top 10" : `View all ${data.length}`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Distribution interpretation (dashboard-only; below the box plot) ------ #
// Two self-omitting lines read from the already-computed distribution + anomalies.
function DistributionInsight({ data }: { data: CycleTimeResult }) {
  const { mean, median } = data.distribution;
  // Skew fires only when the average meaningfully exceeds the median (≥ 0.5 day).
  const skew = mean != null && median != null && mean - median >= 0.5 ? { mean, median } : null;
  const outCds = data.anomalies
    .map((a) => a.cycle_days)
    .filter((v): v is number => v != null);
  // Outlier-direction fires only when every outlier is slower than the median.
  const slow =
    median != null && outCds.length > 0 && outCds.every((v) => v > median)
      ? { max: Math.max(...outCds) }
      : null;
  if (!skew && !slow) return null;
  return (
    <ul
      className="mt-3 list-disc space-y-1 pl-5 pt-3 text-sm text-muted-foreground"
      style={{ borderTop: "0.5px solid var(--border)" }}
    >
      {skew && (
        <li>
          Slow-skewed — the average{" "}
          <strong className="font-medium text-foreground">{skew.mean.toFixed(1)} d</strong> edges above
          the median{" "}
          <strong className="font-medium text-foreground">{skew.median.toFixed(1)} d</strong>; a few
          slow POs pull it right while the fast side stays compact.
        </li>
      )}
      {slow && (
        <li>
          Outliers are all delays — every outlier sits on the slow side (up to{" "}
          <strong className="font-medium text-foreground">{slow.max} d</strong>), so the risk is
          one-directional.
        </li>
      )}
    </ul>
  );
}

export function CycleTimeView({
  data,
  embedded = false,
  showAnomaliesTable = true,
  showMonthlyTrend = true,
  showStatGrid = true,
  showStageDecomposition = true,
  showDistributionInsight = false,
  controlExposure,
  onOutlierClick,
}: {
  data: CycleTimeResult;
  embedded?: boolean;
  // The dashboard hides the Outlier POs table (PO detail moved to the per-supplier
  // drill-down); reports + range-compute keep it (default true).
  showAnomaliesTable?: boolean;
  // The dashboard replaces the Monthly Cycle Time Trend with the stage-occupancy
  // chart (in CycleTimeClient); reports + range-compute keep the trend (default true).
  showMonthlyTrend?: boolean;
  // The dashboard renders the stat grid itself (above the anomaly flags, with a 5th
  // "Slowest stage" card); reports + range-compute keep it here (default true).
  showStatGrid?: boolean;
  // The dashboard moves the stage decomposition into the merged "Stage breakdown"
  // section; reports + range-compute keep it here (default true).
  showStageDecomposition?: boolean;
  // Dashboard-only interpretation lines below the box plot (skew + outlier
  // direction). Off by default so reports/range-compute keep the box plot as-is.
  showDistributionInsight?: boolean;
  // Dashboard-only spend-at-risk data for the 3-way-match section. Omitted in
  // reports/range-compute → the bare pass-rate table renders as before.
  controlExposure?: ControlExposure;
  // Dashboard: clicking a box-plot outlier dot opens that supplier's detail panel.
  // Omitted in reports → dots keep their pin-in-editor behaviour.
  onOutlierClick?: (supplierId: string) => void;
}) {
  const d = data.distribution;

  return (
    <>
      {showStatGrid && <CycleStatGrid data={data} embedded={embedded} />}

      {showMonthlyTrend && (
        <Card className={cardElevation}>
          <CardHeader>
            <CardTitle>Monthly Cycle Time Trend</CardTitle>
            <CardDescription>
              Average total procure-to-pay days by month, with a trailing 3-month
              rolling average.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyCycleTrendChart
              trend={data.monthly_trend}
              rolling={data.rolling_avg_trend}
            />
          </CardContent>
        </Card>
      )}

      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>Cycle Time Distribution</CardTitle>
          <CardDescription>
            Median, typical range, and outliers across all POs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CycleTimeBoxPlot
            distribution={d}
            anomalies={data.anomalies}
            interactive={embedded}
            onOutlierClick={onOutlierClick}
          />
          {showDistributionInsight && <DistributionInsight data={data} />}
        </CardContent>
      </Card>

      {showStageDecomposition && (
        <Card className={cardElevation}>
          <CardHeader>
            <CardTitle>Stage Decomposition</CardTitle>
            <CardDescription>
              Where time is spent across the four procure-to-pay sub-processes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StageDecompositionTable data={data} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CycleByQuadrantTable data={data} />
        <ThreeWayMatchTable data={data} control={controlExposure} />
      </div>

      {showAnomaliesTable && <AnomaliesTable data={data.anomalies} />}
    </>
  );
}
