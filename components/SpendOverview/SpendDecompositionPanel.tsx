"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import type { SpendDetail } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { Button } from "@/components/ui/button";

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

type Tab = "byItem" | "pos";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {active && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

export function SpendDecompositionPanel({
  supplierId,
  onClose,
}: {
  supplierId: string | null;
  onClose: () => void;
}) {
  // Loaded/errored detail tagged with the supplier id, so loading is derived
  // (no synchronous setState in the effect).
  const [loaded, setLoaded] = useState<{ id: string; detail: SpendDetail } | null>(null);
  const [errored, setErrored] = useState<{ id: string; msg: string } | null>(null);
  const [tab, setTab] = useState<Tab>("byItem");
  const [itemSort, setItemSort] = useState<{ key: "poCount" | "itemDescription" | "totalSpend"; dir: "asc" | "desc" }>({ key: "totalSpend", dir: "desc" });
  const [poSort, setPoSort] = useState<{ key: "poId" | "itemDescription" | "date" | "quantity" | "unitPriceUsd" | "totalValueUsd"; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });

  const detail = supplierId && loaded?.id === supplierId ? loaded.detail : null;
  const error = supplierId && errored?.id === supplierId ? errored.msg : null;
  const loading = !!supplierId && !detail && !error;

  // Reset transient UI (tab + sorts) to defaults whenever the supplier changes.
  const [prevId, setPrevId] = useState(supplierId);
  if (prevId !== supplierId) {
    setPrevId(supplierId);
    setTab("byItem");
    setItemSort({ key: "totalSpend", dir: "desc" });
    setPoSort({ key: "date", dir: "desc" });
  }

  // Fetch on supplier change.
  useEffect(() => {
    if (!supplierId) return;
    const id = supplierId;
    let cancelled = false;
    fetch(`/api/suppliers/${id}/spend-detail`)
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Failed to load");
        }
        return res.json() as Promise<SpendDetail>;
      })
      .then((d) => {
        if (!cancelled) setLoaded({ id, detail: d });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setErrored({ id, msg: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  // ESC closes.
  useEffect(() => {
    if (!supplierId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supplierId, onClose]);

  const sortedItems = useMemo(() => {
    if (!detail) return [];
    return [...detail.byItem].sort((a, b) => {
      const av = a[itemSort.key];
      const bv = b[itemSort.key];
      const c =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return itemSort.dir === "asc" ? c : -c;
    });
  }, [detail, itemSort]);

  const sortedPos = useMemo(() => {
    if (!detail) return [];
    const dateOf = (p: SpendDetail["pos"][number]) => p.invoiceDate ?? p.prDate ?? "";
    return [...detail.pos].sort((a, b) => {
      let c: number;
      if (poSort.key === "date") c = dateOf(a).localeCompare(dateOf(b));
      else {
        const av = a[poSort.key];
        const bv = b[poSort.key];
        c =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
      }
      return poSort.dir === "asc" ? c : -c;
    });
  }, [detail, poSort]);

  if (!supplierId) return null;

  const s = detail?.supplier;
  const st = detail?.stats;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close spend decomposition"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-foreground/10"
      />
      <aside
        role="dialog"
        aria-label="Spend decomposition"
        className="absolute inset-y-0 right-0 flex w-[420px] max-w-[92vw] flex-col border-l bg-background shadow-xl"
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {s?.name ?? "Loading…"}
            </h3>
            {s && (
              <p className="truncate text-xs text-muted-foreground">
                {[s.category, s.tier, s.country].filter(Boolean).join(" · ") || s.id}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {loading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading spend detail…
          </div>
        )}
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}

        {detail && st && s && (
          <>
            <div className="grid grid-cols-3 gap-3 border-b p-4">
              <Stat label="Total spend" value={usd0.format(st.totalSpend)} />
              <Stat label="POs" value={String(st.poCount)} />
              <Stat label="Avg PO" value={usd0.format(st.avgPoValue)} />
              <Stat
                label="Date range"
                value={
                  st.earliestDate && st.latestDate
                    ? `${st.earliestDate} → ${st.latestDate}`
                    : "—"
                }
              />
              <Stat
                label="ABC"
                value={s.abcClass ?? "—"}
              />
              <Stat label="Kraljic" value={s.kraljicQuadrant ?? "—"} />
            </div>
            {/* colored badges row */}
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {s.abcClass && (
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${ABC_COLORS[s.abcClass]}22`, color: ABC_COLORS[s.abcClass] }}>
                  Class {s.abcClass}
                </span>
              )}
              {s.kraljicQuadrant && (
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${QUADRANT_COLORS[s.kraljicQuadrant]}22`, color: QUADRANT_COLORS[s.kraljicQuadrant] }}>
                  {s.kraljicQuadrant}
                </span>
              )}
            </div>

            <div className="flex gap-1 border-b px-4 pt-3">
              {([["byItem", "Spend by item"], ["pos", "All POs"]] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                    tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-4">
              {tab === "byItem" ? (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <SortHeader label="POs" align="right" active={itemSort.key === "poCount"} dir={itemSort.dir} onClick={() => setItemSort((s2) => ({ key: "poCount", dir: s2.key === "poCount" && s2.dir === "desc" ? "asc" : "desc" }))} />
                      <SortHeader label="Item" active={itemSort.key === "itemDescription"} dir={itemSort.dir} onClick={() => setItemSort((s2) => ({ key: "itemDescription", dir: s2.key === "itemDescription" && s2.dir === "asc" ? "desc" : "asc" }))} />
                      <SortHeader label="Total spend" align="right" active={itemSort.key === "totalSpend"} dir={itemSort.dir} onClick={() => setItemSort((s2) => ({ key: "totalSpend", dir: s2.key === "totalSpend" && s2.dir === "desc" ? "asc" : "desc" }))} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((it) => (
                      <tr key={it.itemDescription} className="border-b">
                        <td className="py-1.5 text-right text-muted-foreground">{it.poCount}</td>
                        <td className="py-1.5">{it.itemDescription}</td>
                        <td className="py-1.5 text-right">{usd0.format(it.totalSpend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <SortHeader label="PO ID" active={poSort.key === "poId"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "poId", dir: s2.key === "poId" && s2.dir === "asc" ? "desc" : "asc" }))} />
                      <SortHeader label="Item" active={poSort.key === "itemDescription"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "itemDescription", dir: s2.key === "itemDescription" && s2.dir === "asc" ? "desc" : "asc" }))} />
                      <SortHeader label="Date" active={poSort.key === "date"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "date", dir: s2.key === "date" && s2.dir === "desc" ? "asc" : "desc" }))} />
                      <SortHeader label="Qty" align="right" active={poSort.key === "quantity"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "quantity", dir: s2.key === "quantity" && s2.dir === "desc" ? "asc" : "desc" }))} />
                      <SortHeader label="Unit $" align="right" active={poSort.key === "unitPriceUsd"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "unitPriceUsd", dir: s2.key === "unitPriceUsd" && s2.dir === "desc" ? "asc" : "desc" }))} />
                      <SortHeader label="Total" align="right" active={poSort.key === "totalValueUsd"} dir={poSort.dir} onClick={() => setPoSort((s2) => ({ key: "totalValueUsd", dir: s2.key === "totalValueUsd" && s2.dir === "desc" ? "asc" : "desc" }))} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPos.map((p) => (
                      <tr key={p.poId} className="border-b">
                        <td className="py-1.5 font-medium">{p.poId}</td>
                        <td className="py-1.5">{p.itemDescription}</td>
                        <td className="py-1.5 text-muted-foreground">{p.invoiceDate ?? p.prDate ?? "—"}</td>
                        <td className="py-1.5 text-right">{num.format(p.quantity)}</td>
                        <td className="py-1.5 text-right">{usd2.format(p.unitPriceUsd)}</td>
                        <td className="py-1.5 text-right">{usd0.format(p.totalValueUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
