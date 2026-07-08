"use client";

import { useState } from "react";
import { TriangleAlert, ShieldAlert, Gem, Settings, Layers, Zap } from "lucide-react";
import type {
  RecommendationsResult,
  RecommendationCategory,
  Recommendation,
} from "@/lib/analysis-types";
import {
  CATEGORY_ORDER,
  CATEGORY_LABEL,
  CATEGORY_COLOR_VAR,
  CATEGORY_WHY,
} from "@/lib/action-priorities";
import { ActionRecommendationCard } from "@/components/ActionRecommendationCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CATEGORY_ICON: Record<
  RecommendationCategory,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  critical_issues_engagement: TriangleAlert,
  bottleneck_risk: ShieldAlert,
  hidden_gems_promotion: Gem,
  process_improvement: Settings,
  concentration: Layers,
};

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const intFmt = new Intl.NumberFormat("en-US");

function sortKey(r: Recommendation): string {
  return (r.supplier_name ?? r.category ?? r.scope ?? "").toLowerCase();
}

export function ActionDashboardView({ data }: { data: RecommendationsResult }) {
  const { recommendations, summary_stats } = data;
  const narrative = summary_stats.narrative;
  const presentCats = CATEGORY_ORDER.filter(
    (c) => (summary_stats.by_category[c] ?? 0) > 0,
  );

  const [active, setActive] = useState<Set<RecommendationCategory>>(new Set(presentCats));
  const [sortMode, setSortMode] = useState<"priority" | "alpha">("priority");

  const toggle = (c: RecommendationCategory) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <>
      {/* Narrative frame */}
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          {narrative && (
            <p className="leading-relaxed text-muted-foreground">
              Across{" "}
              <span className="font-medium text-foreground">
                {intFmt.format(narrative.n_suppliers)} suppliers
              </span>{" "}
              and{" "}
              <span className="font-medium text-foreground">
                {usdCompact.format(narrative.total_spend)}
              </span>{" "}
              of spend, this page surfaces the situations most worth a closer look — drawn
              from the four analyses. It flags <span className="font-medium">where</span>{" "}
              attention is likely to pay off; the call on{" "}
              <span className="font-medium">what</span> to do stays with you.
            </p>
          )}
          {narrative && (
            <p className="leading-relaxed">
              <span className="font-semibold">
                {narrative.top10_in_attention} of your top-10 suppliers by spend
              </span>{" "}
              appear in an attention bucket
              {narrative.top_category_name && (
                <>
                  {" "}
                  — and{" "}
                  <span className="font-semibold">
                    {narrative.top_category_share_pct.toFixed(0)}% of spend sits in{" "}
                    {narrative.top_category_name}
                  </span>
                  , the largest structural exposure in the portfolio
                </>
              )}
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* Count strip — 5 categories */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" /> {summary_stats.total_recommendations} situations
            flagged across 5 categories
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {CATEGORY_ORDER.map((c) => {
              const Icon = CATEGORY_ICON[c];
              return (
                <div
                  key={c}
                  className="rounded-md border p-3"
                  style={{ borderLeft: `3px solid ${CATEGORY_COLOR_VAR[c]}` }}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" /> {CATEGORY_LABEL[c]}
                  </div>
                  <div className="mt-1 text-2xl font-semibold">
                    {summary_stats.by_category[c] ?? 0}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {presentCats.map((c) => {
          const on = active.has(c);
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                on ? "text-foreground" : "text-muted-foreground opacity-60 hover:opacity-100",
              )}
              style={on ? { borderColor: CATEGORY_COLOR_VAR[c] } : undefined}
            >
              {CATEGORY_LABEL[c]} ({summary_stats.by_category[c] ?? 0})
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Sort:</span>
          {(["priority", "alpha"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={cn(
                "rounded-md border px-2 py-1",
                sortMode === mode ? "bg-accent font-medium" : "text-muted-foreground",
              )}
            >
              {mode === "priority" ? "Priority" : "A–Z"}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped sections */}
      {presentCats
        .filter((c) => active.has(c))
        .map((c) => {
          const Icon = CATEGORY_ICON[c];
          const size = summary_stats.by_category[c] ?? 0;
          let items = recommendations.filter((r) => r.type === c);
          items = [...items].sort((a, b) =>
            sortMode === "alpha"
              ? sortKey(a).localeCompare(sortKey(b))
              : (a.priority_rank ?? 999) - (b.priority_rank ?? 999),
          );
          return (
            <section
              key={c}
              className="flex flex-col gap-2 rounded-lg border-l-4 pl-4"
              style={{ borderColor: CATEGORY_COLOR_VAR[c] }}
            >
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Icon className="h-5 w-5" style={{ color: CATEGORY_COLOR_VAR[c] }} />
                {CATEGORY_LABEL[c]}
                <span className="text-sm font-normal text-muted-foreground">({size})</span>
              </h2>
              <p className="text-sm text-muted-foreground">{CATEGORY_WHY[c]}</p>
              <p className="text-xs text-muted-foreground/80">
                Ranked by priority within this category — not compared across categories.
              </p>
              <div className="mt-1 flex flex-col gap-3">
                {items.map((r, i) => (
                  <ActionRecommendationCard
                    key={`${r.type}-${r.supplier_id ?? r.category ?? r.scope ?? i}`}
                    recommendation={r}
                    categorySize={size}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </>
  );
}
