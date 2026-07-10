"use client";

import { useEffect, useState } from "react";
import { Star, Info, Loader2, ChevronDown } from "lucide-react";
import type { RangeAnalyses } from "@/lib/analysis-types";
import type { AbcClass } from "@/lib/cycle-time-types";
import {
  buildSupplierSelection,
  SELECTION_WEIGHTS,
  type CategorySelection,
  type SelectionSupplier,
} from "@/lib/supplier-selection";
import { UnifiedSupplierDetailModal } from "@/components/UnifiedSupplierDetailModal";
import { cn } from "@/lib/utils";

// ---- formatting ----------------------------------------------------------- //
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

// ---- component bar colours (distinct; all "higher is better") -------------- //
const COMPONENT_META = [
  { key: "perf", label: "Performance", color: "var(--zone-stars)" },
  { key: "safety", label: "Safety", color: "var(--quadrant-routine)" },
  { key: "price", label: "Price", sub: "vs. benchmark", color: "var(--warning)" },
] as const;

/** A labelled 0–100 component bar. */
function ComponentBar({
  label,
  sub,
  value,
  color,
}: {
  label: string;
  sub?: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2" title={`${label}${sub ? ` (${sub})` : ""}: ${value}`}>
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
        {label}
        {sub && <span className="text-muted-foreground/70"> {sub}</span>}
      </span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
      >
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {Math.round(value)}
      </span>
    </div>
  );
}

/** A bordered meta chip (ABC / Kraljic / zone / country). */
function MetaChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground"
      style={{ borderColor: "color-mix(in srgb, var(--foreground) 15%, transparent)" }}
    >
      {label}
    </span>
  );
}

function SupplierRow({
  s,
  rank,
  onSupplier,
}: {
  s: SelectionSupplier;
  rank: number;
  onSupplier?: (id: string) => void;
}) {
  const clickable = !!onSupplier;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{rank}</span>
          <span className="truncate text-sm font-medium">{s.supplier_name}</span>
          {s.recommended && (
            <span
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{
                color: "var(--warning)",
                backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)",
              }}
            >
              <Star className="h-3 w-3" aria-hidden /> Recommended
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="font-mono text-sm font-semibold tabular-nums">{s.fit_score}</span>
          <span className="text-[11px] text-muted-foreground">fit</span>
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1">
        <ComponentBar label="Performance" value={s.components.perf} color={COMPONENT_META[0].color} />
        <ComponentBar label="Safety" value={s.components.safety} color={COMPONENT_META[1].color} />
        <ComponentBar
          label="Price"
          sub="vs. benchmark"
          value={s.components.price}
          color={COMPONENT_META[2].color}
        />
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">{s.why}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {s.abc_class && <MetaChip label={`Class ${s.abc_class}`} />}
        {s.kraljic_quadrant && <MetaChip label={s.kraljic_quadrant} />}
        {s.zone && <MetaChip label={s.zone} />}
        <span className="mx-0.5 text-muted-foreground/40">·</span>
        <MetaChip label={usd(s.total_spend_usd)} />
        {s.country && <MetaChip label={s.country} />}
      </div>
    </>
  );

  const wrap = cn(
    "rounded-lg border p-3",
    s.recommended && "ring-1 ring-inset",
  );
  const wrapStyle = s.recommended
    ? { borderColor: "var(--warning)", boxShadow: "none" }
    : undefined;

  return clickable ? (
    <button
      type="button"
      onClick={() => onSupplier!(s.supplier_id)}
      className={cn("group w-full text-left transition-colors hover:bg-muted/40", wrap)}
      style={wrapStyle}
    >
      {body}
    </button>
  ) : (
    <div className={wrap} style={wrapStyle}>
      {body}
    </div>
  );
}

function CategoryCard({
  cat,
  onSupplier,
}: {
  cat: CategorySelection;
  onSupplier?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 3;
  const shown = expanded ? cat.suppliers : cat.suppliers.slice(0, INITIAL);
  const extra = cat.suppliers.length - INITIAL;

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{cat.category}</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {cat.supplierCount} supplier{cat.supplierCount === 1 ? "" : "s"} · {usd(cat.categorySpend)}
        </span>
      </div>

      {cat.soleSource ? (
        <>
          <p className="text-xs text-muted-foreground">
            Sole source — no alternatives to rank in this category.
          </p>
          <div className="flex flex-col gap-2">
            <SupplierRow s={cat.suppliers[0]} rank={1} onSupplier={onSupplier} />
          </div>
        </>
      ) : (
        <>
          {cat.thinData && (
            <p className="text-xs text-muted-foreground">
              Limited data — only {cat.supplierCount} suppliers; interpret with care.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {shown.map((s, i) => (
              <SupplierRow key={s.supplier_id} s={s} rank={i + 1} onSupplier={onSupplier} />
            ))}
          </div>
          {extra > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Show fewer" : `+${extra} more candidate${extra === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "done"; data: RangeAnalyses };

/**
 * Client view: fetches the span-scoped analyses (compute-range) and renders a
 * best-supplier-per-category recommendation. Span-scoped like the other analyses
 * (works for single-year and range). Rows open the shared unified supplier modal.
 */
export function SupplierSelectionClient({
  startDate,
  endDate,
  categoryById,
  countryById,
}: {
  startDate: string;
  endDate: string;
  /** Global catalog maps (serializable records passed from the server page). */
  categoryById: Record<string, string>;
  countryById: Record<string, string>;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  // The parent keys this component on the span, so a span change remounts it back
  // into the initial "loading" state — no set-state-in-effect needed here.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyses/compute-range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Compute failed");
        }
        return res.json() as Promise<RangeAnalyses>;
      })
      .then((data) => { if (!cancelled) setState({ status: "done", data }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing supplier fit scores…
      </div>
    );
  }
  if (state.status === "error") {
    return <p className="py-8 text-sm text-destructive">Failed to compute: {state.error}</p>;
  }

  const { performance_spend, kraljic, abc, cycle_time } = state.data;
  if (!performance_spend || !kraljic) {
    return <p className="py-8 text-sm text-muted-foreground">No supplier data for this period.</p>;
  }

  const abcById = new Map<string, AbcClass>(
    (abc?.classifications ?? []).map((c) => [c.supplier_id, c.abc_class as AbcClass]),
  );
  const result = buildSupplierSelection({
    perfSuppliers: performance_spend.suppliers,
    quadrantAssignments: kraljic.quadrant_assignments,
    abcById,
    categoryById: new Map(Object.entries(categoryById)),
    countryById: new Map(Object.entries(countryById)),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Method + the honest price caveat */}
      <div className="flex max-w-3xl flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          For each procurement category, suppliers are ranked by a transparent{" "}
          <span className="font-medium text-foreground">fit score</span> —{" "}
          {Math.round(SELECTION_WEIGHTS.perf * 100)}% Performance,{" "}
          {Math.round(SELECTION_WEIGHTS.safety * 100)}% Safety (low supply risk), and{" "}
          {Math.round(SELECTION_WEIGHTS.price * 100)}% Price. The top-ranked supplier is marked{" "}
          <span className="font-medium text-foreground">★ Recommended</span>.
        </p>
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Price</span> is measured{" "}
            <span className="font-medium text-foreground">vs. the category benchmark</span> and
            reflects <span className="font-medium text-foreground">not overpaying</span>: suppliers
            at or below benchmark — and those with no comparable items to benchmark — all score high;
            only measured above-benchmark pricing is penalised. It is not a &ldquo;cheapest&rdquo;
            ranking.
          </p>
        </div>
      </div>

      {result.categories.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">No categories to rank for this period.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {result.categories.map((cat) => (
            <CategoryCard key={cat.category} cat={cat} onSupplier={setSelectedSupplierId} />
          ))}
        </div>
      )}

      {/* Reuse the unified supplier modal (Classification / Spend / Process). */}
      <UnifiedSupplierDetailModal
        supplierId={selectedSupplierId}
        startDate={startDate}
        endDate={endDate}
        kraljic={kraljic}
        perf={performance_spend}
        cycleTime={cycle_time ?? null}
        onClose={() => setSelectedSupplierId(null)}
        onSupplierClick={setSelectedSupplierId}
      />
    </div>
  );
}
