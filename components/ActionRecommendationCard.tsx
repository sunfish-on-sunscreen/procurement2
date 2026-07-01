"use client";

import type {
  Recommendation,
  RecommendationAction,
} from "@/lib/analysis-types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ACTION_COLORS: Record<RecommendationAction, string> = {
  engage: "#ef4444", // red — most urgent
  mitigate: "#f97316", // orange
  promote: "#10b981", // green
  improve: "#3b82f6", // blue
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

function ActionBadge({ action }: { action: RecommendationAction }) {
  return (
    <Badge
      style={{
        backgroundColor: ACTION_COLORS[action],
        color: "#fff",
        borderColor: "transparent",
      }}
      className="uppercase tracking-wide"
    >
      {action}
    </Badge>
  );
}

function Metric({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div>
      <div className={big ? "text-lg font-semibold" : "text-sm font-medium"}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ImpactBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="min-w-[80px]">
      <div className="mb-0.5 text-xs text-muted-foreground">
        Impact {score.toFixed(0)}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-foreground/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ActionRecommendationCard({
  recommendation: r,
}: {
  recommendation: Recommendation;
}) {
  // Title + subtitle adapt to the recommendation type.
  let title = r.supplier_name ?? "Process";
  let subtitle: string | null = null;
  if (r.type === "critical_issues_engagement") {
    subtitle = r.kraljic_quadrant ? `${r.kraljic_quadrant} quadrant` : null;
  } else if (r.type === "bottleneck_risk") {
    subtitle = r.country ? `Country: ${r.country}` : null;
  } else if (r.type === "process_improvement") {
    title = r.scope ?? "Process improvement";
  }

  // Footer metrics adapt to type.
  const metrics: { label: string; value: string; big?: boolean }[] = [];
  if (r.type === "critical_issues_engagement") {
    if (r.total_spend_usd != null)
      metrics.push({ label: "Spend exposure", value: usd(r.total_spend_usd), big: true });
    if (r.performance_score != null)
      metrics.push({ label: "Performance", value: r.performance_score.toFixed(1) });
  } else if (r.type === "hidden_gems_promotion") {
    if (r.performance_score != null)
      metrics.push({ label: "Performance", value: r.performance_score.toFixed(1), big: true });
    if (r.total_spend_usd != null)
      metrics.push({ label: "Current spend", value: usd(r.total_spend_usd) });
  } else if (r.type === "bottleneck_risk") {
    if (r.supply_risk_score != null)
      metrics.push({ label: "Supply risk", value: r.supply_risk_score.toFixed(1), big: true });
    if (r.total_spend_usd != null)
      metrics.push({ label: "Spend", value: usd(r.total_spend_usd) });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={r.action} />
          <span className="font-semibold">{title}</span>
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        )}
        <p className="text-sm text-muted-foreground">{r.reasoning}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            {metrics.map((m) => (
              <Metric key={m.label} {...m} />
            ))}
          </div>
          <ImpactBar score={r.impact_score} />
        </div>
      </CardContent>
    </Card>
  );
}
