"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import type {
  RecommendationsResult,
  RecommendationsNarrative,
  RecommendationCategory,
  RecommendationAction,
  Recommendation,
  CycleTimeResult,
} from "@/lib/analysis-types";
import {
  ACTION_GROUPS,
  CATEGORY_LABEL,
  CATEGORY_COLOR_VAR,
  CATEGORY_NUDGE,
} from "@/lib/action-priorities";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ---- stable en-US formatters (hydration-safe) ----------------------------- //
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const intFmt = new Intl.NumberFormat("en-US");

// ---- drill-through (preserved from the old card) -------------------------- //
function drillHref(r: Recommendation): string | null {
  if (r.supplier_id)
    return `/supplier-classification?supplier=${encodeURIComponent(r.supplier_id)}`;
  if (r.type === "concentration" && r.concentration_kind === "category")
    return "/spend-overview";
  return null;
}

/** The single advice string for a category = its shared nudge, minus the
 *  "Suggested: " prefix (the verb is shown separately as a small-caps chip). */
function adviceText(type: RecommendationCategory): string {
  return CATEGORY_NUDGE[type].replace(/^Suggested:\s*/i, "").replace(/\.$/, "");
}

// ---- computed-finding lines (guarded; old cached rows degrade) ------------ //
function spendFinding(n: RecommendationsNarrative): string {
  const parts: string[] = [];
  if (n.top_category_name)
    parts.push(`${Math.round(n.top_category_share_pct)}% of spend in ${n.top_category_name}`);
  if (n.a_items_count != null && n.a_items_count > 0)
    parts.push(`${n.a_items_count} A-tier supplier${n.a_items_count === 1 ? "" : "s"} concentrate the vital few`);
  return parts.length ? `${parts.join("; ")}.` : "Spend is spread fairly evenly.";
}
function processFinding(n: RecommendationsNarrative): string {
  if (n.slowest_stage_name && n.slowest_stage_avg_days != null)
    return `${n.slowest_stage_name} is the slowest internal stage, averaging ${n.slowest_stage_avg_days.toFixed(1)} days.`;
  return "No internal stage clears the 8-day flag — the cycle is balanced.";
}

// ---- tile shell ----------------------------------------------------------- //
function Tile({
  label,
  color,
  count,
  wide,
  children,
  advice,
}: {
  label: string;
  color: string;
  count?: number;
  wide?: boolean;
  children: React.ReactNode;
  advice?: { verb: string; text: string };
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-lg border bg-card p-3",
        wide && "sm:col-span-2 lg:col-span-2",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color }}>
          {label}
        </span>
        {count != null && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      <div className="flex-1">{children}</div>
      {advice && (
        <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          <span
            className="mr-1.5 font-semibold uppercase tracking-wide"
            style={{ color }}
          >
            {advice.verb}
          </span>
          {advice.text}
        </div>
      )}
    </div>
  );
}

// ---- list tile (top-few + "+N more" inline expand, drill-through rows) ----- //
type ListRow = {
  href: string | null;
  rank?: number;
  name: string;
  context?: string;
  main: string;
  sub?: string;
};

function ListTile({
  label,
  color,
  rows,
  advice,
  wide,
  initial = 4,
}: {
  label: string;
  color: string;
  rows: ListRow[];
  advice?: { verb: string; text: string };
  wide?: boolean;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, initial);
  const extra = rows.length - initial;

  return (
    <Tile label={label} color={color} count={rows.length} wide={wide} advice={advice}>
      <ul className="flex flex-col">
        {shown.map((row, i) => {
          const body = (
            <>
              <span className="flex min-w-0 items-baseline gap-1.5">
                {row.rank != null && (
                  <span className="font-mono text-xs text-muted-foreground">{row.rank}</span>
                )}
                <span className="truncate font-medium">{row.name}</span>
                {row.context && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {row.context}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="font-mono tabular-nums">{row.main}</span>
                {row.sub && (
                  <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                    {row.sub}
                  </span>
                )}
                {row.href && (
                  <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </span>
            </>
          );
          const rowClass =
            "flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm";
          return row.href ? (
            <li key={i}>
              <Link href={row.href} className={cn("group", rowClass, "hover:bg-muted/60")}>
                {body}
              </Link>
            </li>
          ) : (
            <li key={i} className={rowClass}>
              {body}
            </li>
          );
        })}
      </ul>
      {extra > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
          />
          {expanded ? "Show less" : `+${extra} more`}
        </button>
      )}
    </Tile>
  );
}

// ---- stat tile ------------------------------------------------------------ //
function StatTile({
  label,
  color,
  value,
  caption,
  advice,
}: {
  label: string;
  color: string;
  value: string;
  caption: React.ReactNode;
  advice?: { verb: string; text: string };
}) {
  return (
    <Tile label={label} color={color} advice={advice}>
      <div className="flex flex-col justify-center">
        <div className="text-[29px] font-semibold leading-none tabular-nums">{value}</div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{caption}</p>
      </div>
    </Tile>
  );
}

// ---- donut tile (concentration) ------------------------------------------- //
function DonutTile({
  label,
  color,
  sharePct,
  categoryName,
  spendUsd,
  href,
  note,
  advice,
}: {
  label: string;
  color: string;
  sharePct: number;
  categoryName: string;
  spendUsd: number | null;
  href: string | null;
  note?: string;
  advice?: { verb: string; text: string };
}) {
  const size = 84;
  const stroke = 9;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(1, sharePct / 100)) * c;
  const donut = (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="color-mix(in srgb, var(--foreground) 12%, transparent)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--foreground)"
          className="text-sm font-semibold"
        >
          {Math.round(sharePct)}%
        </text>
      </svg>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{categoryName}</div>
        {spendUsd != null && (
          <div className="font-mono text-xs text-muted-foreground">{usd(spendUsd)}</div>
        )}
        {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
  return (
    <Tile label={label} color={color} advice={advice}>
      {href ? (
        <Link href={href} className="group block rounded hover:bg-muted/40">
          {donut}
        </Link>
      ) : (
        donut
      )}
    </Tile>
  );
}

// ---- P2P stage bar tile --------------------------------------------------- //
type StageBar = { label: string; mean: number; state: "slowest" | "flagged" | "normal" };

function barColor(state: StageBar["state"], color: string): string {
  if (state === "slowest") return color;
  if (state === "flagged") return `color-mix(in srgb, ${color} 55%, transparent)`;
  return "color-mix(in srgb, var(--foreground) 22%, transparent)";
}

function BarTile({
  label,
  color,
  stages,
  caption,
  advice,
}: {
  label: string;
  color: string;
  stages: StageBar[];
  caption: string;
  advice?: { verb: string; text: string };
}) {
  const domain = Math.max(8, ...stages.map((s) => s.mean)) * 1.1;
  const flagX = (8 / domain) * 100;
  return (
    <Tile label={label} color={color} wide advice={advice}>
      <div className="flex flex-col gap-2">
        {stages.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-muted-foreground">{s.label}</span>
            <div className="relative h-3.5 flex-1 rounded bg-muted/40">
              <div
                className="h-3.5 rounded"
                style={{ width: `${(s.mean / domain) * 100}%`, backgroundColor: barColor(s.state, color) }}
              />
              <div
                className="absolute inset-y-0 border-l border-dashed"
                style={{ left: `${flagX}%`, borderColor: "var(--warning)" }}
                aria-hidden
              />
            </div>
            <span className="w-11 shrink-0 text-right font-mono tabular-nums">
              {s.mean.toFixed(1)}d
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="inline-block h-2 w-3 border-l border-dashed align-middle"
          style={{ borderColor: "var(--warning)" }}
          aria-hidden
        />
        8-day flag · {caption}
      </p>
    </Tile>
  );
}

// ---- row builders per category (presentation of the same recs) ------------ //
function criticalSpendRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    href: drillHref(r),
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    context: r.abc_class ? `${r.abc_class}` : undefined,
    main: r.total_spend_usd != null ? usd(r.total_spend_usd) : "—",
    sub: r.share_pct != null ? `${r.share_pct.toFixed(1)}%` : undefined,
  }));
}
function engageRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    href: drillHref(r),
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    context: r.kraljic_quadrant ?? undefined,
    main: r.total_spend_usd != null ? usd(r.total_spend_usd) : "—",
    sub: r.performance_score != null ? r.performance_score.toFixed(0) : undefined,
  }));
}
function promoteRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    href: drillHref(r),
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    main: r.performance_score != null ? r.performance_score.toFixed(0) : "—",
    sub: r.total_spend_usd != null ? usd(r.total_spend_usd) : undefined,
  }));
}
function mitigateRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    href: drillHref(r),
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    context: r.country ?? undefined,
    main: r.supply_risk_score != null ? r.supply_risk_score.toFixed(0) : "—",
    sub: r.total_spend_usd != null ? usd(r.total_spend_usd) : undefined,
  }));
}

function verbFor(items: Recommendation[], fallback: RecommendationAction): string {
  return (items[0]?.action ?? fallback).toUpperCase();
}

export function ActionDashboardView({
  data,
  cycleTime,
}: {
  data: RecommendationsResult;
  cycleTime?: CycleTimeResult | null;
}) {
  const { recommendations, summary_stats } = data;
  const narrative = summary_stats.narrative;
  const byCat = summary_stats.by_category;
  const of = (t: RecommendationCategory) => recommendations.filter((r) => r.type === t);

  const findings: Record<ActionGroupId, string | null> = {
    spend: narrative ? spendFinding(narrative) : null,
    suppliers: narrative
      ? `${narrative.top10_in_attention} of your top-10 suppliers by spend need attention.`
      : null,
    process: narrative ? processFinding(narrative) : null,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Intro */}
      {narrative && (
        <div className="space-y-1">
          <div className="font-mono text-xs text-muted-foreground">
            {intFmt.format(narrative.n_suppliers)} suppliers · {usd(narrative.total_spend)}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Pulling together what the Spend, Supplier, and Process analyses each surfaced.
            This page flags <span className="font-medium text-foreground">where</span> to
            focus; the <span className="font-medium text-foreground">what</span> to do stays
            with you.
          </p>
        </div>
      )}

      {ACTION_GROUPS.map((group) => {
        const groupCount = group.categories.reduce((n, c) => n + (byCat[c] ?? 0), 0);
        const finding = findings[group.id];
        return (
          <section key={group.id} className="flex flex-col gap-2">
            {/* Band header */}
            <div
              className="flex items-center gap-2 rounded-md px-3 py-1.5"
              style={{ backgroundColor: `color-mix(in srgb, ${group.colorVar} 10%, transparent)` }}
            >
              <span className="text-sm font-semibold" style={{ color: group.colorVar }}>
                {group.title}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                — {group.tagline}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {groupCount} flagged
              </span>
            </div>
            {finding && <p className="px-3 text-xs text-muted-foreground">{finding}</p>}

            {/* Tile grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.id === "spend" && (
                <SpendBand
                  concentration={of("concentration")}
                  critical={of("critical_spend")}
                  tail={of("tail_spend")}
                  narrative={narrative}
                />
              )}
              {group.id === "suppliers" && (
                <SuppliersBand
                  engage={of("critical_issues_engagement")}
                  promote={of("hidden_gems_promotion")}
                  mitigate={of("bottleneck_risk")}
                />
              )}
              {group.id === "process" && (
                <ProcessBand
                  improve={of("process_improvement")}
                  slow={of("slow_stage")}
                  cycleTime={cycleTime}
                />
              )}
            </div>
          </section>
        );
      })}

      {/* Nothing flagged at all */}
      {recommendations.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No priorities flagged for this period.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type ActionGroupId = (typeof ACTION_GROUPS)[number]["id"];

// ---- Spend band ----------------------------------------------------------- //
function SpendBand({
  concentration,
  critical,
  tail,
  narrative,
}: {
  concentration: Recommendation[];
  critical: Recommendation[];
  tail: Recommendation[];
  narrative?: RecommendationsNarrative;
}) {
  // Concentration donut: the flagged category if any, else the largest category
  // (informational) from the narrative so the finding still surfaces.
  const top = concentration[0];
  const donut = top
    ? {
        sharePct: top.share_pct ?? 0,
        categoryName: top.category ?? "Top category",
        spendUsd: top.total_spend_usd ?? null,
        href: drillHref(top),
        note:
          concentration.length > 1
            ? `+${concentration.length - 1} more over 30%`
            : undefined,
        advice: { verb: verbFor(concentration, "diversify"), text: adviceText("concentration") },
      }
    : narrative && narrative.top_category_name
      ? {
          sharePct: narrative.top_category_share_pct,
          categoryName: narrative.top_category_name,
          spendUsd: null,
          href: "/spend-overview",
          note: "No single category exceeds 30% — diversified.",
          advice: undefined,
        }
      : null;

  const t = tail[0];
  return (
    <>
      {donut ? (
        <DonutTile label={CATEGORY_LABEL.concentration} color={CATEGORY_COLOR_VAR.concentration} {...donut} />
      ) : (
        <Tile label={CATEGORY_LABEL.concentration} color={CATEGORY_COLOR_VAR.concentration}>
          <p className="text-xs text-muted-foreground">No category concentration.</p>
        </Tile>
      )}

      {critical.length > 0 ? (
        <ListTile
          label={CATEGORY_LABEL.critical_spend}
          color={CATEGORY_COLOR_VAR.critical_spend}
          rows={criticalSpendRows(critical)}
          advice={{ verb: verbFor(critical, "steward"), text: adviceText("critical_spend") }}
        />
      ) : (
        <Tile label={CATEGORY_LABEL.critical_spend} color={CATEGORY_COLOR_VAR.critical_spend}>
          <p className="text-xs text-muted-foreground">No A-tier suppliers.</p>
        </Tile>
      )}

      {t ? (
        <StatTile
          label={CATEGORY_LABEL.tail_spend}
          color={CATEGORY_COLOR_VAR.tail_spend}
          value={intFmt.format(t.tail_supplier_count ?? 0)}
          caption={
            <>
              suppliers under 1% of spend —{" "}
              <span className="font-medium text-foreground">
                {(t.tail_spend_share_pct ?? 0).toFixed(0)}%
              </span>{" "}
              of spend,{" "}
              <span className="font-medium text-foreground">
                {(t.tail_supplier_pct ?? 0).toFixed(0)}%
              </span>{" "}
              of the roster.
            </>
          }
          advice={{ verb: verbFor(tail, "consolidate"), text: adviceText("tail_spend") }}
        />
      ) : (
        <Tile label={CATEGORY_LABEL.tail_spend} color={CATEGORY_COLOR_VAR.tail_spend}>
          <p className="text-xs text-muted-foreground">No long tail.</p>
        </Tile>
      )}
    </>
  );
}

// ---- Suppliers band ------------------------------------------------------- //
function SuppliersBand({
  engage,
  promote,
  mitigate,
}: {
  engage: Recommendation[];
  promote: Recommendation[];
  mitigate: Recommendation[];
}) {
  return (
    <>
      <ListTile
        label={CATEGORY_LABEL.critical_issues_engagement}
        color={CATEGORY_COLOR_VAR.critical_issues_engagement}
        rows={engageRows(engage)}
        advice={{ verb: verbFor(engage, "engage"), text: adviceText("critical_issues_engagement") }}
      />
      <ListTile
        label={CATEGORY_LABEL.hidden_gems_promotion}
        color={CATEGORY_COLOR_VAR.hidden_gems_promotion}
        rows={promoteRows(promote)}
        advice={{ verb: verbFor(promote, "promote"), text: adviceText("hidden_gems_promotion") }}
      />
      <ListTile
        label={CATEGORY_LABEL.bottleneck_risk}
        color={CATEGORY_COLOR_VAR.bottleneck_risk}
        rows={mitigateRows(mitigate)}
        advice={{ verb: verbFor(mitigate, "mitigate"), text: adviceText("bottleneck_risk") }}
      />
    </>
  );
}

// ---- Process band --------------------------------------------------------- //
function ProcessBand({
  improve,
  slow,
  cycleTime,
}: {
  improve: Recommendation[];
  slow: Recommendation[];
  cycleTime?: CycleTimeResult | null;
}) {
  // P2P bars from the cycle_time stage breakdown (all 3 internal stages).
  // PO->Delivery is physical lead time and excluded (consistent with compute).
  const sb = cycleTime?.stage_breakdown;
  const internal: { key: keyof NonNullable<typeof sb>; label: string }[] = [
    { key: "pr_to_po", label: "PR to PO" },
    { key: "delivery_to_invoice", label: "Delivery to Invoice" },
    { key: "invoice_to_payment", label: "Invoice to Payment" },
  ];
  let barTile: React.ReactNode = null;
  if (sb) {
    const means = internal.map((s) => ({ label: s.label, mean: sb[s.key]?.mean ?? 0 }));
    const allFourSum =
      (sb.pr_to_po?.mean ?? 0) +
      (sb.po_to_delivery?.mean ?? 0) +
      (sb.delivery_to_invoice?.mean ?? 0) +
      (sb.invoice_to_payment?.mean ?? 0);
    const flagged = means.filter((m) => m.mean > 8);
    const slowest = flagged.length
      ? flagged.reduce((a, b) => (b.mean > a.mean ? b : a))
      : null;
    const stages: StageBar[] = means.map((m) => ({
      label: m.label,
      mean: m.mean,
      state:
        slowest && m.label === slowest.label
          ? "slowest"
          : m.mean > 8
            ? "flagged"
            : "normal",
    }));
    const caption = slowest
      ? `${slowest.label} slowest at ${slowest.mean.toFixed(1)}d${
          allFourSum > 0 ? ` (${((slowest.mean / allFourSum) * 100).toFixed(0)}% of cycle)` : ""
        }.`
      : "All internal stages under the flag — balanced.";
    barTile = (
      <BarTile
        label="P2P stages"
        color={CATEGORY_COLOR_VAR.slow_stage}
        stages={stages}
        caption={caption}
        advice={slowest ? { verb: "STREAMLINE", text: adviceText("slow_stage") } : undefined}
      />
    );
  } else if (slow.length > 0) {
    // Degraded fallback: no cycle_time on the page, but flagged stages exist.
    const stages: StageBar[] = slow.map((r, i) => ({
      label: (r.scope ?? "Stage").replace(/^Stage:\s*/, ""),
      mean: r.avg_days ?? 0,
      state: i === 0 ? "slowest" : "flagged",
    }));
    barTile = (
      <BarTile
        label="P2P stages"
        color={CATEGORY_COLOR_VAR.slow_stage}
        stages={stages}
        caption={`${stages[0].label} is the slowest at ${stages[0].mean.toFixed(1)}d.`}
        advice={{ verb: "STREAMLINE", text: adviceText("slow_stage") }}
      />
    );
  } else {
    barTile = (
      <Tile label="P2P stages" color={CATEGORY_COLOR_VAR.slow_stage} wide>
        <p className="text-xs text-muted-foreground">Stage timing unavailable.</p>
      </Tile>
    );
  }

  // Match-compliance stat: process_improvement's impact_score IS the worst
  // quadrant's 3-way-match failure rate; scope carries the quadrant name.
  const imp = improve[0];
  const quadrant = imp?.scope
    ? imp.scope.replace(/^Quadrant:\s*/, "").replace(/\s*compliance$/i, "")
    : null;
  const matchTile = imp ? (
    <StatTile
      label={CATEGORY_LABEL.process_improvement}
      color={CATEGORY_COLOR_VAR.process_improvement}
      value={`${imp.impact_score.toFixed(1)}%`}
      caption={
        <>
          3-way match failures
          {quadrant ? (
            <>
              {" "}
              in the <span className="font-medium text-foreground">{quadrant}</span> quadrant
            </>
          ) : null}{" "}
          — the weakest compliance.
        </>
      }
      advice={{ verb: verbFor(improve, "improve"), text: adviceText("process_improvement") }}
    />
  ) : (
    <Tile label={CATEGORY_LABEL.process_improvement} color={CATEGORY_COLOR_VAR.process_improvement}>
      <p className="text-xs text-muted-foreground">No compliance gaps flagged.</p>
    </Tile>
  );

  return (
    <>
      {barTile}
      {matchTile}
    </>
  );
}
