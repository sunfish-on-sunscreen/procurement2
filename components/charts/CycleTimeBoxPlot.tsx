"use client";

import type { CycleDistribution, CycleAnomaly } from "@/lib/analysis-types";
import { usePin } from "@/components/Reports/PinContext";
import { usePortalTooltip, PortalTooltip } from "./PortalTooltip";

/**
 * Single-population horizontal box plot of total cycle days: box = P25–P75,
 * line = median, whiskers = min–max, dots = Z-score outliers (> 2σ above mean).
 * Hand-composed SVG (Recharts has no native box plot), matching the codebase's
 * existing box-plot approach.
 */
export function CycleTimeBoxPlot({
  distribution: d,
  anomalies = [],
  interactive = false,
  onOutlierClick,
}: {
  distribution: CycleDistribution;
  anomalies?: CycleAnomaly[];
  // Outlier-dot pinning is meaningful only inside the report editor (which mounts
  // a PinProvider). On the standalone Cycle Time page it's off, so the dots are
  // plain non-interactive markers (no dead click). usePin() is still called
  // unconditionally (no-op without a provider) to keep hook order stable.
  interactive?: boolean;
  // Dashboard: clicking an outlier dot opens that supplier's detail panel. When
  // provided it takes precedence over the editor pin behaviour.
  onOutlierClick?: (supplierId: string) => void;
}) {
  const { pinnedSupplierId, pin } = usePin();
  const tooltip = usePortalTooltip<CycleAnomaly>();
  if (
    d.min == null ||
    d.max == null ||
    d.p25 == null ||
    d.p75 == null ||
    d.median == null
  ) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Not enough data to plot the distribution.
      </p>
    );
  }

  const outlierAnoms = anomalies.filter(
    (a): a is CycleAnomaly & { cycle_days: number } => a.cycle_days != null,
  );
  const outliers = outlierAnoms.map((a) => a.cycle_days);
  const dataMax = Math.max(d.max, ...(outliers.length ? outliers : [d.max]));
  const lo = Math.min(d.min, 0);
  const hi = dataMax;
  const pad = (hi - lo) * 0.06 || 1;
  const xmin = lo - pad;
  const xmax = hi + pad;

  const W = 560;
  const H = 200;
  const ml = 16;
  const mr = 16;
  const mt = 24;
  const mb = 40;
  const plotW = W - ml - mr;
  const cy = mt + (H - mt - mb) / 2;
  const boxH = 54;
  const x = (v: number) => ml + plotW * ((v - xmin) / (xmax - xmin));
  const ticks = Array.from({ length: 6 }, (_, i) => xmin + ((xmax - xmin) * i) / 5);
  // Theme-aware tokens (resolve in SVG fill/stroke, same as the codebase's other
  // charts). Box = primary chart colour; outliers = destructive.
  const color = "var(--chart-1)";
  const outlierColor = "var(--destructive)";

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[200px] w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Box plot of total cycle time in days, with outliers"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={x(t)}
              y1={mt}
              x2={x(t)}
              y2={H - mb}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={x(t)}
              y={H - mb + 16}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              {t.toFixed(0)}
            </text>
          </g>
        ))}
        <text
          x={ml}
          y={H - 6}
          fontSize={10}
          fill="currentColor"
          opacity={0.6}
        >
          total cycle days
        </text>

        {/* whiskers */}
        <line x1={x(d.min)} y1={cy} x2={x(d.p25)} y2={cy} stroke={color} strokeWidth={1.5} />
        <line x1={x(d.p75)} y1={cy} x2={x(d.max)} y2={cy} stroke={color} strokeWidth={1.5} />
        <line x1={x(d.min)} y1={cy - boxH / 3} x2={x(d.min)} y2={cy + boxH / 3} stroke={color} strokeWidth={1.5} />
        <line x1={x(d.max)} y1={cy - boxH / 3} x2={x(d.max)} y2={cy + boxH / 3} stroke={color} strokeWidth={1.5} />
        {/* box P25..P75 */}
        <rect
          x={x(d.p25)}
          y={cy - boxH / 2}
          width={Math.max(1, x(d.p75) - x(d.p25))}
          height={boxH}
          fill={color}
          fillOpacity={0.16}
          stroke={color}
          strokeWidth={1.5}
        />
        {/* median */}
        <line x1={x(d.median)} y1={cy - boxH / 2} x2={x(d.median)} y2={cy + boxH / 2} stroke={color} strokeWidth={2.5} />
        {/* outlier dots (slightly jittered around the axis) — hover to
            identify, click to pin the supplier (Batch 6b) */}
        {outlierAnoms.map((a, i) => {
          const hasSupplier = a.supplier_id != null;
          const canOpen = hasSupplier && onOutlierClick != null;
          const canPin = interactive && hasSupplier;
          const pinned = canPin && a.supplier_id === pinnedSupplierId;
          const dotCy = cy + (i % 2 === 0 ? -1 : 1) * (boxH / 2 + 8);
          return (
            <g
              key={a.po_id}
              style={{ cursor: canOpen || canPin ? "pointer" : "default" }}
              onMouseEnter={(e) => tooltip.show(e, a)}
              onMouseMove={(e) => tooltip.move(e)}
              onMouseLeave={tooltip.hide}
              onClick={
                canOpen
                  ? () => onOutlierClick(a.supplier_id)
                  : canPin
                    ? () => pin(a.supplier_id)
                    : undefined
              }
            >
              {pinned && (
                <circle
                  cx={x(a.cycle_days)}
                  cy={dotCy}
                  r={7}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={x(a.cycle_days)}
                cy={dotCy}
                r={pinned ? 4.5 : 3}
                fill={outlierColor}
                fillOpacity={0.7}
              />
            </g>
          );
        })}
        <text x={x(d.median)} y={mt - 8} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.7}>
          median {d.median.toFixed(0)}
        </text>
      </svg>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        Box = typical range · whiskers = range · line = median · red dots = outlier POs
      </p>
      {tooltip.tip && (
        <PortalTooltip x={tooltip.tip.x} y={tooltip.tip.y}>
          <div className="font-medium">{tooltip.tip.data.po_id}</div>
          <div className="text-muted-foreground">
            {tooltip.tip.data.supplier_name}
          </div>
          <div className="mt-1 text-muted-foreground">
            {tooltip.tip.data.cycle_days} days &middot; z{" "}
            {tooltip.tip.data.z_score.toFixed(2)}
          </div>
        </PortalTooltip>
      )}
    </div>
  );
}
