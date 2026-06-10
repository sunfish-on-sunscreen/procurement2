"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

const emptySubscribe = () => () => {};

/** True only after client hydration; avoids SSR chart-size mismatches. */
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Wraps a Recharts chart in a fixed-height ResponsiveContainer and defers
 * rendering until the client to avoid SSR/hydration size mismatches.
 */
export function ChartFrame({
  height = 300,
  children,
}: {
  height?: number;
  children: ReactElement;
}) {
  const hydrated = useHydrated();

  return (
    <div style={{ width: "100%", height }}>
      {hydrated ? (
        <ResponsiveContainer width="100%" height={height} minHeight={height}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
