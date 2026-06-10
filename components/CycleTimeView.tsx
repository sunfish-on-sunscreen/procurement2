"use client";

import { CheckCircle2, TriangleAlert, Info } from "lucide-react";
import type { HypothesisResult } from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CycleTimeBoxPlot } from "@/components/charts/CycleTimeBoxPlot";
import { CycleTimeHistogram } from "@/components/charts/CycleTimeHistogram";
import { MonthlyCycleTrendChart } from "@/components/charts/MonthlyCycleTrendChart";

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
