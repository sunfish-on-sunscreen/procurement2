"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Plus, X } from "lucide-react";
import { AddSupplierCard } from "@/components/AddSupplierCard";
import { SupplierRosterTable } from "@/components/SupplierRosterTable";
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
  type BrowserRow,
  type ColumnConfig,
  type TableConfig,
} from "@/lib/data-browser-config";

export type SupplierPick = { id: string; name: string };

/** The supplier roster's own row shape — this table is master data, not a read copy. */
export type SupplierRow = {
  id: string;
  supplierName: string;
  country: string;
  category: string;
  status: string;
};

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
 * MASTER DATA — the supplier roster and all twelve dataset tables in one section.
 *
 * ⚠️ `suppliers` is NOT a read-only copy of the roster: it IS the roster, rendered
 * as the suppliers entry among the twelve, carrying its own Deactivate/Reactivate
 * actions and its four text filters. Rendering a read-only suppliers table here
 * alongside a separate editable roster would show the same rows twice and invite
 * edits in the copy that does nothing. purchase_orders works the same way, carrying
 * the Void action.
 *
 * Every table is COLLAPSIBLE and starts collapsed, so the page opens light: a
 * collapsed table is never mounted and therefore never fetches. Once expanded it
 * stays mounted and is merely hidden when re-collapsed, so re-opening costs no
 * second fetch and keeps the filters and page the user had set.
 *
 * Per-table state (expanded, filters, page) lives in each section, which is what
 * keeps twelve of them independent. Only the void dialog is shared: at most one can
 * be open, and voiding refreshes just the purchase_orders section via a bumped key.
 */
export function MasterDataSection({
  counts,
  suppliers,
  supplierRoster,
  nextSupplierId,
  supplierCategories,
  periods,
}: {
  counts: Record<string, number>;
  suppliers: SupplierPick[];
  /** Full roster rows for the editable suppliers table. */
  supplierRoster: SupplierRow[];
  nextSupplierId: string;
  supplierCategories: string[];
  periods: string[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  /**
   * Set when the correction form hands an order over — a locked field there means
   * "this cannot be corrected", and voiding is the tool that can. Arriving with it
   * expands the purchase_orders table, narrows it to that one order and highlights
   * the row, so the order is already in front of the user rather than something
   * they have to go and find.
   */
  const focusPo = useSearchParams().get("focusPo");
  const clearFocus = () => router.replace("/import", { scroll: false });

  // Void confirmation state, shared because only one dialog exists at a time.
  const [impact, setImpact] = useState<VoidImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** Bumped after a void so the voidable section refetches and shows the new state. */
  const [voidVersion, setVoidVersion] = useState(0);

  const supplierOptions = useMemo<ComboOption[]>(
    () => [
      { value: "", label: "All suppliers" },
      ...suppliers.map((s) => ({ value: s.id, label: s.name, keywords: s.id })),
    ],
    [suppliers],
  );

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
        // Refetch only the voidable section; its own filters and page are preserved
        // because they live in that section's state, not in this key.
        setVoidVersion((v) => v + 1);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Master data</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add supplier
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Every dataset table, in the order the documents flow. Suppliers are editable —
        adding one recomputes every period, and retiring one is a status change, never a
        delete. The rest are read-only apart from voiding an order, which excludes it
        from analytics without deleting anything. Expand a table to load it.
      </p>

      <AddSupplierCard
        open={addOpen}
        onOpenChange={setAddOpen}
        nextId={nextSupplierId}
        categories={supplierCategories}
      />

      {/* A bounded list of rows — the top border closes it off above the first row. */}
      <div className="flex flex-col border-t">
        {TABLE_CONFIGS.map((config) => (
          <CollapsibleTable
            key={config.table}
            label={config.label}
            table={config.table}
            count={counts[config.table] ?? 0}
            forceOpen={!!focusPo && !!config.voidable}
          >
            {config.table === "suppliers" ? (
              // The roster itself — editable, with its own filters and actions.
              <SupplierRosterTable suppliers={supplierRoster} hideHeading />
            ) : (
              <BrowserTableSection
                config={config}
                supplierOptions={supplierOptions}
                periods={periods}
                reloadKey={config.voidable ? voidVersion : 0}
                onVoid={config.voidable ? openVoidDialog : undefined}
                focusPo={config.voidable ? focusPo : null}
                onClearFocus={clearFocus}
              />
            )}
          </CollapsibleTable>
        ))}
      </div>

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

/**
 * Collapsible shell around one table.
 *
 * ⚠️ The body is not rendered until the first expand, so a collapsed table never
 * mounts and never fetches — that is what keeps the page's initial load light. After
 * that it stays mounted and is hidden with a class when collapsed, so re-expanding
 * costs no second fetch and preserves the filters and page already set.
 */
function CollapsibleTable({
  label,
  table,
  count,
  forceOpen = false,
  children,
}: {
  label: string;
  table: string;
  count: number;
  /** Opened from outside — e.g. arriving with ?focusPo= from the correction form. */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  // ⚠️ Seeded FROM forceOpen, not false. Arriving directly on a URL that already
  // carries ?focusPo= mounts this with forceOpen already true, and the transition
  // below only fires on a CHANGE — so initialising to false would leave the table
  // shut on exactly the deep link that asked for it open.
  const [open, setOpen] = useState(forceOpen);
  const [hasOpened, setHasOpened] = useState(forceOpen);

  // Handles the other direction: already mounted and collapsed when the correction
  // form hands an order over. Render-time transition rather than an effect, matching
  // the pattern used elsewhere in the repo. The user can still collapse it again.
  const [prevForce, setPrevForce] = useState(forceOpen);
  if (forceOpen !== prevForce) {
    setPrevForce(forceOpen);
    if (forceOpen) {
      setOpen(true);
      setHasOpened(true);
    }
  }

  return (
    // A row in a list, not a card: a single divider separates it from the next.
    <section className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setHasOpened(true);
        }}
        className="group flex w-full items-center gap-2 py-2.5 text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-sm font-medium underline-offset-4 group-hover:underline">
          {label}
        </span>
        <span className="text-sm text-muted-foreground">({count.toLocaleString()})</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">{table}</span>
      </button>

      {hasOpened && <div className={open ? "pb-4" : "hidden"}>{children}</div>}
    </section>
  );
}

/**
 * ONE table: its own fetch, its own filters, its own pagination. Nothing here is
 * lifted to the parent, which is what keeps twelve of these independent.
 */
function BrowserTableSection({
  config,
  supplierOptions,
  periods,
  reloadKey,
  onVoid,
  focusPo = null,
  onClearFocus,
}: {
  config: TableConfig;
  supplierOptions: ComboOption[];
  periods: string[];
  reloadKey: number;
  onVoid?: (poId: string) => void;
  /** Transient single-order filter, set by arriving from the correction form. */
  focusPo?: string | null;
  onClearFocus?: () => void;
}) {
  const [fSupplier, setFSupplier] = useState("");
  const [fPeriod, setFPeriod] = useState("all");

  // The amber highlight is an attention cue, not a state: it has done its job the
  // moment the user's pointer reaches the row, so it clears on first hover.
  const [highlightSpent, setHighlightSpent] = useState(false);
  const [prevFocus, setPrevFocus] = useState(focusPo);
  if (focusPo !== prevFocus) {
    setPrevFocus(focusPo);
    setHighlightSpent(false);
  }
  const highlightActive = !!focusPo && !highlightSpent;

  // Keyed result state rather than a loading flag set inside the effect — the same
  // shape SpendOverviewClient uses, so nothing sets state synchronously on mount.
  const key = `${config.table}#${reloadKey}`;
  const [loaded, setLoaded] = useState<{ key: string; rows: BrowserRow[] } | null>(null);
  const [errored, setErrored] = useState<{ key: string; msg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data-browser/${config.table}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          rows?: BrowserRow[];
          error?: string;
        };
        if (!res.ok || !data.rows) throw new Error(data.error ?? "Could not load this table.");
        return data.rows;
      })
      .then((rows) => {
        if (!cancelled) setLoaded({ key, rows });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setErrored({ key, msg: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, config.table]);

  const rows = loaded?.key === key ? loaded.rows : null;
  const error = errored?.key === key ? errored.msg : null;
  const loading = rows === null && error === null;

  const filtered = useMemo(() => {
    if (!rows) return [];
    // ⚠️ The focus filter REPLACES the others rather than composing with them: it
    // was handed a specific order to show, and a supplier or period filter left
    // over from earlier could hide the very row the user was sent here to see.
    if (focusPo) return rows.filter((r) => r.id === focusPo);
    return rows.filter(
      (r) =>
        (fSupplier === "" || r._supplierId === fSupplier) &&
        (fPeriod === "all" || r._period === fPeriod),
    );
  }, [rows, fSupplier, fPeriod, focusPo]);

  // Bring the handed-over row into view once its rows are on screen. No state is
  // set here, so this stays clear of the set-state-in-effect rule.
  useEffect(() => {
    if (!focusPo || !rows) return;
    const el = document.querySelector(`[data-po-row="${CSS.escape(focusPo)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusPo, rows]);

  const { page, setPage, pageCount, start, pageItems } = usePagination(
    filtered,
    ROSTER_PAGE_SIZE,
    `${fSupplier}|${fPeriod}`,
  );

  const colCount = config.columns.length + (config.voidable ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {/* No heading here — the collapsible shell already names the table. */}
      {focusPo && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--warning) 8%, transparent)",
          }}
        >
          <span>
            Showing one order — <span className="font-mono text-xs">{focusPo}</span>, sent here
            from the correction form because those fields cannot be corrected.
          </span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClearFocus}>
            Clear filter
          </Button>
        </div>
      )}

      {/* The ordinary filters are meaningless while a single order is pinned. */}
      <div className={`flex flex-wrap items-end gap-4 ${focusPo ? "hidden" : ""}`}>
        {config.supplierFilter && (
          <div className="flex min-w-[220px] flex-col gap-1.5">
            <Label htmlFor={`db-${config.table}-supplier`}>Supplier</Label>
            <TypeableCombobox
              id={`db-${config.table}-supplier`}
              aria-label={`Supplier filter for ${config.label}`}
              value={fSupplier}
              onChange={setFSupplier}
              options={supplierOptions}
              placeholder="All suppliers"
            />
          </div>
        )}

        {/* Absent, not disabled, where the table has no period dimension at all. */}
        {config.periodFilter && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`db-${config.table}-period`}>Period</Label>
            <div
              className="flex flex-wrap gap-1.5"
              id={`db-${config.table}-period`}
              role="radiogroup"
            >
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

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows && (
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
                    <TableCell colSpan={colCount} className="text-center text-muted-foreground">
                      No rows match the filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((r) => {
                    const isFocused = highlightActive && r.id === focusPo;
                    return (
                    // A voided row stays listed but reads as withdrawn.
                    <TableRow
                      key={r.id}
                      data-po-row={config.voidable ? r.id : undefined}
                      className={r._voided ? "opacity-55" : undefined}
                      // Amber marks WHICH row, so it is spent as soon as the pointer
                      // arrives — by then the user has found it.
                      onMouseEnter={() => highlightActive && setHighlightSpent(true)}
                      style={
                        isFocused
                          ? {
                              backgroundColor:
                                "color-mix(in srgb, var(--warning) 18%, transparent)",
                              transition: "background-color 400ms ease-out",
                            }
                          : { transition: "background-color 400ms ease-out" }
                      }
                    >
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
                          <Button variant="outline" size="sm" onClick={() => onVoid?.(r.id)}>
                            {r._voided ? "Un-void" : "Void"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })
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
