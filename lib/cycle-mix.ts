import type { CycleTimeResult, MixAdjustedTransition } from "@/lib/analysis-types";

/** Display labels for the five buying methods. Shared so the per-method table and
 *  the glance prose can never disagree about how a method is named. */
export const METHOD_LABEL: Record<string, string> = {
  spot_buy: "Spot buy",
  call_off: "Call-off",
  rfq: "RFQ",
  tender: "Tender",
  direct: "Direct",
};

/**
 * Shared derivation for the MIX-ADJUSTED reading of the cycle-time trend.
 *
 * Pooled cycle time is a WEIGHTED MIXTURE of the buying methods (spot_buy ~44d ->
 * direct ~130d), so a shift in method composition can move the pooled number while
 * the methods themselves move the other way. Measured on this data in BOTH period
 * transitions, so a naive pooled reading is not safe.
 *
 * ⚠️ This is THE single definition of "does the decomposition contradict the pooled
 * trend, and which transition do we report". The Process Health glance and the report
 * generator both consume it, so they can never disagree about whether a trend is
 * misleading — only about how they word it. Do NOT re-inline this decision.
 *
 * Returns null when there is nothing to correct: a single-period window (no
 * transition computable), or a transition whose decomposition agrees with the pooled
 * reading — in which case the existing trend prose is already honest and a second
 * sentence would merely restate it.
 */
export type MixNoteFacts = {
  from: string;
  to: string;
  /** Pooled change in days (signed). */
  pooled: number;
  /** Sum of the within-method changes, weighted to the later period (signed). */
  within: number;
  /** The composition effect (signed). */
  mix: number;
  /** "magnitude_masked" = pooled looks flat while methods moved materially;
   *  "sign_reversal"    = pooled points the opposite way to the methods. */
  reason: "sign_reversal" | "magnitude_masked";
  /** "all 5" when every method moved with the within effect, else "most". */
  quantifier: string;
  /** What the methods did: "slowed" | "improved". */
  withinWord: "slowed" | "improved";
  /** What the pooled number appeared to do. */
  pooledWord: "was nearly flat" | "rose" | "fell";
};

/**
 * Transitions the SELECTED window should display: those that END inside it.
 * 2024 -> none (no 2023 to compare against) · 2025 -> 2024→2025 · 2026 -> 2025→2026 ·
 * a full range -> both.
 *
 * ⚠️ The transitions themselves are computed WINDOW-INDEPENDENTLY over the whole
 * table, so their numbers are identical on every window — only which rows are shown
 * changes. THE single filter, shared by the table and the glance sentence so they can
 * never show different transitions.
 */
export function visibleTransitions(
  cycleTime: CycleTimeResult | null | undefined,
  metric: "total" | "internal" = "total",
): MixAdjustedTransition[] {
  const mt = cycleTime?.mix_adjusted_trend;
  if (!mt || mt.insufficient_data) return [];
  const inWindow = new Set(mt.window_periods ?? []);
  return (mt.metrics[metric]?.transitions ?? []).filter((t) => inWindow.has(t.to));
}

/**
 * Why no within-window comparison ran, in the SAME words everywhere. An
 * "empty_group" window (e.g. every order placed in one half) must say so — silence
 * with no explanation reads as a missing feature rather than an honest absence.
 * Returns null when a test DID run.
 */
export function comparisonSkipText(
  reason: "empty_group" | "too_few" | null | undefined,
): string | null {
  if (reason === "empty_group")
    return "No within-window comparison is possible: every order in this window was placed in one half of it, so there is no second group to compare against.";
  if (reason === "too_few")
    return "There is not yet enough data in this window to compare two halves, so the trend is reported as monitoring only.";
  return null;
}

export function buildMixNoteFacts(cycleTime: CycleTimeResult | null | undefined): MixNoteFacts | null {
  // The most recent transition ENDING IN THE WINDOW is the one the headline refers to.
  const trs = visibleTransitions(cycleTime, "total");
  const t = trs.length ? trs[trs.length - 1] : null;
  if (!t || !t.pooled_misleading || !t.reason) return null;

  const pooled = t.pooled_change ?? 0;
  const within = t.within_effect ?? 0;
  const mix = t.mix_effect ?? 0;
  const movers = t.per_method.filter((m) => m.within_change != null);
  const sameDir = movers.filter((m) => (m.within_change as number) * within > 0).length;
  return {
    from: t.from,
    to: t.to,
    pooled,
    within,
    mix,
    reason: t.reason,
    quantifier: movers.length > 0 && sameDir === movers.length ? `all ${movers.length}` : "most",
    withinWord: within > 0 ? "slowed" : "improved",
    pooledWord:
      t.reason === "magnitude_masked" ? "was nearly flat" : pooled > 0 ? "rose" : "fell",
  };
}

/** Signed day delta, e.g. "+2.0d" / "−3.6d". `unit` lets prose use " days". */
export function mixDays(v: number, unit = "d"): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${unit}`;
}

/** Why the pooled number moved — the clause that names the cause. */
export function mixBecause(f: MixNoteFacts, longForm = false): string {
  const tail = longForm ? " buying methods, not from the process itself" : " methods";
  if (f.reason === "magnitude_masked") {
    return longForm
      ? "the difference is a shift in buying-method mix, not a change in process speed"
      : "the difference is a shift in method mix";
  }
  return `the ${f.pooled > 0 ? "rise" : "fall"} comes from a shift toward ${
    f.mix > 0 ? "slower" : "faster"
  }${tail}`;
}
