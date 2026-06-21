"use client";

import { usePin } from "@/components/Reports/PinContext";

/**
 * Custom Recharts <Scatter> dot (Batch 6b). Renders a clickable point that pins
 * its supplier and draws a ring when that supplier is the active cross-chart
 * pin. Reads the optional pin context, so on standalone dashboard pages (no
 * PinProvider) it renders a plain dot with a no-op click — identical to before.
 */
type PinnableDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: { supplier_id?: string };
};

export function PinnableDot({ cx, cy, fill, payload }: PinnableDotProps) {
  const { pinnedSupplierId, pin } = usePin();
  if (cx == null || cy == null) return null;
  const id = payload?.supplier_id;
  const pinned = id != null && id === pinnedSupplierId;
  return (
    <g
      style={{ cursor: id ? "pointer" : "default" }}
      onClick={id ? () => pin(id) : undefined}
    >
      {pinned && (
        <circle
          cx={cx}
          cy={cy}
          r={9}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={pinned ? 5.5 : 4}
        fill={fill}
        fillOpacity={0.85}
      />
    </g>
  );
}
