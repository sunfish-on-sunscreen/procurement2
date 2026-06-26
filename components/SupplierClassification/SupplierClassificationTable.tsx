"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { ClassificationRankingRow } from "@/lib/supplier-classification-types";
import { ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { formatCompactCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SortKey =
  | "supplier_name"
  | "category"
  | "abc_class"
  | "kraljic_quadrant"
  | "performance_score"
  | "total_spend";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "supplier_name", label: "Supplier", align: "left" },
  { key: "category", label: "Category", align: "left" },
  { key: "abc_class", label: "ABC", align: "left" },
  { key: "kraljic_quadrant", label: "Kraljic", align: "left" },
  { key: "performance_score", label: "Performance", align: "right" },
  { key: "total_spend", label: "Total spend", align: "right" },
];

function compare(a: ClassificationRankingRow, b: ClassificationRankingRow, key: SortKey) {
  const av = a[key];
  const bv = b[key];
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  // Nulls sort last regardless of direction caller; treat as empty string.
  return String(av ?? "").localeCompare(String(bv ?? ""));
}

// Color-mix chip (12% tint + token text) — same treatment as the Spend Overview
// ranking table; `value` null → muted placeholder.
function Chip({ color, label }: { color: string | null; label: string | null }) {
  if (!color || !label) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

export function SupplierClassificationTable({
  rows,
  onSupplierClick,
  selectedSupplierId,
  filterLabel,
  onClearFilter,
}: {
  rows: ClassificationRankingRow[];
  onSupplierClick: (supplierId: string) => void;
  selectedSupplierId: string | null;
  filterLabel?: string | null;
  onClearFilter?: () => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total_spend",
    dir: "desc",
  });

  const sorted = [...rows].sort((a, b) => {
    const c = compare(a, b, sort.key);
    return sort.dir === "asc" ? c : -c;
  });

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "supplier_name" || key === "category" ? "asc" : "desc" },
    );

  return (
    // overflow-visible so the sticky header can pin (Card defaults to overflow-hidden).
    <Card className="overflow-visible">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>All Suppliers</CardTitle>
        {filterLabel && (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Filtered: {filterLabel} ({rows.length})
            <X className="h-3 w-3" />
          </button>
        )}
      </CardHeader>
      <CardContent className="pt-1">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 border-b bg-card py-2 text-right font-medium tabular-nums text-muted-foreground">
                #
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`sticky top-0 z-10 border-b bg-card py-2 font-medium text-muted-foreground ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center gap-1 hover:text-foreground ${
                      col.align === "right" ? "flex-row-reverse" : ""
                    }`}
                  >
                    {col.label}
                    {sort.key === col.key &&
                      (sort.dir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-8 text-center text-muted-foreground">
                  No suppliers match this filter.
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => (
                <tr
                  key={r.supplier_id}
                  onClick={() => onSupplierClick(r.supplier_id)}
                  title={r.inactive ? "No activity in this period" : undefined}
                  className={`cursor-pointer border-b ${
                    r.supplier_id === selectedSupplierId
                      ? "bg-foreground/5 ring-1 ring-inset ring-foreground/30"
                      : "hover:bg-muted/40"
                  } ${r.inactive ? "opacity-50" : ""}`}
                >
                  <td className="py-3 text-right tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="py-3 font-medium">{r.supplier_name}</td>
                  <td className="py-3">{r.category ?? "—"}</td>
                  <td className="py-3">
                    <Chip
                      color={r.abc_class ? ABC_COLORS[r.abc_class] : null}
                      label={r.abc_class}
                    />
                  </td>
                  <td className="py-3">
                    <Chip
                      color={r.kraljic_quadrant ? QUADRANT_COLORS[r.kraljic_quadrant] : null}
                      label={r.kraljic_quadrant}
                    />
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {r.performance_score != null ? r.performance_score.toFixed(2) : "—"}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {r.inactive ? "—" : formatCompactCurrency(r.total_spend)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
