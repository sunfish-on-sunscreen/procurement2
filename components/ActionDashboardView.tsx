"use client";

import { useState } from "react";
import {
  TriangleAlert,
  ShieldAlert,
  Gem,
  Settings,
  Zap,
} from "lucide-react";
import type {
  RecommendationsResult,
  RecommendationCategory,
  Recommendation,
} from "@/lib/analysis-types";
import { ActionRecommendationCard } from "@/components/ActionRecommendationCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CatMeta = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: string;
};

// Display order: most urgent first.
const CATEGORY_ORDER: RecommendationCategory[] = [
  "critical_issues_engagement",
  "bottleneck_risk",
  "hidden_gems_promotion",
  "process_improvement",
];

const CATEGORY_META: Record<RecommendationCategory, CatMeta> = {
  critical_issues_engagement: {
    label: "Critical Issues Engagement",
    icon: TriangleAlert,
    color: "#ef4444",
  },
  bottleneck_risk: {
    label: "Bottleneck Risk Mitigation",
    icon: ShieldAlert,
    color: "#f97316",
  },
  hidden_gems_promotion: {
    label: "Hidden Gems Promotion",
    icon: Gem,
    color: "#10b981",
  },
  process_improvement: {
    label: "Process Improvement",
    icon: Settings,
    color: "#3b82f6",
  },
};

function sortKey(r: Recommendation): string {
  return (r.supplier_name ?? r.scope ?? "").toLowerCase();
}

export function ActionDashboardView({
  data,
}: {
  data: RecommendationsResult;
  period: string;
}) {
  const { recommendations, summary_stats } = data;
  const presentCats = CATEGORY_ORDER.filter(
    (c) => (summary_stats.by_category[c] ?? 0) > 0,
  );

  const [active, setActive] = useState<Set<RecommendationCategory>>(
    new Set(presentCats),
  );
  const [sortMode, setSortMode] = useState<"impact" | "alpha">("impact");

  const toggle = (c: RecommendationCategory) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const top = summary_stats.highest_impact;

  return (
    <>
      {/* Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" /> {summary_stats.total_recommendations}{" "}
            recommended actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {CATEGORY_ORDER.map((c) => {
              const meta = CATEGORY_META[c];
              const Icon = meta.icon;
              return (
                <div
                  key={c}
                  className="rounded-md border p-3"
                  style={{ borderLeft: `3px solid ${meta.color}` }}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" /> {meta.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold">
                    {summary_stats.by_category[c] ?? 0}
                  </div>
                </div>
              );
            })}
          </div>
          {top && (
            <div className="rounded-md border-l-4 border-primary bg-muted/50 p-3 text-sm">
              <span className="font-semibold">Highest-impact action: </span>
              <span className="uppercase">{top.action}</span>{" "}
              {top.supplier_name ?? top.scope}
              <span className="text-muted-foreground">
                {" "}
                — impact {top.impact_score.toFixed(0)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card>
        <CardHeader>
          <CardTitle>Methodology</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This dashboard synthesizes findings from the 4 underlying analyses
          into ranked, specific actions. Each recommendation includes the data
          backing and a suggested action. Items are ranked by impact score (a
          0–100 composite of spend exposure, risk magnitude, or process
          severity).
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {presentCats.map((c) => {
          const meta = CATEGORY_META[c];
          const on = active.has(c);
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                on
                  ? "text-foreground"
                  : "text-muted-foreground opacity-60 hover:opacity-100",
              )}
              style={on ? { borderColor: meta.color } : undefined}
            >
              {meta.label} ({summary_stats.by_category[c] ?? 0})
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Sort:</span>
          {(["impact", "alpha"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              className={cn(
                "rounded-md border px-2 py-1",
                sortMode === m
                  ? "bg-accent font-medium"
                  : "text-muted-foreground",
              )}
            >
              {m === "impact" ? "Impact" : "A–Z"}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped sections */}
      {presentCats
        .filter((c) => active.has(c))
        .map((c) => {
          const meta = CATEGORY_META[c];
          const Icon = meta.icon;
          let items = recommendations.filter((r) => r.type === c);
          if (sortMode === "alpha") {
            items = [...items].sort((a, b) =>
              sortKey(a).localeCompare(sortKey(b)),
            );
          }
          return (
            <section
              key={c}
              className="flex flex-col gap-3 rounded-lg border-l-4 pl-4"
              style={{ borderColor: meta.color }}
            >
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Icon className="h-5 w-5" style={{ color: meta.color }} />
                {meta.label}
                <span className="text-sm font-normal text-muted-foreground">
                  ({items.length})
                </span>
              </h2>
              <div className="flex flex-col gap-3">
                {items.map((r, i) => (
                  <ActionRecommendationCard
                    key={`${r.type}-${r.supplier_id ?? r.scope ?? i}`}
                    recommendation={r}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
