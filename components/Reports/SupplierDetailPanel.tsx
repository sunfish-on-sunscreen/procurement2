"use client";

import { X } from "lucide-react";
import type { SupplierDetail } from "@/lib/supplier-detail";
import { QUADRANT_COLORS, ZONE_COLORS, ABC_COLORS } from "@/lib/chart-colors";
import { Button } from "@/components/ui/button";

const usd = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);

const ACTION_COLORS: Record<string, string> = {
  engage: "#ef4444",
  review: "#f59e0b",
  mitigate: "#f97316",
  promote: "#10b981",
  demote: "#64748b",
  improve: "#3b82f6",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function Pill({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        color
          ? { backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`, color }
          : { backgroundColor: "var(--muted)" }
      }
    >
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </span>
  );
}

/**
 * Right-side slide-out drawer (Batch 6b) showing a pinned supplier's
 * cross-analysis profile. Renders over the report column only (the editor's
 * left settings sidebar stays usable). `no-print` so it never appears in PDFs.
 * Dismiss via the X, the backdrop, or Escape (wired by the parent).
 */
export function SupplierDetailPanel({
  detail,
  onClose,
}: {
  detail: SupplierDetail | null;
  onClose: () => void;
}) {
  if (!detail) return null;
  const d = detail;

  return (
    <div className="no-print absolute inset-0 z-30">
      {/* Backdrop: click to dismiss. */}
      <button
        type="button"
        aria-label="Close supplier detail"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-foreground/5"
      />
      <aside
        role="dialog"
        aria-label={`Supplier detail: ${d.supplier_name}`}
        className="absolute inset-y-0 right-0 flex w-80 flex-col border-l bg-background shadow-xl"
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {d.supplier_name}
            </h3>
            <p className="text-xs text-muted-foreground">{d.supplier_id}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Identity */}
          <section className="mb-4">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identity
            </h4>
            <Field label="Category" value={d.category ?? "—"} />
            <Field label="Country" value={d.country ?? "—"} />
          </section>

          {/* Key metrics */}
          <section className="mb-4">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Key metrics
            </h4>
            <Field label="Total spend" value={usd(d.total_spend_usd)} />
            <Field label="Invoice count" value={d.num_pos ?? "—"} />
            <Field
              label="Performance score"
              value={
                d.performance_score != null
                  ? d.performance_score.toFixed(1)
                  : "—"
              }
            />
            <Field
              label="Supply risk score"
              value={
                d.supply_risk_score != null
                  ? d.supply_risk_score.toFixed(1)
                  : "—"
              }
            />
          </section>

          {/* Classifications */}
          <section className="mb-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Classifications
            </h4>
            <div className="flex flex-wrap gap-2">
              {d.abc_class && (
                <Pill color={ABC_COLORS[d.abc_class]}>Class {d.abc_class}</Pill>
              )}
              {d.kraljic_quadrant && (
                <Pill color={QUADRANT_COLORS[d.kraljic_quadrant]}>
                  {d.kraljic_quadrant}
                </Pill>
              )}
              {d.performance_zone && (
                <Pill color={ZONE_COLORS[d.performance_zone]}>
                  {d.performance_zone}
                </Pill>
              )}
              {!d.abc_class &&
                !d.kraljic_quadrant &&
                !d.performance_zone && (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
            </div>
          </section>

          {/* Anomalies */}
          <section className="mb-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Anomalies involving this supplier
            </h4>
            {d.anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cycle-time anomalies this period.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.anomalies.map((a) => (
                  <li
                    key={a.po_id}
                    className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.po_id}</span>
                      <span className="font-semibold text-destructive">
                        z {a.z_score.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      {a.cycle_days ?? "—"} days
                      {a.invoice_date ? ` · ${a.invoice_date}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recommendations */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recommendations involving this supplier
            </h4>
            {d.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recommendations this period.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.recommendations.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-md border p-2 text-xs"
                    style={{
                      borderLeft: `3px solid ${ACTION_COLORS[r.action] ?? "#64748b"}`,
                    }}
                  >
                    <span className="font-semibold uppercase">{r.action}</span>
                    <p className="mt-0.5 text-muted-foreground">{r.reasoning}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
