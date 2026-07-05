"use client";

import { usePin } from "@/components/Reports/PinContext";

/**
 * Custom Recharts <Scatter> dot (Batch 6b). Renders a clickable point that pins
 * its supplier and draws a ring when that supplier is the active cross-chart
 * pin. Reads the optional pin context, so on standalone dashboard pages (no
 * PinProvider) it renders a plain dot with a no-op click — identical to before.
 *
 * Optional props (Classification page, Change 4): `onSelect` fires on click in
 * addition to the (no-op off-report) pin, so a dot-click can open a supplier's
 * detail panel; `dimOpacity` lets the caller fade non-highlighted series when a
 * group is selected from the profile table.
 */
type PinnableDotProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: { supplier_id?: string };
  onSelect?: (id: string) => void;
  dimOpacity?: number;
};

export function PinnableDot({
  cx,
  cy,
  fill,
  payload,
  onSelect,
  dimOpacity = 0.85,
}: PinnableDotProps) {
  const { pinnedSupplierId, pin } = usePin();
  if (cx == null || cy == null) return null;
  const id = payload?.supplier_id;
  const pinned = id != null && id === pinnedSupplierId;
  const handleClick =
    id != null
      ? () => {
          pin(id);
          onSelect?.(id);
        }
      : undefined;
  return (
    <g
      style={{ cursor: id ? "pointer" : "default" }}
      onClick={handleClick}
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
        fillOpacity={dimOpacity}
      />
    </g>
  );
}
