"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CycleTimeResult } from "@/lib/analysis-types";
import type { StageOccupancy, CycleCategoryRow } from "@/lib/cycle-time-types";
import { cardElevation } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StageOccupancyChart } from "@/components/charts/StageOccupancyChart";
import { StageByCategoryChart } from "@/components/charts/StageByCategoryChart";
import { StageDecompositionTable } from "@/components/CycleTime/StageDecompositionTable";

const STAGES = [
  { key: "pr_to_po", label: "PR to PO" },
  { key: "po_to_delivery", label: "PO to Delivery" },
  { key: "delivery_to_invoice", label: "Delivery to Invoice" },
  { key: "invoice_to_payment", label: "Invoice to Payment" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

// Plain-language description of each stage-gap (for the bottleneck paragraph).
const STAGE_DESC: Record<StageKey, string> = {
  pr_to_po: "from raising the requisition to issuing the PO",
  po_to_delivery: "from issuing the PO to goods arriving",
  delivery_to_invoice: "from delivery to invoicing",
  invoice_to_payment: "from invoicing to payment",
};

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

// Emphasised inline number (module scope — not created during render).
function Num({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

/**
 * Stage-focused insight tying the three visuals together (pipeline occupancy,
 * decomposition averages, category bars): a 4-paragraph, self-omitting prose
 * block. Every number is mean-based and computed from already-loaded data; each
 * paragraph drops if its data is absent. Data-honest — describes where the time
 * is, does not assert a root cause. The external/internal split framing assumes
 * the dominant stage is the supplier-fulfilment step (PO → Delivery); if some
 * other stage dominated it falls back to neutral wording.
 */
function StageInsight({
  cycleTime,
  categories,
}: {
  cycleTime: CycleTimeResult;
  categories: CycleCategoryRow[];
}) {
  const means = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    mean: cycleTime.stage_breakdown[s.key]?.mean ?? 0,
  }));
  const total = means.reduce((a, b) => a + b.mean, 0);
  if (total <= 0) return null;
  const ordered = [...means].sort((a, b) => b.mean - a.mean);
  const dom = ordered[0];
  const second = ordered[1];
  if (dom.mean <= second.mean) return null; // no clear single dominant stage

  const domKey = dom.key as StageKey;
  const pctOf = (m: number) => Math.round((m / total) * 100);
  const domPct = pctOf(dom.mean);
  const others = means.filter((m) => m.key !== domKey); // stage order preserved
  const sumOther = others.reduce((a, b) => a + b.mean, 0);
  const aboutSame = Math.abs(sumOther - dom.mean) / dom.mean < 0.25;
  const external = domKey === "po_to_delivery"; // the one supplier-side step
  const roughlyEven = domPct >= 40 && domPct <= 60;

  const catVal = (c: CycleCategoryRow) => c[domKey];
  const cats = categories.length ? [...categories].sort((a, b) => catVal(b) - catVal(a)) : [];
  const hasCats = cats.length >= 2;
  const top = cats.slice(0, Math.min(3, cats.length));
  const lowest = cats[cats.length - 1];

  return (
    <div
      className="mt-3 space-y-2 border-t pt-3 text-sm leading-relaxed text-muted-foreground"
      style={{ borderTopWidth: "0.5px" }}
    >
      {/* 1 — the bottleneck */}
      <p>
        <span className="text-foreground">{dom.label}</span> dominates the cycle —{" "}
        <Num>{domPct}% of the time</Num>, ~<Num>{dom.mean.toFixed(1)} days</Num>, the wait{" "}
        {STAGE_DESC[domKey]}. It&apos;s also the most-occupied stage every month, so it&apos;s the
        bottleneck by both duration and volume.
      </p>

      {/* 2 — all four stages */}
      <p>
        The other three are short and steady:{" "}
        {joinAnd(others.map((o) => `${o.label} ${o.mean.toFixed(1)} d (${pctOf(o.mean)}%)`))} —{" "}
        {external ? "internal steps" : "steps"} that together take ~<Num>{sumOther.toFixed(0)} days</Num>
        {aboutSame ? `, about the same as the single ${dom.label} wait` : ""}.
      </p>

      {/* 3 — top categories dragging the dominant stage */}
      {hasCats && (
        <p>
          The {dom.label} wait is driven by a few categories:{" "}
          {joinAnd(top.map((c) => `${c.category} (${catVal(c).toFixed(1)} d)`))} all run well above the{" "}
          {dom.mean.toFixed(1)}-day average, while{" "}
          <span className="text-foreground">{lowest.category}</span> ({catVal(lowest).toFixed(1)} d)
          sits below it.
        </p>
      )}

      {/* 4 — takeaway */}
      <p>
        {external && roughlyEven
          ? `So the cycle splits roughly evenly between the external ${dom.label} wait and internal handling — `
          : `So ${dom.label} is where the cycle concentrates — `}
        meaningful improvement means shortening {dom.label}
        {hasCats ? ` on the heaviest categories such as ${top[0].category}` : ""}, where the wait is
        longest.
      </p>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-sm font-medium text-muted-foreground">{children}</h4>;
}

/**
 * Merged "Stage breakdown" section (dashboard-only). Row 1: the procure-to-pay
 * pipeline chart (self-fetched, 303 whole-integer). Row 2 (50/50, stacks on
 * narrow): left = the decomposition table + the stage insight; right = the
 * per-category stacked bars. The decomposition table also renders in CycleTimeView
 * for reports (gated), so it is not shown twice on either surface.
 */
export function StageBreakdownSection({
  startDate,
  endDate,
  cycleTime,
  categories,
}: {
  startDate: string;
  endDate: string;
  cycleTime: CycleTimeResult;
  categories: CycleCategoryRow[];
}) {
  const key = `${startDate}_${endDate}`;
  const [state, setState] = useState<{ key: string; data?: StageOccupancy; err?: string } | null>(null);
  const current = state?.key === key ? state : null;

  useEffect(() => {
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch(`/api/cycle-time/stage-occupancy?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            ((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load",
          );
        }
        return res.json() as Promise<StageOccupancy>;
      })
      .then((d) => {
        if (!cancelled) setState({ key: k, data: d });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key: k, err: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Stage breakdown</CardTitle>
        <CardDescription>
          How the procure-to-pay cycle divides across its four stages — by month, on
          average, and by category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Row 1: pipeline chart */}
        <div>
          <SubHeading>Procure-to-pay pipeline, by month (POs active per stage, plus payments)</SubHeading>
          {current?.err ? (
            <p className="py-6 text-center text-sm text-destructive">{current.err}</p>
          ) : !current?.data ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading stage occupancy…
            </div>
          ) : current.data.months.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No PO activity in this period.
            </p>
          ) : (
            <StageOccupancyChart data={current.data.months} />
          )}
        </div>

        {/* Row 2: decomposition + insight (left) · category bars (right) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SubHeading>Average time per stage</SubHeading>
            <StageDecompositionTable data={cycleTime} />
            <StageInsight cycleTime={cycleTime} categories={categories} />
          </div>
          <div>
            <SubHeading>Stage time by category</SubHeading>
            <StageByCategoryChart rows={categories} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
