"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { usePagination, PaginationFooter, ROSTER_PAGE_SIZE } from "@/components/ui/roster-table";
import { panelElevation, formatCompactCurrency } from "@/lib/utils";
import {
  TABLE_CONFIGS,
  CONFIG_BY_TABLE,
  type BrowserRow,
  type ColumnConfig,
} from "@/lib/data-browser-config";

export type SupplierPick = { id: string; name: string };

/** What voiding this order would exclude — loaded when the dialog opens. */
type VoidImpact = {
  poId: string;
  supplierName: string;
  period: string;
  totalValueUsd: number | null;
  voided: boolean;
  voidReason: string | null;
  chain: { lines: number; receipts: number; invoices: number; payments: number };
};

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
  const router = useRouter();
  const [table, setTable] = useState("");
  const [rows, setRows] = useState<BrowserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fSupplier, setFSupplier] = useState("");
  const [fPeriod, setFPeriod] = useState("all");

  // Void confirmation state.
  const [impact, setImpact] = useState<VoidImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

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

  /**
   * Fetch a table's rows. Deliberately does NOT touch the filters, so it can be
   * reused to refresh in place after a void — resetting the filters there would
   * throw the user back to page 1 of all 647 rows and hide the row they just acted
   * on, which is exactly when they most want to see it.
   */
  async function loadTable(next: string) {
    setRows(null);
    setError(null);
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

  async function pickTable(next: string) {
    setTable(next);
    // Filters reset with the TABLE: a period selection is meaningless on a table
    // that has no period, and a supplier may not appear in the new one at all.
    setFSupplier("");
    setFPeriod("all");
    await loadTable(next);
  }

  /** Open the confirmation, loading the impact figures for this specific order. */
  async function openVoidDialog(poId: string) {
    setReason("");
    setDialogError(null);
    setImpactLoading(true);
    setImpact({
      poId,
      supplierName: "",
      period: "",
      totalValueUsd: null,
      voided: false,
      voidReason: null,
      chain: { lines: 0, receipts: 0, invoices: 0, payments: 0 },
    });
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/void`);
      const data = (await res.json().catch(() => ({}))) as Partial<VoidImpact> & { error?: string };
      if (res.ok && data.poId) setImpact(data as VoidImpact);
      else {
        setDialogError(data.error ?? "Could not load this order.");
        setImpact(null);
      }
    } catch {
      setDialogError("Could not load this order.");
      setImpact(null);
    } finally {
      setImpactLoading(false);
    }
  }

  /** Void or un-void, then reload the table so the row reflects its new state. */
  async function submitVoid(unvoid: boolean) {
    if (!impact) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${impact.poId}/void`, {
        method: unvoid ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(unvoid ? {} : { body: JSON.stringify({ reason }) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean };
      if (res.ok && data.success) {
        toast.success(
          unvoid
            ? `${impact.poId} restored — it counts towards analytics again.`
            : `${impact.poId} voided and excluded from analytics.`,
        );
        setImpact(null);
        // Refresh rows in place so the row's new state is visible where the user
        // is standing; filters and page are preserved.
        await loadTable(table);
        router.refresh();
      } else {
        setDialogError(data.error ?? "Could not change the void state.");
      }
    } catch {
      setDialogError("Could not change the void state.");
    } finally {
      setBusy(false);
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
                  {config.voidable && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={config.columns.length + (config.voidable ? 1 : 0)}
                      className="text-center text-muted-foreground"
                    >
                      No rows match the filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((r) => (
                    // A voided row stays listed but reads as withdrawn.
                    <TableRow key={r.id} className={r._voided ? "opacity-55" : undefined}>
                      {config.columns.map((c, i) => (
                        <TableCell key={c.key} className={cellClass(c)}>
                          {renderCell(r.cells[c.key], c)}
                          {/* The chip rides the first column so it reads with the id. */}
                          {i === 0 && r._voided && (
                            <span
                              className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                color: "var(--destructive)",
                                backgroundColor:
                                  "color-mix(in srgb, var(--destructive) 14%, transparent)",
                              }}
                            >
                              voided
                            </span>
                          )}
                        </TableCell>
                      ))}
                      {config.voidable && (
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openVoidDialog(r.id)}
                          >
                            {r._voided ? "Un-void" : "Void"}
                          </Button>
                        </TableCell>
                      )}
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

      <Dialog open={impact !== null} onOpenChange={(o) => !busy && !o && setImpact(null)}>
        <DialogContent
          showCloseButton={false}
          aria-label={impact?.voided ? "Restore a purchase order" : "Void a purchase order"}
          className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[560px] ${panelElevation}`}
        >
          <header className="flex items-start justify-between gap-2 border-b p-4">
            <div className="min-w-0">
              <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
                {impact?.voided ? "Restore this purchase order" : "Void this purchase order"}
              </DialogTitle>
              <p className="truncate text-xs text-muted-foreground">
                {impact?.voided
                  ? "It will count towards analytics again."
                  : "Nothing is deleted — the records stay, but stop counting."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Close"
              onClick={() => setImpact(null)}
              disabled={busy}
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex flex-col gap-4 p-4">
            {impactLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

            {impact && !impactLoading && (
              <>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs">{impact.poId}</span>
                    <span className="font-medium">{impact.supplierName}</span>
                    <span className="text-muted-foreground">{impact.period}</span>
                  </div>
                </div>

                {!impact.voided && (
                  <>
                    {/* The number that will actually move — stated, not implied. */}
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                      <p className="text-sm">
                        <span className="font-medium text-destructive">
                          {impact.totalValueUsd !== null
                            ? formatCompactCurrency(impact.totalValueUsd)
                            : "—"}
                        </span>{" "}
                        will leave the reported totals.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {impact.totalValueUsd !== null && (
                          <>
                            Exactly{" "}
                            {impact.totalValueUsd.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{" "}
                            USD.{" "}
                          </>
                        )}
                        This order and its whole chain are excluded from every analysis:{" "}
                        {impact.chain.lines} {impact.chain.lines === 1 ? "line" : "lines"},{" "}
                        {impact.chain.receipts}{" "}
                        {impact.chain.receipts === 1 ? "receipt" : "receipts"},{" "}
                        {impact.chain.invoices}{" "}
                        {impact.chain.invoices === 1 ? "invoice" : "invoices"},{" "}
                        {impact.chain.payments}{" "}
                        {impact.chain.payments === 1 ? "payment" : "payments"}. Nothing is
                        deleted — every row stays in this browser and the void can be undone.
                      </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="void-reason">Reason</Label>
                      <Input
                        id="void-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why this order is being voided"
                      />
                      {reason.trim().length > 0 && reason.trim().length < 3 && (
                        <p className="text-[11px] text-destructive">
                          A reason must be at least 3 characters.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {impact.voided && impact.voidReason && (
                  <p className="text-sm text-muted-foreground">
                    Voided because: <span className="text-foreground">{impact.voidReason}</span>
                  </p>
                )}

                {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
              </>
            )}

            {dialogError && !impact && <p className="text-sm text-destructive">{dialogError}</p>}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 p-4">
            <span className="text-[11px] text-muted-foreground">
              Every period is recomputed — a few seconds.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => setImpact(null)} disabled={busy}>
                Cancel
              </Button>
              {impact?.voided ? (
                <Button onClick={() => submitVoid(true)} disabled={busy}>
                  {busy ? "Restoring…" : "Un-void"}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => submitVoid(false)}
                  disabled={busy || impactLoading || reason.trim().length < 3}
                >
                  {busy ? "Voiding…" : "Void order"}
                </Button>
              )}
            </div>
          </footer>
        </DialogContent>
      </Dialog>
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
