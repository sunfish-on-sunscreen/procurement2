"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { RangeAnalyses } from "@/lib/analysis-types";
import { OverviewCharts } from "./OverviewCharts";
import { AbcView } from "./AbcView";
import { SupplierSegmentsView } from "@/components/SupplierSegmentsView";
import { CycleTimeView } from "@/components/CycleTimeView";
import { EmptyState } from "@/components/EmptyState";

type View = "overview" | "abc" | "clustering" | "hypothesis";

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "done"; data: RangeAnalyses };

/**
 * Fetches /api/analyses/compute-range for a date span and renders the requested
 * view. Parents should pass a `key` derived from the dates so a new range
 * remounts this component back into the loading state.
 */
export function RangeCompute({
  kind,
  startDate,
  endDate,
}: {
  kind: View;
  startDate: string;
  endDate: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyses/compute-range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Compute failed");
        }
        return res.json() as Promise<RangeAnalyses>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Computing analyses for date range…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p className="text-sm text-destructive">
        Failed to compute analyses: {state.error}
      </p>
    );
  }

  if (kind === "overview") {
    return state.data.spend_overview ? (
      <OverviewCharts spend={state.data.spend_overview} />
    ) : (
      <EmptyState />
    );
  }
  if (kind === "abc") {
    return state.data.abc ? <AbcView abc={state.data.abc} /> : <EmptyState />;
  }
  if (kind === "clustering") {
    return state.data.clustering ? (
      <SupplierSegmentsView clustering={state.data.clustering} />
    ) : (
      <EmptyState />
    );
  }
  return state.data.hypothesis ? (
    <CycleTimeView hypothesis={state.data.hypothesis} />
  ) : (
    <EmptyState />
  );
}
