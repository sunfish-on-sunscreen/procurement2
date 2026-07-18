"use client";

import { createPortal } from "react-dom";
import { useCallback, useState } from "react";

/**
 * Cursor-following tooltip rendered through a portal to document.body
 * (Batch 6b). Used by hand-composed SVG charts where Recharts' own Tooltip is
 * unavailable and an in-SVG <foreignObject> would be clipped by the viewBox.
 * Position tracks the pointer via mousemove; flips to the cursor's left when it
 * would overflow the right edge.
 */
export function usePortalTooltip<T>() {
  const [tip, setTip] = useState<{ x: number; y: number; data: T } | null>(
    null,
  );
  const show = useCallback(
    (e: { clientX: number; clientY: number }, data: T) =>
      setTip({ x: e.clientX, y: e.clientY, data }),
    [],
  );
  const move = useCallback(
    (e: { clientX: number; clientY: number }) =>
      setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    [],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, move, hide };
}

export function PortalTooltip({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  // The tooltip only renders in response to a pointer hover (client-side, after
  // hydration), so document is always available here — no mount gate needed.
  if (typeof document === "undefined") return null;

  const W = 240;
  const offset = 14;
  const overflowRight =
    typeof window !== "undefined" && x + offset + W > window.innerWidth;
  const left = overflowRight ? x - offset - W : x + offset;

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 rounded-md border bg-background p-2 text-xs shadow-md"
      style={{ left, top: y + offset, maxWidth: W }}
    >
      {children}
    </div>,
    document.body,
  );
}
