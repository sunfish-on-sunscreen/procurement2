"use client";

import { CheckCircle2, TriangleAlert, Info } from "lucide-react";
import type {
  HypothesisResult,
  StageBreakdown,
  QuadrantCycleStats,
  ThreeWayMatchStats,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CycleTimeBoxPlot } from "@/components/charts/CycleTimeBoxPlot";
import { CycleTimeHistogram } from "@/components/charts/CycleTimeHistogram";
import { MonthlyCycleTrendChart } from "@/components/charts/MonthlyCycleTrendChart";
import { StageBreakdownChart } from "@/components/charts/StageBreakdownChart";
import { CycleByQuadrantChart } from "@/components/charts/CycleByQuadrantChart";

const QUAD_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

function stageCallout(pre: StageBreakdown, post: StageBreakdown): string {
  const stages = [
    { key: "pr_to_po", label: "PR→PO" },
    { key: "po_to_delivery", label: "PO→delivery" },
    { key: "delivery_to_invoice", label: "delivery→invoice" },
    { key: "invoice_to_payment", label: "invoice→payment" },
  ] as const;
  const deltas = stages.map((s) => {
    const a = pre[s.key];
    const b = post[s.key];
    const d = a != null && b != null ? a - b : 0;
    const pctv = a != null && a !== 0 ? (d / a) * 100 : 0;
    return { label: s.label, d, pctv };
  });
  const top = [...deltas].sort((x, y) => y.d - x.d)[0];
  const othersMoved = deltas.some(
    (o) => o.label !== top.label && Math.abs(o.d) >= 1,
  );
  return `Automation primarily affected the ${top.label} stage, reducing time by ${top.d.toFixed(
    1,
  )} days (${top.pctv.toFixed(1)}%). Other stages were ${
    othersMoved ? "also affected" : "largely unchanged"
  }.`;
}

function quadrantCallout(
  data: Record<KraljicQuadrant, QuadrantCycleStats | null>,
): string {
  const entries = QUAD_ORDER.map((q) => ({ q, s: data[q] })).filter(
    (e): e is { q: KraljicQuadrant; s: QuadrantCycleStats } =>
      e.s != null && e.s.delta != null,
  );
  if (!entries.length)
    return "Insufficient pre/post data to compare automation impact by quadrant.";
  const sorted = [...entries].sort((a, b) => b.s.delta! - a.s.delta!);
  const top = sorted[0];
  const deltas = entries.map((e) => e.s.delta!);
  const concentrated = Math.max(...deltas) - Math.min(...deltas) > 2;
  // Only warn about remaining friction if the slowest quadrant is genuinely
  // slow post-automation (>8 days; pre-automation averaged ~18 days).
  const withPost = entries.filter((e) => e.s.post_mean != null);
  const slowest = withPost.length
    ? [...withPost].sort((a, b) => b.s.post_mean! - a.s.post_mean!)[0]
    : null;
  const frictionNote =
    slowest && slowest.s.post_mean! > 8
      ? ` The ${slowest.q} quadrant still averages ${slowest.s.post_mean!.toFixed(
          1,
        )} days post-automation, suggesting remaining process friction.`
      : "";
  return `Automation benefits were ${
    concentrated
      ? `concentrated in the ${top.q} quadrant (${top.s.delta!.toFixed(1)}-day reduction)`
      : "fairly evenly distributed across quadrants"
  }.${frictionNote}`;
}

function complianceCallout(
  data: Record<KraljicQuadrant, ThreeWayMatchStats>,
): string {
  const entries = QUAD_ORDER.map((q) => ({ q, ...data[q] })).filter(
    (e) => e.n_pos > 0,
  );
  if (!entries.length) return "";
  const top = [...entries].sort((a, b) => b.fail_rate_pct - a.fail_rate_pct)[0];
  return `Process compliance issues concentrate in the ${top.q} quadrant (${top.fail_rate_pct.toFixed(
    1,
  )}% 3-way match failure). Worth investigating workflow.`;
}

function formatP(p: number | null): string {
  if (p == null) return "—";
  if (p < 0.001) return p.toExponential(2);
  return p.toFixed(4);
}

function effectLabel(r: number | null): string {
  if (r == null) return "—";
  const a = Math.abs(r);
  if (a < 0.1) return "negligible";
  if (a < 0.3) return "small";
  if (a < 0.5) return "medium";
  return "large";
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function CycleTimeView({ hypothesis }: { hypothesis: HypothesisResult }) {
  const { pre_stats, post_stats } = hypothesis;

  if (hypothesis.insufficient_data) {
    const present = pre_stats.n > 0 ? pre_stats : post_stats;
    const era = pre_stats.n > 0 ? "pre-automation (2024)" : "post-automation (2025)";
    return (
      <>
        <Alert>
          <Info />
          <AlertTitle>Comparison needs both automation eras</AlertTitle>
          <AlertDescription>
            This period contains data from only one automation era. The pre/post
            automation comparison requires both 2024 (pre) and 2025 (post) data.
            Try selecting a range that spans both years.
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Invoice-to-payment ({era})</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Records" value={String(present.n)} />
            <StatCard
              label="Mean"
              value={present.mean != null ? `${present.mean.toFixed(1)} d` : "—"}
            />
            <StatCard
              label="Median"
              value={present.median != null ? `${present.median.toFixed(1)} d` : "—"}
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const preMean = pre_stats.mean ?? 0;
  const postMean = post_stats.mean ?? 0;
  const deltaDays = preMean - postMean; // positive = reduction
  const deltaPct = preMean ? (deltaDays / preMean) * 100 : 0;
  const significant = hypothesis.significant;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Mann-Whitney U test (non-parametric, two-sample). Tests whether
          automation reduced invoice-to-payment time. Significance threshold: α =
          0.05.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Pre-automation (2024)"
          value={`${preMean.toFixed(1)} days`}
          sub={`n = ${pre_stats.n}`}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Post-automation (2025)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{postMean.toFixed(1)} days</div>
            <div
              className={`text-sm ${deltaDays > 0 ? "text-green-600 dark:text-green-500" : "text-destructive"}`}
            >
              {deltaDays > 0 ? "▼" : "▲"} {Math.abs(deltaDays).toFixed(1)} days (
              {Math.abs(deltaPct).toFixed(1)}%) vs pre &middot; n = {post_stats.n}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="p-value" value={formatP(hypothesis.p_value)} sub="α = 0.05" />
        <StatCard
          label="Effect size (rank-biserial)"
          value={hypothesis.effect_size != null ? hypothesis.effect_size.toFixed(3) : "—"}
          sub={effectLabel(hypothesis.effect_size)}
        />
        <StatCard
          label="95% CI (mean difference)"
          value={
            hypothesis.ci_low != null && hypothesis.ci_high != null
              ? `(${hypothesis.ci_low.toFixed(1)}, ${hypothesis.ci_high.toFixed(1)}) d`
              : "—"
          }
        />
      </div>

      {significant ? (
        <Alert className="border-green-600/40 text-green-700 dark:text-green-500 [&>svg]:text-green-600">
          <CheckCircle2 />
          <AlertTitle>Statistically significant reduction in cycle time</AlertTitle>
          <AlertDescription>
            Invoice-to-payment time fell by {deltaDays.toFixed(1)} days (p ={" "}
            {formatP(hypothesis.p_value)}).
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No significant difference detected</AlertTitle>
          <AlertDescription>
            The pre/post difference is not statistically significant at α = 0.05 (p
            = {formatP(hypothesis.p_value)}).
          </AlertDescription>
        </Alert>
      )}

      {hypothesis.stage_breakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Where Is Time Spent?</CardTitle>
            <CardDescription>
              Mean days per procure-to-pay stage, pre vs post automation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StageBreakdownChart
              pre={hypothesis.stage_breakdown.pre}
              post={hypothesis.stage_breakdown.post}
            />
            <p className="mt-3 text-sm text-muted-foreground">
              {stageCallout(
                hypothesis.stage_breakdown.pre,
                hypothesis.stage_breakdown.post,
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {hypothesis.cycle_by_quadrant && (
        <Card>
          <CardHeader>
            <CardTitle>Automation Impact by Supplier Type</CardTitle>
            <CardDescription>
              Mean invoice-to-payment time per Kraljic quadrant, pre vs post.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CycleByQuadrantChart data={hypothesis.cycle_by_quadrant} />
            <p className="mt-3 text-sm text-muted-foreground">
              {quadrantCallout(hypothesis.cycle_by_quadrant)}
            </p>
          </CardContent>
        </Card>
      )}

      {hypothesis.three_way_match_by_quadrant && (
        <Card>
          <CardHeader>
            <CardTitle>Process Compliance by Supplier Type</CardTitle>
            <CardDescription>
              Share of POs that failed the 3-way match, by Kraljic quadrant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quadrant</TableHead>
                  <TableHead className="text-right">Fail Rate</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {QUAD_ORDER.map((q) => ({
                  q,
                  ...hypothesis.three_way_match_by_quadrant![q],
                }))
                  .sort((a, b) => b.fail_rate_pct - a.fail_rate_pct)
                  .map((row, i) => {
                    // Relative highlight: only the worst quadrant (sorted first).
                    const high = i === 0;
                    return (
                      <TableRow key={row.q}>
                        <TableCell className="font-medium">{row.q}</TableCell>
                        <TableCell
                          className={`text-right ${high ? "font-semibold text-destructive" : ""}`}
                        >
                          {row.fail_rate_pct.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.n_pos}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">
              {complianceCallout(hypothesis.three_way_match_by_quadrant)}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Distribution (box plot)</CardTitle>
          </CardHeader>
          <CardContent>
            <CycleTimeBoxPlot data={hypothesis} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Distribution (histogram)</CardTitle>
          </CardHeader>
          <CardContent>
            <CycleTimeHistogram data={hypothesis} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly invoice-to-payment trend</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyCycleTrendChart data={hypothesis.monthly_trend} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Automation reduced average invoice-to-payment time from{" "}
        {preMean.toFixed(1)} days to {postMean.toFixed(1)} days — a{" "}
        {deltaDays.toFixed(1)}-day ({deltaPct.toFixed(1)}%) improvement. The
        Mann-Whitney U test{" "}
        {significant ? "confirms this is" : "does not find this"} statistically
        significant (p = {formatP(hypothesis.p_value)}, rank-biserial ={" "}
        {hypothesis.effect_size != null ? hypothesis.effect_size.toFixed(3) : "—"}).
      </p>
    </>
  );
}
