"use client";

import { useState } from "react";
import { AlertTriangle, ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";
import type { PerformanceSpendResult, PerformanceSpendSupplier } from "@/lib/analysis-types";
import {
  computeSynthesis,
  SYNTHESIS_META,
  SYNTHESIS_ORDER,
  type SynthesisMeta,
} from "@/lib/supplier-classification";
import type { SynthesisKey } from "@/lib/supplier-classification-types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import { cardElevation, cn } from "@/lib/utils";

const ICONS: Record<SynthesisKey, React.ComponentType<{ className?: string }>> = {
  strategic_under: AlertTriangle,
  bottleneck_critical: ShieldAlert,
  leverage_workhorse: CheckCircle2,
  routine_risk: AlertCircle,
};

const TOP_N = 3;

// One clickable supplier name; highlighted when its detail panel is open.
function NameButton({
  s,
  selected,
  onClick,
  block,
}: {
  s: PerformanceSpendSupplier;
  selected: boolean;
  onClick: () => void;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={s.supplier_name}
      className={cn(
        "rounded text-left text-xs transition-colors hover:bg-foreground/5 hover:underline",
        block ? "block w-full truncate px-1.5 py-1" : "px-0.5",
        selected ? "bg-foreground/10 font-semibold text-foreground ring-1 ring-inset ring-foreground/25" : "text-foreground",
      )}
    >
      {s.supplier_name}
    </button>
  );
}

function SynthesisTile({
  meta,
  suppliers,
  selectedSupplierId,
  onSupplierClick,
  active,
  onToggleFilter,
}: {
  meta: SynthesisMeta;
  suppliers: PerformanceSpendSupplier[];
  selectedSupplierId: string | null;
  onSupplierClick: (id: string) => void;
  active: boolean;
  onToggleFilter: () => void;
}) {
  const Icon = ICONS[meta.key];
  const [expanded, setExpanded] = useState(false);
  const count = suppliers.length;

  // Empty category (Q): fully muted, non-interactive, explanatory message.
  if (count === 0) {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border border-l-4 border-l-muted-foreground/30 bg-muted/30 p-4 text-left opacity-60"
        aria-disabled="true"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{meta.title}</span>
          <span className="ml-auto text-lg font-semibold tabular-nums text-muted-foreground">0</span>
        </div>
        <p className="text-xs text-muted-foreground">
          No suppliers in this category for the selected period.
        </p>
      </div>
    );
  }

  const color = QUADRANT_COLORS[meta.quadrant];
  const top = suppliers.slice(0, TOP_N);
  // Auto-expand when the open supplier is in this bucket but beyond the top-N, so
  // their highlighted row is visible without a manual click.
  const selfBeyondTop =
    selectedSupplierId != null &&
    suppliers.some((s) => s.supplier_id === selectedSupplierId) &&
    !top.some((s) => s.supplier_id === selectedSupplierId);
  const isExpanded = expanded || selfBeyondTop;
  const remaining = count - TOP_N;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-4 p-4 text-left",
        meta.theme.tint,
        active && "ring-2 ring-inset ring-foreground/30",
      )}
      style={{ borderColor: color }}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", meta.theme.text)} />
        <span className="text-sm font-medium">{meta.title}</span>
        <span className={cn("ml-auto text-lg font-semibold tabular-nums", meta.theme.text)}>{count}</span>
      </div>
      <p className="text-xs text-muted-foreground">{meta.blurb}</p>

      {/* Names: inline comma list (collapsed) / vertical scrollable list (expanded). */}
      {isExpanded ? (
        <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-1">
          {suppliers.map((s) => (
            <li key={s.supplier_id}>
              <NameButton
                s={s}
                selected={s.supplier_id === selectedSupplierId}
                onClick={() => onSupplierClick(s.supplier_id)}
                block
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {top.map((s, i) => (
            <span key={s.supplier_id}>
              {i > 0 && <span className="text-muted-foreground">, </span>}
              <NameButton
                s={s}
                selected={s.supplier_id === selectedSupplierId}
                onClick={() => onSupplierClick(s.supplier_id)}
              />
            </span>
          ))}
          {remaining > 0 && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn("text-xs font-medium hover:underline", meta.theme.text)}
              >
                …+{remaining} more
              </button>
            </>
          )}
        </p>
      )}
      {isExpanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={cn("self-start text-xs font-medium hover:underline", meta.theme.text)}
        >
          Show less
        </button>
      )}

      {/* Footer: action line + table-filter toggle (separate from name clicks). */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className={cn("text-xs font-medium", meta.theme.text)}>{meta.action}</span>
        <button
          type="button"
          onClick={onToggleFilter}
          aria-pressed={active}
          className={cn("shrink-0 text-xs font-medium hover:underline", meta.theme.text)}
        >
          {active ? "Showing in table ↓" : "View suppliers →"}
        </button>
      </div>
    </div>
  );
}

/**
 * 2×2 grid synthesising Kraljic × performance-median. Each tile lists its flagged
 * suppliers (collapsed inline top-3 + "…+N more" → expands to the full, scrollable
 * in-card list) and a one-line action. Clicking a name opens that supplier's
 * detail panel (and highlights it here); "View suppliers →" filters the table
 * below to that bucket. Card border = the quadrant colour.
 */
export function CrossClassificationCard({
  perf,
  selectedSupplierId,
  onSupplierClick,
  activeKey,
  onSelect,
}: {
  perf: PerformanceSpendResult;
  selectedSupplierId: string | null;
  onSupplierClick: (id: string) => void;
  activeKey: SynthesisKey | null;
  onSelect: (key: SynthesisKey | null) => void;
}) {
  const groups = computeSynthesis(perf);

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Cross-classification insights</CardTitle>
        <p className="text-sm text-muted-foreground">
          Suppliers flagged by combining their Exposure position (Kraljic matrix
          quadrant) with the period performance median. Click a name to open its detail, or &ldquo;View suppliers&rdquo; to
          filter the table.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SYNTHESIS_ORDER.map((key) => (
            <SynthesisTile
              key={key}
              meta={SYNTHESIS_META[key]}
              suppliers={groups[key]}
              selectedSupplierId={selectedSupplierId}
              onSupplierClick={onSupplierClick}
              active={activeKey === key}
              onToggleFilter={() => onSelect(activeKey === key ? null : key)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
