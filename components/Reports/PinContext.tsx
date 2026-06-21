"use client";

import { createContext, useContext } from "react";

/**
 * Cross-chart pin state (Batch 6b). A single supplier can be "pinned" by
 * clicking its dot/bar/row in any report chart; every other chart then rings
 * that same supplier (cross-chart highlight), and a detail panel opens.
 *
 * The context is OPTIONAL: charts are shared with the standalone dashboard
 * pages (Overview/ABC/Kraljic/Cycle), which do NOT wrap a provider. Outside a
 * provider, `usePin` returns no-op defaults so those pages behave exactly as
 * before — the interactive layer only "lights up" inside the report editor,
 * which is the sole place that mounts a `PinProvider`.
 *
 * Identity key is `supplier_id` (stable), never `supplier_name`.
 */
export type PinContextValue = {
  pinnedSupplierId: string | null;
  /** Pin a supplier (replaces any existing pin — single-pin scope for 6b). */
  pin: (supplierId: string) => void;
  /** Clear the pin (panel dismiss, background click, period change). */
  clear: () => void;
};

const noop = () => {};

const PinContext = createContext<PinContextValue>({
  pinnedSupplierId: null,
  pin: noop,
  clear: noop,
});

export const PinProvider = PinContext.Provider;

export function usePin(): PinContextValue {
  return useContext(PinContext);
}

/** True when `supplierId` is the active pin. Safe with undefined/null ids. */
export function useIsPinned(supplierId?: string | null): boolean {
  const { pinnedSupplierId } = usePin();
  return supplierId != null && supplierId !== "" && pinnedSupplierId === supplierId;
}
