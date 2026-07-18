/**
 * Spend X-axis display helpers for the Kraljic + Performance-vs-spend scatters.
 *
 * VIZ-ONLY: the points are still plotted at their `log_spend` value (so positions,
 * the median split, and every quadrant/zone assignment are byte-identical to the
 * compute output). We only RELABEL the axis as "% of total period spend": ticks
 * sit at the log positions of round percentage decades (0.01% · 0.1% · 1% · 10%),
 * and the formatter converts a log position back to its real percentage.
 *
 * `total` is the period's total spend in USD. A log position x maps to a percent
 * via `expm1(x) / total * 100` (inverse of `log1p(spend)`), and a target percent p
 * sits at `log1p(p/100 * total)`.
 */

/** Real percentage → label: <0.1% → 2dp, <1% → 1dp, ≥1% → 0dp, always "%". */
export function formatSpendPct(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.1) return `${p.toFixed(2)}%`;
  if (p < 1) return `${p.toFixed(1)}%`;
  return `${p.toFixed(0)}%`;
}

export type SpendAxis = {
  /** [min, max] in log_spend units, auto-fit to the data with small padding. */
  domain: [number, number] | undefined;
  /** Tick positions (log_spend units) at round percentage decades within range. */
  ticks: number[] | undefined;
  /** Formats a log position as its real percentage label. */
  tickFormatter: ((x: number) => string) | undefined;
};

/**
 * Build the %-labeled, log-spaced spend axis. Returns `undefined` fields (so the
 * caller falls back to Recharts auto) when there's no usable spend total.
 */
export function buildSpendAxis(logSpends: number[], total: number): SpendAxis {
  const logs = logSpends.filter((v) => Number.isFinite(v));
  if (logs.length === 0 || !Number.isFinite(total) || total <= 0) {
    return { domain: undefined, ticks: undefined, tickFormatter: undefined };
  }

  const minLog = Math.min(...logs);
  const maxLog = Math.max(...logs);
  const span = maxLog - minLog;
  // Small padding so the smallest/largest suppliers aren't flush to the edges
  // (fixes low-% suppliers being clipped off the left). Auto-fit — never hardcoded.
  const pad = Math.max(0.25, span * 0.04);
  const domain: [number, number] = [minLog - pad, maxLog + pad];

  const pctAt = (x: number) => (Math.expm1(x) / total) * 100;
  const posOfPct = (p: number) => Math.log1p((p / 100) * total);

  // Round percentage decades that fall inside the (padded) data range.
  const minP = pctAt(minLog);
  const maxP = pctAt(maxLog);
  const ticks: number[] = [];
  if (minP > 0 && maxP > 0) {
    const eLo = Math.floor(Math.log10(minP));
    const eHi = Math.ceil(Math.log10(maxP));
    for (let e = eLo; e <= eHi; e++) {
      const pos = posOfPct(10 ** e);
      if (pos >= domain[0] && pos <= domain[1]) ticks.push(pos);
    }
  }
  // Guarantee at least the two data extremes are labeled.
  if (ticks.length < 2) {
    ticks.length = 0;
    ticks.push(minLog, maxLog);
  }

  // Defuzz the log1p/expm1 round-trip (a decade tick lands at e.g. 0.9999999…)
  // so a clean 1% doesn't render as "1.0%" by slipping into the <1 branch.
  const snap = (p: number) => Number(p.toPrecision(10));
  return { domain, ticks, tickFormatter: (x: number) => formatSpendPct(snap(pctAt(x))) };
}

/** Compact spend money: ≥$1M → "$X.XM", else "$XXXK". */
export function formatSpendMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

/** Tooltip spend: money first, then real share of total spend at 2dp — "$28.4M (4.83%)". */
export function spendMoneyAndShare(spendUsd: number, total: number): string {
  const money = formatSpendMoney(spendUsd);
  if (!Number.isFinite(total) || total <= 0) return money;
  return `${money} (${((spendUsd / total) * 100).toFixed(2)}%)`;
}
