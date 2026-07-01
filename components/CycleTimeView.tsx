"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type {
  CycleTimeResult,
  CycleDescriptive,
  KraljicQuadrant,
  PeriodComparison,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { MonthlyCycleTrendChart } from "@/components/charts/MonthlyCycleTrendChart";
import { CycleTimeBoxPlot } from "@/components/charts/CycleTimeBoxPlot";
import { Sparkline } from "@/components/charts/Sparkline";
import { CHART_COLORS } from "@/lib/chart-colors";
import { StatBlock } from "@/components/ui/stat-block";
import { SortArrow } from "@/components/RankingCells";
import { useTableSort, type SortDir } from "@/lib/use-table-sort";
import { cardElevation } from "@/lib/utils";
import { CycleFilterBanner } from "@/components/CycleTime/CycleFilterBanner";

const QUAD_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

const STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

const d0 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(0));
const d1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
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

function formatP(p: number | null): string {
  if (p == null) return "—";
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(4);
}

// ---- Period-vs-period comparison (collapsible, on-demand) ------------------ #
function ComparisonResult({ c }: { c: PeriodComparison }) {
  if (c.insufficient_data) {
    return (
      <Alert>
        <TriangleAlert />
        <AlertTitle>Not enough data to compare</AlertTitle>
        <AlertDescription>
          One window has fewer than 10 POs (A: {c.period_a.n}, B: {c.period_b.n}).
          The Mann-Whitney U test needs at least 10 in each group. Widen the
          windows or pick a denser period.
        </AlertDescription>
      </Alert>
    );
  }
  const significant = c.p_value != null && c.p_value < 0.05;
  const barData = [
    { group: "Window A", median: c.median_a ?? 0 },
    { group: "Window B", median: c.median_b ?? 0 },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock
          label="Mann-Whitney U"
          value={c.mannwhitney_u != null ? c.mannwhitney_u.toFixed(0) : "—"}
          sublabel={`n = ${c.period_a.n} vs ${c.period_b.n}`}
        />
        <StatBlock label="p-value" value={formatP(c.p_value)} sublabel="α = 0.05" />
        <StatBlock
          label="Rank-biserial r"
          value={c.rank_biserial_r != null ? c.rank_biserial_r.toFixed(3) : "—"}
          sublabel={c.effect_size_label ?? "—"}
        />
        <StatBlock
          label="Median A → B"
          value={`${d2(c.median_a)} → ${d2(c.median_b)} d`}
        />
      </div>
      <ChartFrame height={200}>
        <BarChart data={barData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="group" tick={{ fontSize: 12 }} />
          <YAxis
            width={48}
            tick={{ fontSize: 11 }}
            label={{
              value: "median days",
              angle: -90,
              position: "insideLeft",
              fontSize: 10,
            }}
          />
          <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} days`, "Median"]} />
          <Bar dataKey="median" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartFrame>
      <Alert variant={significant ? "default" : "destructive"}>
        <AlertTitle>
          {significant
            ? "Statistically significant difference"
            : "No significant difference"}
        </AlertTitle>
        <AlertDescription>
          {significant
            ? `Cycle-time distributions differ between the two windows (p = ${formatP(
                c.p_value,
              )}, ${c.effect_size_label} effect).`
            : `The two windows are not significantly different at α = 0.05 (p = ${formatP(
                c.p_value,
              )}).`}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function PeriodComparisonSection({ initial }: { initial: PeriodComparison }) {
  const [open, setOpen] = useState(false);
  const [startA, setStartA] = useState(initial.period_a.start);
  const [endA, setEndA] = useState(initial.period_a.end);
  const [startB, setStartB] = useState(initial.period_b.start);
  const [endB, setEndB] = useState(initial.period_b.end);
  const [result, setResult] = useState<PeriodComparison>(initial);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/analyses/cycle-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comparison_start_a: startA,
          comparison_end_a: endA,
          comparison_start_b: startB,
          comparison_end_b: endB,
        }),
      });
      const json = (await res.json()) as {
        period_comparison?: PeriodComparison;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !json.period_comparison) {
        throw new Error(json.error || "Comparison failed");
      }
      setResult(json.period_comparison);
      setWarning(json.warning ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <CardTitle>Period-vs-Period Comparison</CardTitle>
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            (compare two date ranges)
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Window A</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={startA}
                  onChange={(e) => setStartA(e.target.value)}
                  className="w-[150px]"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={endA}
                  onChange={(e) => setEndA(e.target.value)}
                  className="w-[150px]"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Window B</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={startB}
                  onChange={(e) => setStartB(e.target.value)}
                  className="w-[150px]"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={endB}
                  onChange={(e) => setEndB(e.target.value)}
                  className="w-[150px]"
                />
              </div>
            </div>
          </div>
          <div>
            <Button onClick={compare} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Compare
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {warning && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{warning}</p>
          )}
          <ComparisonResult c={result} />
        </CardContent>
      )}
    </Card>
  );
}

// ---- Stage decomposition (single-population descriptives, sortable) -------- #
type StageRow = { order: number; key: string; label: string } & CycleDescriptive;

function StageDecompositionTable({ data }: { data: CycleTimeResult }) {
  const rows: StageRow[] = STAGES.map((s, i) => ({
    order: i,
    key: s.key,
    label: s.label,
    ...data.stage_breakdown[s.key],
  }));
  const { sorted, sort, toggle } = useTableSort<StageRow, string>(
    rows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "order",
    "asc",
  );
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Stage Decomposition</CardTitle>
        <CardDescription>
          Where time is spent across the four procure-to-pay sub-processes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Stage" sortKey="order" active={sort.key === "order"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
              <SortHead label="N" sortKey="n" active={sort.key === "n"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="Mean" sortKey="mean" active={sort.key === "mean"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="Median" sortKey="median" active={sort.key === "median"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="P25" sortKey="p25" active={sort.key === "p25"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="P75" sortKey="p75" active={sort.key === "p75"} dir={sort.dir} onSort={toggle} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => (
              <TableRow key={s.key}>
                <TableCell className="font-medium">{s.label}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{s.n}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(s.mean)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(s.median)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(s.p25)}</TableCell>
                <TableCell className="text-right tabular-nums">{d2(s.p75)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
        <CardTitle>Cycle Time by Kraljic quadrant</CardTitle>
        <CardDescription>Total cycle days per Kraljic quadrant.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Quadrant" sortKey="order" active={sort.key === "order"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
              <SortHead label="N" sortKey="n" active={sort.key === "n"} dir={sort.dir} onSort={toggle} align="right" />
              <SortHead label="Mean" sortKey="mean" active={sort.key === "mean"} dir={sort.dir} onSort={toggle} align="right" />
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

function ThreeWayMatchTable({ data }: { data: CycleTimeResult }) {
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
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>3-Way Match by Kraljic quadrant</CardTitle>
        <CardDescription>
          Share of POs passing the 3-way match, by Kraljic quadrant.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

// ---- Anomalies table (sortable, top 10 + show all) ------------------------- #
// Optional external filter (from the anomaly action cards): swaps in a filtered
// row set + a banner. When omitted, renders the native z>2σ anomaly list.
export type AnomalyFilter = {
  rows: CycleTimeResult["anomalies"];
  label: string;
  onClear: () => void;
};

function AnomaliesTable({
  data,
  filter,
}: {
  data: CycleTimeResult["anomalies"];
  filter?: AnomalyFilter | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const source = filter ? filter.rows : data;
  const { sorted, sort, toggle } = useTableSort<CycleTimeResult["anomalies"][number], string>(
    source,
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
        {filter && (
          <CycleFilterBanner label={filter.label} count={filter.rows.length} onClear={filter.onClear} />
        )}
        {source.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filter
              ? "No POs match this filter."
              : "No POs exceeded the 2σ anomaly threshold this period."}
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
            {source.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setShowAll((s) => !s)}
              >
                {showAll ? "Show top 10" : `View all ${source.length}`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CycleTimeView({
  data,
  embedded = false,
  anomalyFilter,
}: {
  data: CycleTimeResult;
  embedded?: boolean;
  // External anomaly filter from the action cards (page only; omitted in the
  // report editor, so embedded usage is unchanged).
  anomalyFilter?: AnomalyFilter | null;
}) {
  const d = data.distribution;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBlock
          size="comfortable"
          label="Median cycle time"
          value={
            embedded ? (
              <span className="flex items-end justify-between gap-2">
                {`${d2(d.median)} days`}
                <span className="text-primary">
                  <Sparkline data={data.monthly_trend.map((m) => m.median_cycle_days)} />
                </span>
              </span>
            ) : (
              `${d2(d.median)} days`
            )
          }
          sublabel={`n = ${d.n} POs`}
        />
        <StatBlock
          size="comfortable"
          label="IQR (P25–P75)"
          value={`${d0(d.p25)}–${d0(d.p75)} d`}
          sublabel={`spread ${d0(d.iqr)} d`}
        />
        <StatBlock
          size="comfortable"
          label="Mean"
          value={`${d1(d.mean)} d`}
          sublabel={d.std != null ? `σ = ${d1(d.std)}` : undefined}
        />
        <StatBlock size="comfortable" label="Range" value={`${d0(d.min)}–${d0(d.max)} d`} />
      </div>

      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>Monthly Cycle Time Trend</CardTitle>
          <CardDescription>
            Mean total procure-to-pay days by month, with a trailing 3-month
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

      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>Cycle Time Distribution</CardTitle>
          <CardDescription>
            Median, interquartile range, and outliers across all POs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CycleTimeBoxPlot distribution={d} anomalies={data.anomalies} interactive={embedded} />
        </CardContent>
      </Card>

      <StageDecompositionTable data={data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CycleByQuadrantTable data={data} />
        <ThreeWayMatchTable data={data} />
      </div>

      <AnomaliesTable data={data.anomalies} filter={anomalyFilter} />

      <PeriodComparisonSection initial={data.period_comparison} />
    </>
  );
}
