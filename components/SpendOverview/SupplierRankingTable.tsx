"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { SupplierRankingRow } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { formatCompactCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const num0 = new Intl.NumberFormat("en-US");

type SortKey =
  | "rank"
  | "supplier_name"
  | "category"
  | "tier"
  | "total_spend"
  | "po_count"
  | "avg_po_value"
  | "abc_class"
  | "kraljic_quadrant";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "rank", label: "#", align: "right" },
  { key: "supplier_name", label: "Supplier", align: "left" },
  { key: "category", label: "Category", align: "left" },
  { key: "tier", label: "Tier", align: "left" },
  { key: "total_spend", label: "Total spend", align: "right" },
  { key: "po_count", label: "Invoices", align: "right" },
  { key: "avg_po_value", label: "Avg invoice", align: "right" },
  { key: "abc_class", label: "ABC", align: "left" },
  { key: "kraljic_quadrant", label: "Kraljic", align: "left" },
];

function compare(a: SupplierRankingRow, b: SupplierRankingRow, key: SortKey) {
  const av = a[key];
  const bv = b[key];
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av ?? "").localeCompare(String(bv ?? ""));
}

export function SupplierRankingTable({
  rows,
  onSupplierClick,
  selectedSupplierId,
}: {
  rows: SupplierRankingRow[];
  onSupplierClick: (supplierId: string) => void;
  selectedSupplierId: string | null;
}) {
  // Default sort: total spend descending.
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
        : { key, dir: key === "supplier_name" || key === "category" || key === "tier" ? "asc" : "desc" },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Suppliers</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-muted-foreground">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`py-2 font-medium ${col.align === "right" ? "text-right" : "text-left"}`}
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
              {sorted.map((r) => (
                <tr
                  key={r.supplier_id}
                  onClick={() => onSupplierClick(r.supplier_id)}
                  className={`cursor-pointer border-b ${
                    r.supplier_id === selectedSupplierId
                      ? "bg-foreground/5 ring-1 ring-inset ring-foreground/30"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <td className="py-1.5 text-right text-muted-foreground">{r.rank}</td>
                  <td className="py-1.5 font-medium">{r.supplier_name}</td>
                  <td className="py-1.5 text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="py-1.5">{r.tier ?? "—"}</td>
                  <td className="py-1.5 text-right">{formatCompactCurrency(r.total_spend)}</td>
                  <td className="py-1.5 text-right">{num0.format(r.po_count)}</td>
                  <td className="py-1.5 text-right">{formatCompactCurrency(r.avg_po_value)}</td>
                  <td className="py-1.5">
                    {r.abc_class ? (
                      <span style={{ color: ABC_COLORS[r.abc_class] }}>{r.abc_class}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5">
                    {r.kraljic_quadrant ? (
                      <span style={{ color: QUADRANT_COLORS[r.kraljic_quadrant] }}>
                        {r.kraljic_quadrant}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
