"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Recommendation } from "@/lib/analysis-types";
import { CATEGORY_COLOR_VAR, CATEGORY_NUDGE } from "@/lib/action-priorities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

function ActionBadge({ color, action }: { color: string; action: string }) {
  // Tinted chip (theme-aware, no hardcoded hex) — mirrors the app's ranking chips.
  return (
    <Badge
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        borderColor: "transparent",
      }}
      className="uppercase tracking-wide"
    >
      {action}
    </Badge>
  );
}

function Metric({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className={big ? "text-lg font-semibold" : "text-sm font-medium"}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Within-category priority bar (rank 1 = full; scaled down by rank). */
function PriorityBar({ rank, size, color }: { rank: number; size: number; color: string }) {
  const pct = size > 0 ? ((size - rank + 1) / size) * 100 : 0;
  return (
    <div className="min-w-[96px]">
      <div className="mb-0.5 text-xs text-muted-foreground">
        Priority {rank} of {size}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/** Deep-link (supplier → Classification detail) or plain nav (concentration
 *  category → Spend Overview); null when the card isn't clickable. */
function drillHref(r: Recommendation): string | null {
  if (r.supplier_id) return `/supplier-classification?supplier=${encodeURIComponent(r.supplier_id)}`;
  if (r.type === "concentration" && r.concentration_kind === "category") return "/spend-overview";
  return null;
}

export function ActionRecommendationCard({
  recommendation: r,
  categorySize,
}: {
  recommendation: Recommendation;
  /** total items in this recommendation's category (the "M" in Priority N of M). */
  categorySize: number;
}) {
  const color = CATEGORY_COLOR_VAR[r.type];

  // Title + subtitle adapt to the recommendation type.
  let title = r.supplier_name ?? "Process";
  let subtitle: string | null = null;
  if (r.type === "critical_issues_engagement") {
    subtitle = r.kraljic_quadrant ? `${r.kraljic_quadrant} quadrant` : null;
  } else if (r.type === "bottleneck_risk") {
    subtitle = r.country ? `Country: ${r.country}` : null;
  } else if (r.type === "process_improvement") {
    title = r.scope ?? "Process improvement";
  } else if (r.type === "concentration") {
    title =
      r.concentration_kind === "category"
        ? (r.category ?? "Category concentration")
        : (r.supplier_name ?? "Supplier concentration");
    subtitle = r.concentration_kind === "category" ? "Spend category" : "Single supplier";
  }

  // Footer metrics adapt to type.
  const metrics: { label: string; value: string; big?: boolean }[] = [];
  if (r.type === "concentration") {
    if (r.share_pct != null)
      metrics.push({ label: "Share of spend", value: `${r.share_pct.toFixed(0)}%`, big: true });
    if (r.total_spend_usd != null) metrics.push({ label: "Spend", value: usd(r.total_spend_usd) });
  } else if (r.type === "critical_issues_engagement") {
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
    if (r.total_spend_usd != null) metrics.push({ label: "Spend", value: usd(r.total_spend_usd) });
  }

  const href = drillHref(r);

  const inner = (
    <CardContent className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ActionBadge color={color} action={r.action} />
        <span className="font-semibold">{title}</span>
        {href && (
          <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      <p className="text-sm text-muted-foreground">{r.reasoning}</p>
      <p className="text-xs italic text-muted-foreground">{CATEGORY_NUDGE[r.type]}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-6">
          {metrics.map((m) => (
            <Metric key={m.label} {...m} />
          ))}
        </div>
        {r.priority_rank != null && (
          <PriorityBar rank={r.priority_rank} size={categorySize} color={color} />
        )}
      </div>
    </CardContent>
  );

  if (href) {
    return (
      <Link href={href} className="group block">
        <Card className="transition-colors hover:bg-muted/40">{inner}</Card>
      </Link>
    );
  }
  return <Card>{inner}</Card>;
}
