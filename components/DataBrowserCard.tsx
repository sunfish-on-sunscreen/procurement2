"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { usePagination, PaginationFooter, ROSTER_PAGE_SIZE } from "@/components/ui/roster-table";
import {
  TABLE_CONFIGS,
  CONFIG_BY_TABLE,
  type BrowserRow,
  type ColumnConfig,
} from "@/lib/data-browser-config";

export type SupplierPick = { id: string; name: string };

/**
 * Read-only browser over the dataset tables.
 *
 * ONE table component driven by per-table config — every table shows rows, filters
 * by supplier and period, and paginates, so there is nothing to specialise. Adding
 * a table is a config entry plus a query branch in the route, never a new component.
 *
 * ⚠️ Nothing is fetched until a table is picked. This sits on an already-busy page,
 * and most visits never open it, so the section costs nothing until used.
 */
export function DataBrowserCard({
  counts,
  suppliers,
  periods,
}: {
  counts: Record<string, number>;
  suppliers: SupplierPick[];
  periods: string[];
}) {
  const [table, setTable] = useState("");
  const [rows, setRows] = useState<BrowserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fSupplier, setFSupplier] = useState("");
  const [fPeriod, setFPeriod] = useState("all");

  const config = table ? CONFIG_BY_TABLE.get(table) ?? null : null;

  const tableOptions = useMemo<ComboOption[]>(
    () =>
      TABLE_CONFIGS.map((c) => ({
        value: c.table,
        label: `${c.label} · ${(counts[c.table] ?? 0).toLocaleString()}`,
        keywords: c.table,
      })),
    [counts],
  );

  const supplierOptions = useMemo<ComboOption[]>(
    () => [
      { value: "", label: "All suppliers" },
      ...suppliers.map((s) => ({ value: s.id, label: s.name, keywords: s.id })),
    ],
    [suppliers],
  );

  async function pickTable(next: string) {
    setTable(next);
    setRows(null);
    setError(null);
    // Filters reset with the table: a period selection is meaningless on a table
    // that has no period, and a supplier may not appear in the new one at all.
    setFSupplier("");
    setFPeriod("all");
    if (!next) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/data-browser/${next}`);
      const data = (await res.json().catch(() => ({}))) as { rows?: BrowserRow[]; error?: string };
      if (res.ok && data.rows) setRows(data.rows);
      else setError(data.error ?? "Could not load that table.");
    } catch {
      setError("Could not load that table.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter(
      (r) =>
        (fSupplier === "" || r._supplierId === fSupplier) &&
        (fPeriod === "all" || r._period === fPeriod),
    );
  }, [rows, fSupplier, fPeriod]);

  const { page, setPage, pageCount, start, pageItems } = usePagination(
    filtered,
    ROSTER_PAGE_SIZE,
    `${table}|${fSupplier}|${fPeriod}`,
  );

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Browse data</h2>
      <p className="text-sm text-muted-foreground">
        Read-only view of the raw dataset tables, exactly as stored. Pick a table to
        load it, then narrow by supplier or period. Nothing here writes.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="db-table">Table</Label>
          <TypeableCombobox
            id="db-table"
            aria-label="Table"
            value={table}
            onChange={pickTable}
            options={tableOptions}
            placeholder="Select a table"
          />
        </div>

        {config?.supplierFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-supplier">Supplier</Label>
            <TypeableCombobox
              id="db-supplier"
              aria-label="Supplier"
              value={fSupplier}
              onChange={setFSupplier}
              options={supplierOptions}
              placeholder="All suppliers"
            />
          </div>
        )}

        {/* Absent, not disabled, where the table has no period dimension at all. */}
        {config?.periodFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-period">Period</Label>
            <div className="flex flex-wrap gap-1.5" id="db-period" role="radiogroup">
              <Button
                type="button"
                role="radio"
                aria-checked={fPeriod === "all"}
                variant={fPeriod === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFPeriod("all")}
              >
                All
              </Button>
              {periods.map((p) => (
                <Button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={fPeriod === p}
                  variant={fPeriod === p ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFPeriod(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!table && (
        <p className="text-sm text-muted-foreground">
          No table selected — {TABLE_CONFIGS.length} available.
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {config && rows && !loading && (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {config.columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={
                        c.type === "money" || c.type === "number" ? "text-right" : undefined
                      }
                    >
                      {c.label ?? c.key}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={config.columns.length}
                      className="text-center text-muted-foreground"
                    >
                      No rows match the filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((r) => (
                    <TableRow key={r.id}>
                      {config.columns.map((c) => (
                        <TableCell key={c.key} className={cellClass(c)}>
                          {renderCell(r.cells[c.key], c)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <PaginationFooter
            page={page}
            pageCount={pageCount}
            start={start}
            pageSize={ROSTER_PAGE_SIZE}
            total={filtered.length}
            setPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function cellClass(c: ColumnConfig): string | undefined {
  if (c.type === "money" || c.type === "number") return "text-right tabular-nums";
  if (c.type === "id") return "font-mono text-xs";
  if (c.type === "date") return "whitespace-nowrap tabular-nums";
  return undefined;
}

/** Null renders as an em dash, never as blank — an empty cell reads as a bug. */
function renderCell(value: BrowserRow["cells"][string], c: ColumnConfig) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (c.type === "bool") return value ? "Yes" : "No";
  if (c.type === "money" && typeof value === "number") {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (c.type === "number" && typeof value === "number") return value.toLocaleString();
  return String(value);
}
