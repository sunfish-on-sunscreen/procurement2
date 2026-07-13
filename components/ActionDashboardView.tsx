"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Lightbulb, TriangleAlert } from "lucide-react";
import type {
  RecommendationsResult,
  RecommendationsNarrative,
  RecommendationCategory,
  RecommendationAction,
  Recommendation,
  CycleTimeResult,
  PerformanceSpendResult,
  KraljicResult,
} from "@/lib/analysis-types";
import type {
  CycleBreakdown,
  CycleFlagKey,
  SupplierFlagState,
} from "@/lib/cycle-time-types";
import {
  ACTION_GROUPS,
  CATEGORY_LABEL,
  CATEGORY_COLOR_VAR,
  CATEGORY_NUDGE,
} from "@/lib/action-priorities";
import { deriveCycleFlags } from "@/lib/cycle-flags";
import {
  buildAnomalyHub,
  CLASSIFICATION_DISAGREEMENT_CUTOFF,
  type CrossAnomalyRow,
  type ClassificationAnomalyRow,
  type AnomalyFamily,
} from "@/lib/anomaly-crossref";
import {
  buildTemporalAnomalies,
  type TemporalLoad,
  type TemporalAnomalies,
  type TemporalAnomalyRow,
} from "@/lib/temporal-anomalies";
import { UnifiedSupplierDetailModal } from "@/components/UnifiedSupplierDetailModal";
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

/** The single advice string for a category = its shared nudge, minus the
 *  "Suggested: " prefix (the verb is shown separately as a small-caps chip). */
function adviceText(type: RecommendationCategory): string {
  return CATEGORY_NUDGE[type].replace(/^Suggested:\s*/i, "").replace(/\.$/, "");
}

// ---- insight text (interpretive takeaways from the existing narrative) ----- //
function synthesisHeadline(n: RecommendationsNarrative): string {
  const parts: string[] = [];
  if (n.top10_in_attention > 0)
    parts.push(`${n.top10_in_attention} of your top-10 suppliers by spend need attention`);
  if (n.top_category_name)
    parts.push(
      `${Math.round(n.top_category_share_pct)}% of spend sits in ${n.top_category_name} — the portfolio's largest structural exposure`,
    );
  if (parts.length === 0)
    return "The portfolio looks broadly balanced across spend, suppliers, and process this period.";
  return `${parts.join(", and ")}.`;
}
function spendInsight(n: RecommendationsNarrative): string {
  if (!n.top_category_name) return "Spend is spread fairly evenly across categories.";
  const s = Math.round(n.top_category_share_pct);
  return n.top_category_share_pct >= 50
    ? `Spend is heavily concentrated — ${n.top_category_name} alone is ${s}% of the total.`
    : `${n.top_category_name} is the largest category at ${s}% of spend.`;
}
function suppliersInsight(n: RecommendationsNarrative): string {
  return n.top10_in_attention > 0
    ? `${n.top10_in_attention} of the top-10 spenders need attention — high-spend suppliers underperforming or hard to replace.`
    : "None of the top-10 spenders are flagged for attention this period.";
}
function processInsight(n: RecommendationsNarrative): string {
  return n.slowest_stage_name && n.slowest_stage_avg_days != null
    ? `One internal stage — ${n.slowest_stage_name} — drives most of the cycle delay, averaging ${n.slowest_stage_avg_days.toFixed(1)} days.`
    : "Internal stages are balanced — none exceeds the 8-day flag.";
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

// ---- list tile (top-few + "+N more"; rows open the in-place supplier panel) - //
type ListRow = {
  supplierId: string | null;
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
  onSupplier,
  wide,
  initial = 4,
}: {
  label: string;
  color: string;
  rows: ListRow[];
  advice?: { verb: string; text: string };
  /** Present when supplier detail can open in-place; absent → rows non-clickable. */
  onSupplier?: (id: string) => void;
  wide?: boolean;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, initial);
  const extra = rows.length - initial;
  const rowClass = "flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm";

  return (
    <Tile label={label} color={color} count={rows.length} wide={wide} advice={advice}>
      <ul className="flex flex-col">
        {shown.map((row, i) => {
          const clickable = !!row.supplierId && !!onSupplier;
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
                {clickable && (
                  <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </span>
            </>
          );
          return clickable ? (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSupplier!(row.supplierId!)}
                className={cn("group w-full text-left", rowClass, "hover:bg-muted/60")}
              >
                {body}
              </button>
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

// ---- donut tile (concentration; keeps its /spend-overview link) ------------ //
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
    supplierId: r.supplier_id ?? null,
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    context: r.abc_class ? `${r.abc_class}` : undefined,
    main: r.total_spend_usd != null ? usd(r.total_spend_usd) : "—",
    sub: r.share_pct != null ? `${r.share_pct.toFixed(1)}%` : undefined,
  }));
}
function engageRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    supplierId: r.supplier_id ?? null,
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    context: r.kraljic_quadrant ?? undefined,
    main: r.total_spend_usd != null ? usd(r.total_spend_usd) : "—",
    sub: r.performance_score != null ? r.performance_score.toFixed(0) : undefined,
  }));
}
function promoteRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    supplierId: r.supplier_id ?? null,
    rank: r.priority_rank,
    name: r.supplier_name ?? "—",
    main: r.performance_score != null ? r.performance_score.toFixed(0) : "—",
    sub: r.total_spend_usd != null ? usd(r.total_spend_usd) : undefined,
  }));
}
function mitigateRows(items: Recommendation[]): ListRow[] {
  return items.map((r) => ({
    supplierId: r.supplier_id ?? null,
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

// ===========================================================================
// Anomaly exposure — the first cross-page "hub" section (Batch 1).
// Cross-references the three EXISTING process anomaly flags (from the shared
// deriveCycleFlags helper — identical to Process Health) against each flagged
// supplier's ABC / Kraljic / zone position, so the hub can weight a cycle
// problem by WHO it lands on. Self-fetches the breakdown roster (span-scoped);
// degrades to outlier-only if that fetch fails.
// ===========================================================================
type DetailTab = "classification" | "spend" | "process";

const ANOMALY_ACCENT = "var(--warning)"; // amber — marks the cross-cutting section

// Flag identity — mirrors Process Health's FLAG_META exactly (colour + label).
const ANOMALY_FLAG_META: Record<CycleFlagKey, { label: string; color: string }> = {
  has_outlier: { label: "Outlier", color: "var(--warning)" },
  inconsistent: { label: "Inconsistent", color: "var(--primary)" },
  has_stage_dom: { label: "Stage-dom", color: "var(--destructive)" },
};
const ANOMALY_FLAG_ORDER: CycleFlagKey[] = ["has_outlier", "inconsistent", "has_stage_dom"];

/** A coloured flag chip (dot + label — never colour alone). */
function FlagChip({ k }: { k: CycleFlagKey }) {
  const meta = ANOMALY_FLAG_META[k];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: meta.color,
        backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

/** A bordered position chip; `important` (A-tier / Strategic) gets the amber highlight. */
function PositionChip({ label, important }: { label: string; important?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px]",
        !important && "text-muted-foreground",
      )}
      style={
        important
          ? {
              color: ANOMALY_ACCENT,
              borderColor: ANOMALY_ACCENT,
              backgroundColor: `color-mix(in srgb, ${ANOMALY_ACCENT} 12%, transparent)`,
            }
          : { borderColor: "color-mix(in srgb, var(--foreground) 15%, transparent)" }
      }
    >
      {label}
    </span>
  );
}

const CLASS_ACCENT = "var(--zone-hidden-gems)"; // violet — the classification family
const TEMPORAL_ACCENT = "var(--temporal)"; // cyan — the changed-over-time family

const FAMILY_LABEL: Record<AnomalyFamily, string> = {
  process: "process",
  classification: "classification",
  temporal: "temporal",
};

/** The "also X + Y" text for a supplier — the OTHER families it's flagged in, or
 *  null when it's only in the current one. */
function compoundLabel(
  familiesBySupplier: Map<string, Set<AnomalyFamily>>,
  supplierId: string,
  current: AnomalyFamily,
): string | null {
  const fams = familiesBySupplier.get(supplierId);
  if (!fams) return null;
  const others = [...fams].filter((f) => f !== current);
  return others.length ? `also ${others.map((f) => FAMILY_LABEL[f]).join(" + ")}` : null;
}

/** A subtle badge marking a supplier flagged in more than one anomaly family. */
function CompoundBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border border-dashed px-1 py-0.5 text-[10px] text-muted-foreground"
      style={{ borderColor: "color-mix(in srgb, var(--foreground) 30%, transparent)" }}
      title="Flagged in more than one anomaly family"
    >
      ⧉ {label}
    </span>
  );
}

/** One flagged-supplier row: name + spend, then flag chips + position chips. */
function AnomalyRow({
  row,
  onSupplier,
  compoundText,
}: {
  row: CrossAnomalyRow;
  onSupplier?: (id: string) => void;
  /** "also X" badge text when flagged in other families; null/undefined = none. */
  compoundText?: string | null;
}) {
  const clickable = !!onSupplier;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{row.supplier_name}</span>
          {clickable && (
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {row.total_spend_usd != null ? usd(row.total_spend_usd) : "—"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {ANOMALY_FLAG_ORDER.filter((k) => row.flags[k]).map((k) => (
          <FlagChip key={k} k={k} />
        ))}
        <span className="mx-0.5 text-muted-foreground/40">·</span>
        {row.abc_class && (
          <PositionChip label={`Class ${row.abc_class}`} important={row.abc_class === "A"} />
        )}
        {row.kraljic_quadrant && (
          <PositionChip
            label={row.kraljic_quadrant}
            important={row.kraljic_quadrant === "Strategic"}
          />
        )}
        {row.zone && <PositionChip label={row.zone} />}
        {compoundText && <CompoundBadge label={compoundText} />}
      </div>
    </>
  );
  const cls = "block w-full rounded px-1.5 py-1.5 text-left";
  return clickable ? (
    <li>
      <button
        type="button"
        onClick={() => onSupplier!(row.supplier_id)}
        className={cn("group hover:bg-muted/60", cls)}
      >
        {body}
      </button>
    </li>
  ) : (
    <li className={cls}>{body}</li>
  );
}

// ---- Classification family: three-lens disagreement --------------------------- //
/** Three horizontal percentile bars (Spend / Performance / Supply-risk), distinct
 *  hues so the contradiction is visible at a glance. */
function LensBars({ s, p, r }: { s: number; p: number; r: number }) {
  const bars = [
    { label: "S", val: s, color: "var(--quadrant-routine)", title: "Spend percentile" },
    { label: "P", val: p, color: "var(--zone-stars)", title: "Performance percentile" },
    { label: "R", val: r, color: "var(--quadrant-strategic)", title: "Supply-risk percentile" },
  ];
  return (
    <div className="flex flex-col gap-1">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-1.5" title={`${b.title}: ${b.val}`}>
          <span className="w-2.5 shrink-0 font-mono text-[10px] text-muted-foreground">{b.label}</span>
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
          >
            <div className="h-full rounded-full" style={{ width: `${b.val}%`, backgroundColor: b.color }} />
          </div>
          <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {b.val}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One disagreement-ranking row: rank + name + spread, the 3 lens bars, the verdict,
 *  and position chips. Rows open the unified modal on the Classification tab. */
function ClassificationRow({
  row,
  rank,
  compoundText,
  onSupplier,
}: {
  row: ClassificationAnomalyRow;
  rank: number;
  compoundText?: string | null;
  onSupplier?: (id: string) => void;
}) {
  const clickable = !!onSupplier;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{rank}</span>
          <span className="truncate text-sm font-medium">{row.supplier_name}</span>
          {clickable && (
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
        <span className="shrink-0 text-xs">
          <span className="font-mono font-semibold tabular-nums" style={{ color: CLASS_ACCENT }}>
            {row.disagreement}
          </span>
          <span className="ml-1 text-muted-foreground">spread</span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="w-full shrink-0 sm:w-44">
          <LensBars s={row.spend_pct} p={row.performance_pct} r={row.risk_pct} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: CLASS_ACCENT }}>
            {row.verdict}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {row.abc_class && (
              <PositionChip label={`Class ${row.abc_class}`} important={row.abc_class === "A"} />
            )}
            {row.kraljic_quadrant && (
              <PositionChip
                label={row.kraljic_quadrant}
                important={row.kraljic_quadrant === "Strategic"}
              />
            )}
            {row.zone && <PositionChip label={row.zone} />}
            {compoundText && <CompoundBadge label={compoundText} />}
          </div>
        </div>
      </div>
    </>
  );
  const cls = "block w-full rounded px-1.5 py-1.5 text-left";
  return clickable ? (
    <li>
      <button
        type="button"
        onClick={() => onSupplier!(row.supplier_id)}
        className={cn("group hover:bg-muted/60", cls)}
      >
        {body}
      </button>
    </li>
  ) : (
    <li className={cls}>{body}</li>
  );
}

/** Light sub-block header inside the hub (a dot + label, not a full band — the hub
 *  header owns the band styling). */
function SubBlockHeader({
  accent,
  title,
  tagline,
  count,
}: {
  accent: string;
  title: string;
  tagline: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      <span className="text-sm font-semibold" style={{ color: accent }}>
        {title}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">— {tagline}</span>
      <span className="ml-auto font-mono text-xs text-muted-foreground">{count} flagged</span>
    </div>
  );
}

// ---- Process block (Batch 1's content, now a sub-block of the hub) ------------ //
function ProcessBlock({
  xref,
  degraded,
  familiesBySupplier,
  onSupplier,
}: {
  xref: ReturnType<typeof buildAnomalyHub>["process"];
  degraded: boolean;
  familiesBySupplier: Map<string, Set<AnomalyFamily>>;
  onSupplier?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { rows, flaggedCount, importantCount, importantSpend, flagMix } = xref;

  const head = (
    <SubBlockHeader
      accent={ANOMALY_ACCENT}
      title="Process anomalies"
      tagline="cycle execution, weighted by who it hits"
      count={flaggedCount}
    />
  );

  if (flaggedCount === 0) {
    return (
      <div className="flex flex-col gap-2">
        {head}
        <p className="px-3 text-xs text-muted-foreground">No cycle-time anomalies flagged this period.</p>
      </div>
    );
  }

  const synthesis =
    importantCount > 0
      ? `${importantCount} of ${flaggedCount} suppliers with cycle-time anomalies ${importantCount === 1 ? "is" : "are"} A-tier or Strategic — ${usd(importantSpend)} of spend. A process problem concentrated on your most important relationships.`
      : `None of the ${flaggedCount} suppliers with cycle-time anomalies are A-tier or Strategic — the anomalies sit on lower-spend, more replaceable suppliers. Lower urgency.`;

  const INITIAL = 4;
  const shown = expanded ? rows : rows.slice(0, INITIAL);
  const extra = rows.length - INITIAL;
  const flagMixLine = `Outlier ${flagMix.has_outlier} · Inconsistent ${flagMix.inconsistent} · Stage-dom ${flagMix.has_stage_dom}`;

  return (
    <div className="flex flex-col gap-2">
      {head}
      <p className="px-3 text-xs text-muted-foreground">{synthesis}</p>
      {degraded && (
        <p className="px-3 text-xs text-muted-foreground/80">
          Full breakdown unavailable — showing outlier flags only.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Exposure"
          color={ANOMALY_ACCENT}
          value={usd(importantSpend)}
          caption={
            <>
              {importantCount} of {flaggedCount} flagged suppliers are A-tier or Strategic
              <br />
              {flagMixLine}
            </>
          }
        />
        <Tile label="Flagged suppliers" color={ANOMALY_ACCENT} count={flaggedCount} wide>
          <ul className="flex flex-col">
            {shown.map((row) => (
              <AnomalyRow
                key={row.supplier_id}
                row={row}
                onSupplier={onSupplier}
                compoundText={compoundLabel(familiesBySupplier, row.supplier_id, "process")}
              />
            ))}
          </ul>
          {extra > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Show less" : `+${extra} more`}
            </button>
          )}
        </Tile>
      </div>
    </div>
  );
}

// ---- Classification block (Batch 2: cross-lens disagreement ranking) ---------- //
function ClassificationBlock({
  cls,
  familiesBySupplier,
  onSupplier,
}: {
  cls: ReturnType<typeof buildAnomalyHub>["classification"];
  familiesBySupplier: Map<string, Set<AnomalyFamily>>;
  onSupplier?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { rows, flaggedCount, rosterSize } = cls;

  const head = (
    <SubBlockHeader
      accent={CLASS_ACCENT}
      title="Classification anomalies"
      tagline="where your spend / performance / supply-risk lenses disagree"
      count={flaggedCount}
    />
  );

  if (flaggedCount === 0) {
    return (
      <div className="flex flex-col gap-2">
        {head}
        <p className="px-3 text-xs text-muted-foreground">
          No lens disagreements this period — spend, performance, and supply-risk broadly agree.
        </p>
      </div>
    );
  }

  const top = rows[0];
  const INITIAL = 4;
  const shown = expanded ? rows : rows.slice(0, INITIAL);
  const extra = rows.length - INITIAL;

  return (
    <div className="flex flex-col gap-2">
      {head}
      <p className="px-3 text-xs text-muted-foreground">
        {flaggedCount} of {rosterSize} suppliers rank ≥ {CLASSIFICATION_DISAGREEMENT_CUTOFF} points
        apart across the three lenses — the two matrices disagree about where they sit. Ranked by
        the size of the gap.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Widest gap"
          color={CLASS_ACCENT}
          value={String(top.disagreement)}
          caption={
            <>
              {top.supplier_name}: {top.verdict.toLowerCase()}
              <br />
              {flaggedCount} suppliers span ≥ {CLASSIFICATION_DISAGREEMENT_CUTOFF} across spend ·
              performance · supply-risk
            </>
          }
        />
        <Tile label="Disagreement ranking" color={CLASS_ACCENT} count={flaggedCount} wide>
          <ul className="flex flex-col gap-1">
            {shown.map((row, i) => (
              <ClassificationRow
                key={row.supplier_id}
                row={row}
                rank={i + 1}
                compoundText={compoundLabel(familiesBySupplier, row.supplier_id, "classification")}
                onSupplier={onSupplier}
              />
            ))}
          </ul>
          {extra > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Show less" : `+${extra} more`}
            </button>
          )}
        </Tile>
      </div>
    </div>
  );
}

// ---- Temporal block (Batch 3: changed-over-time, latest vs prior year) --------- //
/** A cyan change chip (quadrant move / spend Δ% / score Δpts). */
function TemporalChip({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: TEMPORAL_ACCENT,
        backgroundColor: `color-mix(in srgb, ${TEMPORAL_ACCENT} 14%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

/** One changed-over-time row: name + latest spend, the change chips, position chips.
 *  Rows open the unified modal on the Classification tab (where evolution lives). */
function TemporalRow({
  row,
  rank,
  compoundText,
  onSupplier,
}: {
  row: TemporalAnomalyRow;
  rank: number;
  compoundText?: string | null;
  onSupplier?: (id: string) => void;
}) {
  const clickable = !!onSupplier;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{rank}</span>
          <span className="truncate text-sm font-medium">{row.supplier_name}</span>
          {clickable && (
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {row.total_spend_usd != null ? usd(row.total_spend_usd) : "—"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {row.quadrant && (
          <TemporalChip
            label={`${row.quadrant.from} → ${row.quadrant.to}`}
            title={row.quadrant.axes_flipped === 2 ? "Diagonal quadrant move" : "Adjacent quadrant move"}
          />
        )}
        {row.spend && (
          <TemporalChip
            label={`Spend ${row.spend.pct > 0 ? "+" : ""}${row.spend.pct}%`}
            title={`${usd(row.spend.from)} → ${usd(row.spend.to)}`}
          />
        )}
        {row.score && (
          <TemporalChip
            label={`Score ${row.score.delta > 0 ? "+" : ""}${row.score.delta}`}
            title={`${row.score.from.toFixed(1)} → ${row.score.to.toFixed(1)}`}
          />
        )}
        <span className="mx-0.5 text-muted-foreground/40">·</span>
        {row.abc_class && (
          <PositionChip label={`Class ${row.abc_class}`} important={row.abc_class === "A"} />
        )}
        {row.kraljic_quadrant && (
          <PositionChip label={row.kraljic_quadrant} important={row.kraljic_quadrant === "Strategic"} />
        )}
        {row.zone && <PositionChip label={row.zone} />}
        {compoundText && <CompoundBadge label={compoundText} />}
      </div>
    </>
  );
  const cls = "block w-full rounded px-1.5 py-1.5 text-left";
  return clickable ? (
    <li>
      <button
        type="button"
        onClick={() => onSupplier!(row.supplier_id)}
        className={cn("group hover:bg-muted/60", cls)}
      >
        {body}
      </button>
    </li>
  ) : (
    <li className={cls}>{body}</li>
  );
}

function TemporalBlock({
  anomalies,
  load,
  isRangeMode,
  familiesBySupplier,
  onSupplier,
}: {
  anomalies: TemporalAnomalies | null;
  load: TemporalLoad | null;
  isRangeMode: boolean;
  familiesBySupplier: Map<string, Set<AnomalyFamily>>;
  onSupplier?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const head = (count: number) => (
    <SubBlockHeader
      accent={TEMPORAL_ACCENT}
      title="Changed over time"
      tagline="year-over-year spend, quadrant, and score moves"
      count={count}
    />
  );
  const note = (text: React.ReactNode) => (
    <div className="flex flex-col gap-2">
      {head(0)}
      <p className="px-3 text-xs text-muted-foreground">{text}</p>
    </div>
  );

  // States that carry no comparable pair → an explanatory note, no flags.
  if (!load || load.kind === "insufficient") {
    return note("Needs at least two reporting periods to compare.");
  }
  if (load.kind === "no-prior") {
    return note(
      <>
        <span className="font-medium text-foreground">{load.label}</span> is the earliest
        period — no prior year to compare.
      </>,
    );
  }
  if (load.kind === "partial-year") {
    return note(
      <>
        <span className="font-medium text-foreground">{load.label}</span> is a partial year —
        year-over-year comparison isn&apos;t meaningful (its volume is a fraction of{" "}
        {load.priorLabel}). Select a full year or Range.
      </>,
    );
  }
  // load.kind === "ok" → we have a matrix; anomalies is non-null (built in the hub).
  if (!anomalies) return note("Needs at least two reporting periods to compare.");

  const { rows, flaggedCount, rosterSize, latestLabel, priorLabel, skippedLabel, byDetector } = anomalies;

  // Explicit, mode-aware comparison label: "2025 vs 2024" (single-year) or
  // "2024 → 2025" (range, chronological). The range partial-year exclusion rides in
  // the synthesis line below via skippedLabel.
  const compareLabel = isRangeMode ? `${priorLabel} → ${latestLabel}` : `${latestLabel} vs ${priorLabel}`;

  if (flaggedCount === 0) {
    return note(`No sharp year-over-year changes (${compareLabel}).`);
  }

  const INITIAL = 4;
  const shown = expanded ? rows : rows.slice(0, INITIAL);
  const extra = rows.length - INITIAL;

  return (
    <div className="flex flex-col gap-2">
      {head(flaggedCount)}
      <p className="px-3 text-xs text-muted-foreground">
        {flaggedCount} of {rosterSize} suppliers moved sharply — {compareLabel} —
        a spend swing (≥2.5×), a Kraljic quadrant jump, or a ≥18-point score change.
        {skippedLabel ? ` (${skippedLabel} excluded — partial year.)` : ""} Ranked by significance.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="By signal"
          color={TEMPORAL_ACCENT}
          value={String(flaggedCount)}
          caption={
            <>
              Spend {byDetector.spend} · Quadrant {byDetector.quadrant} · Score {byDetector.score}
              <br />
              moved sharply, {compareLabel}
            </>
          }
        />
        <Tile label={compareLabel} color={TEMPORAL_ACCENT} count={flaggedCount} wide>
          <ul className="flex flex-col gap-1">
            {shown.map((row, i) => (
              <TemporalRow
                key={row.supplier_id}
                row={row}
                rank={i + 1}
                compoundText={compoundLabel(familiesBySupplier, row.supplier_id, "temporal")}
                onSupplier={onSupplier}
              />
            ))}
          </ul>
          {extra > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Show less" : `+${extra} more`}
            </button>
          )}
        </Tile>
      </div>
    </div>
  );
}

/**
 * The unified Cross-Analysis Anomaly Hub. One amber section holding THREE families:
 * PROCESS anomalies (Batch 1's cycle flags × position), CLASSIFICATION anomalies
 * (Batch 2's cross-lens disagreement ranking), and CHANGED-OVER-TIME (Batch 3's
 * year-over-year temporal moves). Self-fetches the breakdown roster (span-scoped);
 * the process side degrades to outlier-only if it fails; classification reads perf +
 * kraljic; the temporal family reads a period-aware TemporalLoad passed in (range →
 * latest-vs-prior; single-year → selected vs prior). A compound badge marks suppliers
 * flagged in more than one family.
 */
function CrossAnalysisAnomalyHub({
  cycleTime,
  perf,
  kraljic,
  startDate,
  endDate,
  temporal,
  isRangeMode,
  onProcessSupplier,
  onClassificationSupplier,
  onTemporalSupplier,
}: {
  cycleTime?: CycleTimeResult | null;
  perf?: PerformanceSpendResult | null;
  kraljic?: KraljicResult | null;
  startDate?: string;
  endDate?: string;
  temporal?: TemporalLoad | null;
  isRangeMode?: boolean;
  onProcessSupplier?: (id: string) => void;
  onClassificationSupplier?: (id: string) => void;
  onTemporalSupplier?: (id: string) => void;
}) {
  const [bd, setBd] = useState<{ key: string; data?: CycleBreakdown; err?: string } | null>(null);
  const key = `${startDate ?? ""}_${endDate ?? ""}`;

  // Span-scoped breakdown fetch (same route Process Health uses).
  useEffect(() => {
    if (!startDate || !endDate) return;
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch(`/api/cycle-time/breakdown?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            ((await res.json().catch(() => ({}))) as { error?: string }).error ||
              "Failed to load breakdown",
          );
        return res.json() as Promise<CycleBreakdown>;
      })
      .then((d) => { if (!cancelled) setBd({ key: k, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setBd({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  // No span → can't fetch (shouldn't happen: both AP modes pass dates).
  if (!startDate || !endDate) return null;

  const breakdown = bd?.key === key ? bd.data : undefined;
  const breakdownErr = bd?.key === key ? bd.err : undefined;
  const pending = !breakdown && !breakdownErr;

  const anomalies = cycleTime?.anomalies ?? [];
  const roster = breakdown?.bySupplier ?? [];
  const stageAnomalies = breakdown?.stageAnomalies ?? [];

  // Process flags: full derivation when the breakdown is present; otherwise degrade
  // to outlier-only (has_outlier needs no breakdown — it's in cycle_time.anomalies).
  const degraded = !breakdown && !!breakdownErr;
  let flagsBySupplier: Map<string, SupplierFlagState>;
  if (breakdown) {
    flagsBySupplier = deriveCycleFlags({ roster, anomalies, stageAnomalies }).flagsBySupplier;
  } else {
    flagsBySupplier = new Map();
    for (const a of anomalies) {
      if (!flagsBySupplier.has(a.supplier_id))
        flagsBySupplier.set(a.supplier_id, {
          has_outlier: true,
          inconsistent: false,
          has_stage_dom: false,
        });
    }
  }

  // Numeric supply-risk score per supplier (Kraljic), for the classification lens.
  const supplyRiskById = new Map<string, number>();
  for (const q of kraljic?.quadrant_assignments ?? []) {
    supplyRiskById.set(q.supplier_id, q.supply_risk_score);
  }

  // Temporal family (Batch 3): period-aware — fires in BOTH modes whenever the load
  // resolved a comparable pair (range: latest-vs-prior; single-year: Y vs Y-1). The
  // no-prior / partial-year / insufficient states carry no matrix → the block renders
  // an explanatory note instead (see TemporalBlock).
  const temporalAnomalies =
    temporal?.kind === "ok" ? buildTemporalAnomalies(temporal.matrix) : null;

  const hub = buildAnomalyHub({
    flagsBySupplier,
    perfSuppliers: perf?.suppliers ?? [],
    roster,
    supplyRiskById,
    temporal: temporalAnomalies,
  });

  const header = (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-1.5"
      style={{ backgroundColor: `color-mix(in srgb, ${ANOMALY_ACCENT} 12%, transparent)` }}
    >
      <TriangleAlert className="h-4 w-4 shrink-0" style={{ color: ANOMALY_ACCENT }} aria-hidden />
      <span className="text-sm font-semibold" style={{ color: ANOMALY_ACCENT }}>
        Cross-Analysis Anomaly Hub
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        — process, classification, and changed-over-time anomalies across your analyses
      </span>
      {!pending && (
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {hub.distinctFlagged} flagged
        </span>
      )}
    </div>
  );

  if (pending) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <p className="px-3 text-xs text-muted-foreground">Cross-referencing anomalies…</p>
      </section>
    );
  }

  // Both families empty → one neutral state for the whole hub.
  if (hub.distinctFlagged === 0) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <p className="px-3 text-xs text-muted-foreground">
          No cross-analysis anomalies flagged this period.
        </p>
      </section>
    );
  }

  const { process, classification, temporal: temporalOut, distinctFlagged, compoundCount, familiesBySupplier, importantUnionCount } = hub;
  const temporalClause = temporalOut
    ? `, ${temporalOut.flaggedCount} on changed-over-time (year-over-year moves)`
    : "";
  const hubSynthesis =
    `${distinctFlagged} supplier${distinctFlagged === 1 ? "" : "s"} show a cross-analysis anomaly — ` +
    `${process.flaggedCount} on process (cycle execution), ${classification.flaggedCount} on classification (lens disagreement)${temporalClause}; ` +
    `${compoundCount} in more than one. ${importantUnionCount} sit on important relationships (A-tier or Strategic).`;

  return (
    <section className="flex flex-col gap-3">
      {header}
      <div className="flex max-w-3xl items-start gap-2 rounded-md border bg-muted/30 p-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">{hubSynthesis}</p>
      </div>

      <ProcessBlock
        xref={process}
        degraded={degraded}
        familiesBySupplier={familiesBySupplier}
        onSupplier={onProcessSupplier}
      />
      <ClassificationBlock
        cls={classification}
        familiesBySupplier={familiesBySupplier}
        onSupplier={onClassificationSupplier}
      />
      <TemporalBlock
        anomalies={temporalOut}
        load={temporal ?? null}
        isRangeMode={!!isRangeMode}
        familiesBySupplier={familiesBySupplier}
        onSupplier={onTemporalSupplier}
      />
    </section>
  );
}

type ActionGroupId = (typeof ACTION_GROUPS)[number]["id"];

export function ActionDashboardView({
  data,
  cycleTime,
  perf,
  kraljic,
  startDate,
  endDate,
  temporal,
  isRangeMode,
}: {
  data: RecommendationsResult;
  cycleTime?: CycleTimeResult | null;
  /** Period-scoped analyses that power the in-place supplier drawer. When perf +
   *  dates are present, supplier rows open the drawer instead of navigating. */
  perf?: PerformanceSpendResult | null;
  kraljic?: KraljicResult | null;
  startDate?: string;
  endDate?: string;
  /** Period-aware year-over-year comparison for the hub's temporal family
   *  (server-resolved): range → latest-vs-prior; single-year → selected vs prior,
   *  with no-prior / partial-year note states. Renders in BOTH modes. */
  temporal?: TemporalLoad | null;
  isRangeMode?: boolean;
}) {
  const { recommendations, summary_stats } = data;
  const narrative = summary_stats.narrative;
  const byCat = summary_stats.by_category;
  const of = (t: RecommendationCategory) => recommendations.filter((r) => r.type === t);

  // In-place supplier detail (replaces the old ?supplier= redirect). Only wired
  // when the period's perf + dates are available. `detailTab` lets a click choose
  // which of the modal's three tabs opens first — band rows land on Classification,
  // the Anomaly-exposure rows land on Process (where the cycle detail lives).
  const canDrill = !!(perf && startDate && endDate);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("classification");
  const spanKey = `${startDate ?? ""}_${endDate ?? ""}`;
  const [prevSpan, setPrevSpan] = useState(spanKey);
  if (prevSpan !== spanKey) {
    setPrevSpan(spanKey);
    if (selectedSupplierId !== null) setSelectedSupplierId(null);
  }
  const openSupplier = (id: string, tab: DetailTab) => {
    setDetailTab(tab);
    setSelectedSupplierId(id);
  };
  const onSupplier = canDrill ? (id: string) => openSupplier(id, "classification") : undefined;
  // Hub rows open the modal on the tab of their family: process → Process,
  // classification → Classification.
  const onProcessSupplier = canDrill ? (id: string) => openSupplier(id, "process") : undefined;
  const onClassificationSupplier = canDrill ? (id: string) => openSupplier(id, "classification") : undefined;
  // Temporal rows open on Classification (where the evolution sparklines live).
  const onTemporalSupplier = canDrill ? (id: string) => openSupplier(id, "classification") : undefined;

  const insights: Record<ActionGroupId, string | null> = {
    spend: narrative ? spendInsight(narrative) : null,
    suppliers: narrative ? suppliersInsight(narrative) : null,
    process: narrative ? processInsight(narrative) : null,
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Intro + synthesis headline */}
      {narrative && (
        <div className="space-y-3">
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
          <div className="flex max-w-3xl items-start gap-2 rounded-md border bg-muted/30 p-3">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{synthesisHeadline(narrative)}</p>
          </div>
        </div>
      )}

      {ACTION_GROUPS.map((group) => {
        const groupCount = group.categories.reduce((n, c) => n + (byCat[c] ?? 0), 0);
        const insight = insights[group.id];
        return (
          <section key={group.id} className="flex flex-col gap-2">
            {/* Band header + interpretive line */}
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
            {insight && <p className="px-3 text-xs text-muted-foreground">{insight}</p>}

            {/* Tile grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.id === "spend" && (
                <SpendBand
                  concentration={of("concentration")}
                  critical={of("critical_spend")}
                  tail={of("tail_spend")}
                  narrative={narrative}
                  onSupplier={onSupplier}
                />
              )}
              {group.id === "suppliers" && (
                <SuppliersBand
                  engage={of("critical_issues_engagement")}
                  promote={of("hidden_gems_promotion")}
                  mitigate={of("bottleneck_risk")}
                  onSupplier={onSupplier}
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

      {/* Cross-cutting 4th section: the Cross-Analysis Anomaly Hub — process
          anomalies (Batch 1) + classification lens-disagreement (Batch 2) in one
          area. Spans analyses, so it sits outside the three per-analysis bands. */}
      <CrossAnalysisAnomalyHub
        cycleTime={cycleTime}
        perf={perf}
        kraljic={kraljic}
        startDate={startDate}
        endDate={endDate}
        temporal={temporal}
        isRangeMode={isRangeMode}
        onProcessSupplier={onProcessSupplier}
        onClassificationSupplier={onClassificationSupplier}
        onTemporalSupplier={onTemporalSupplier}
      />

      {/* Nothing flagged at all */}
      {recommendations.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No priorities flagged for this period.
          </CardContent>
        </Card>
      )}

      {/* In-place unified supplier detail — one centered modal, three analysis tabs. */}
      {canDrill && perf && startDate && endDate && (
        <UnifiedSupplierDetailModal
          supplierId={selectedSupplierId}
          initialTab={detailTab}
          startDate={startDate}
          endDate={endDate}
          kraljic={kraljic ?? null}
          perf={perf}
          cycleTime={cycleTime ?? null}
          onClose={() => setSelectedSupplierId(null)}
          onSupplierClick={(id) => openSupplier(id, "classification")}
        />
      )}
    </div>
  );
}

// ---- Spend band ----------------------------------------------------------- //
function SpendBand({
  concentration,
  critical,
  tail,
  narrative,
  onSupplier,
}: {
  concentration: Recommendation[];
  critical: Recommendation[];
  tail: Recommendation[];
  narrative?: RecommendationsNarrative;
  onSupplier?: (id: string) => void;
}) {
  // Concentration donut: the flagged category if any, else the largest category
  // (informational) from the narrative so the finding still surfaces.
  const top = concentration[0];
  const donut = top
    ? {
        sharePct: top.share_pct ?? 0,
        categoryName: top.category ?? "Top category",
        spendUsd: top.total_spend_usd ?? null,
        href: "/spend-overview",
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
          onSupplier={onSupplier}
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
  onSupplier,
}: {
  engage: Recommendation[];
  promote: Recommendation[];
  mitigate: Recommendation[];
  onSupplier?: (id: string) => void;
}) {
  return (
    <>
      <ListTile
        label={CATEGORY_LABEL.critical_issues_engagement}
        color={CATEGORY_COLOR_VAR.critical_issues_engagement}
        rows={engageRows(engage)}
        onSupplier={onSupplier}
        advice={{ verb: verbFor(engage, "engage"), text: adviceText("critical_issues_engagement") }}
      />
      <ListTile
        label={CATEGORY_LABEL.hidden_gems_promotion}
        color={CATEGORY_COLOR_VAR.hidden_gems_promotion}
        rows={promoteRows(promote)}
        onSupplier={onSupplier}
        advice={{ verb: verbFor(promote, "promote"), text: adviceText("hidden_gems_promotion") }}
      />
      <ListTile
        label={CATEGORY_LABEL.bottleneck_risk}
        color={CATEGORY_COLOR_VAR.bottleneck_risk}
        rows={mitigateRows(mitigate)}
        onSupplier={onSupplier}
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
