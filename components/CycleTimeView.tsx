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

function StatCard({
  label,
  value,
  sub,
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  // Batch 6c: editor-only sparkline (omit to render a plain card).
  spark?: Array<number | null | undefined>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl font-semibold">{value}</div>
          {spark && (
            <div className="text-primary">
              <Sparkline data={spark} />
            </div>
          )}
        </div>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function DescRow({ label, s }: { label: string; s: CycleDescriptive }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right text-muted-foreground">{s.n}</TableCell>
      <TableCell className="text-right">{d1(s.mean)}</TableCell>
      <TableCell className="text-right">{d0(s.median)}</TableCell>
      <TableCell className="text-right">{d0(s.p25)}</TableCell>
      <TableCell className="text-right">{d0(s.p75)}</TableCell>
    </TableRow>
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
        <StatCard
          label="Mann-Whitney U"
          value={c.mannwhitney_u != null ? c.mannwhitney_u.toFixed(0) : "—"}
          sub={`n = ${c.period_a.n} vs ${c.period_b.n}`}
        />
        <StatCard label="p-value" value={formatP(c.p_value)} sub="α = 0.05" />
        <StatCard
          label="Rank-biserial r"
          value={c.rank_biserial_r != null ? c.rank_biserial_r.toFixed(3) : "—"}
          sub={c.effect_size_label ?? "—"}
        />
        <StatCard
          label="Median A → B"
          value={`${d0(c.median_a)} → ${d0(c.median_b)} d`}
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
          <Tooltip formatter={(v) => [`${Number(v).toFixed(1)} days`, "Median"]} />
          <Bar dataKey="median" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
    <Card>
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

// ---- Anomalies table (top 10 + show all) ---------------------------------- #
function AnomaliesTable({ data }: { data: CycleTimeResult["anomalies"] }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? data : data.slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Anomalies</CardTitle>
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
                  <TableHead>PO ID</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead className="text-right">Cycle Days</TableHead>
                  <TableHead className="text-right">Z-Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.po_id}>
                    <TableCell className="font-medium">{a.po_id}</TableCell>
                    <TableCell>{a.supplier_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.invoice_date ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{a.cycle_days ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">
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

export function CycleTimeView({
  data,
  embedded = false,
}: {
  data: CycleTimeResult;
  embedded?: boolean;
}) {
  const d = data.distribution;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Median cycle time"
          value={`${d0(d.median)} days`}
          sub={`n = ${d.n} POs`}
          spark={
            embedded
              ? data.monthly_trend.map((m) => m.median_cycle_days)
              : undefined
          }
        />
        <StatCard
          label="IQR (P25–P75)"
          value={`${d0(d.p25)}–${d0(d.p75)} d`}
          sub={`spread ${d0(d.iqr)} d`}
        />
        <StatCard
          label="Mean"
          value={`${d1(d.mean)} d`}
          sub={d.std != null ? `σ = ${d1(d.std)}` : undefined}
        />
        <StatCard label="Range" value={`${d0(d.min)}–${d0(d.max)} d`} />
      </div>

      <Card>
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

      <Card>
        <CardHeader>
          <CardTitle>Cycle Time Distribution</CardTitle>
          <CardDescription>
            Median, interquartile range, and outliers across all POs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CycleTimeBoxPlot distribution={d} anomalies={data.anomalies} />
        </CardContent>
      </Card>

      <Card>
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
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">N</TableHead>
                <TableHead className="text-right">Mean</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">P25</TableHead>
                <TableHead className="text-right">P75</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STAGES.map((s) => (
                <DescRow
                  key={s.key}
                  label={s.label}
                  s={data.stage_breakdown[s.key]}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cycle Time by Supplier Type</CardTitle>
            <CardDescription>
              Total cycle days per Kraljic quadrant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quadrant</TableHead>
                  <TableHead className="text-right">N</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">P25</TableHead>
                  <TableHead className="text-right">P75</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {QUAD_ORDER.map((q) => (
                  <DescRow key={q} label={q} s={data.cycle_by_quadrant[q]} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3-Way Match by Supplier Type</CardTitle>
            <CardDescription>
              Share of POs passing the 3-way match, by Kraljic quadrant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quadrant</TableHead>
                  <TableHead className="text-right">N</TableHead>
                  <TableHead className="text-right">Pass Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {QUAD_ORDER.map((q) => {
                  const m = data.three_way_match_by_quadrant[q];
                  return (
                    <TableRow key={q}>
                      <TableCell className="font-medium">{q}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {m.n}
                      </TableCell>
                      <TableCell
                        className={`text-right ${m.is_worst ? "font-semibold text-destructive" : ""}`}
                      >
                        {m.pass_rate_pct != null
                          ? `${m.pass_rate_pct.toFixed(1)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <AnomaliesTable data={data.anomalies} />

      <PeriodComparisonSection initial={data.period_comparison} />
    </>
  );
}
