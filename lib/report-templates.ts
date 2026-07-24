import type {
  SpendOverviewResult,
  AbcResult,
  KraljicResult,
  KraljicQuadrant,
  QuadrantProfile,
  CycleTimeResult,
  PerformanceSpendResult,
  RecommendationsResult,
  Recommendation,
} from "@/lib/analysis-types";
import type { ReportTone } from "@/lib/report-config";
import { buildMixNoteFacts, mixDays, mixBecause, METHOD_LABEL, comparisonSkipText } from "@/lib/cycle-mix";
import {
  buildSpendConcentration,
  ratioLabel,
  EVEN_REFERENCE_PCT,
  PARETO_REFERENCE_PCT,
  type SpendConcentration,
} from "@/lib/spend-concentration";

/**
 * Shape of a persisted report's `metricsJson`. The report renders LIVE from the
 * analyses (ReportDocument + lib/report-narrative), so the only fields the detail
 * page reads are `config` (customization, added at store time) and `cycle_framing`
 * (the Batch-5 marker). `narratives.cycle_time` survives only to render LEGACY
 * pre-Batch-5 reports' stored cycle prose. (The old generateExecutiveSummary that
 * built a full stored narrative was dropped — the markdown was never displayed.)
 */
export type ReportMetrics = {
  cycle_framing?: "monitoring";
  narratives?: { cycle_time?: string };
};

const intl = new Intl.NumberFormat("en-US");
const usdM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;
const pct = (n: number) => `${n.toFixed(1)}%`;

function effectWord(r: number | null): string {
  if (r == null) return "—";
  const a = Math.abs(r);
  if (a < 0.1) return "negligible";
  if (a < 0.3) return "small";
  if (a < 0.5) return "medium";
  return "large";
}

// ============================================================================
// Tone variants (Batch 3d) — render-time narrative templates.
// deriveReportContext() pulls every stat the prose needs out of the analyses;
// TEMPLATES[tone][section](ctx) turns that context into prose. The operational
// templates reproduce the long-standing report voice (and back generateExecutive-
// Summary so the stored markdown matches what the report renders).
// ============================================================================

export type ReportContext = {
  period: string;
  // headline
  totalSpend: number;
  totalPos: number;
  activeSuppliers: number;
  avgCycle: number;
  // spend
  cat1: string;
  cat1Pct: number;
  cat2: string;
  cat2Pct: number;
  monthlyMin: number;
  monthlyMax: number;
  top10Pct: number;
  // abc
  aN: number;
  aPct: number;
  bN: number;
  bPct: number;
  cN: number;
  cPct: number;
  // Supplier-spend concentration — the DIRECT Pareto test (top-fifth share), shared
  // with the dashboard via lib/spend-concentration so the two surfaces cannot disagree.
  // ⚠️ Do NOT judge concentration from aPct: Class A is DEFINED as the suppliers
  // covering the first 80% of spend, so aPct is pinned near 80% by construction and
  // measures the cut-point, not the distribution. null on an empty/zero window.
  conc: SpendConcentration | null;
  // kraljic
  stratN: number;
  stratPct: number;
  levN: number;
  levPct: number;
  bottN: number;
  routN: number;
  strategicNames: string[];
  spendMedianLog: number;
  riskMedian: number;
  // performance
  starsN: number;
  criticalN: number;
  criticalPct: number;
  gemsN: number;
  criticalNames: string[];
  gemNames: string[];
  perfMedian: number;
  // cycle — process-health monitoring
  cycleN: number;
  cycleMedian: number;
  cycleMean: number;
  cycleP25: number;
  cycleP75: number;
  cycleIqr: number;
  slowestStage: string;
  slowestStageMean: number;
  anomalyCount: number;
  topAnomaly: { po_id: string; supplier_name: string; cycle_days: number } | null;
  worstMatchQuadrant: string | null;
  worstMatchRate: number | null;
  // cycle — optional period-vs-period comparison
  cmpInsufficient: boolean;
  cmpMedianA: number;
  cmpMedianB: number;
  cmpDelta: number; // median_a - median_b (positive = faster/improved in B)
  cmpDpct: number;
  cmpPValue: number | null;
  cmpPStr: string;
  cmpEffect: string;
  cmpEffectSize: number | null;
  cmpSignificant: boolean;
  cmpNA: number;
  cmpNB: number;
  cmpLabelA: string;
  cmpLabelB: string;
  /**
   * Mix-adjusted corrective for the cycle-time trend, or null when the pooled
   * reading is safe. Pooled cycle time is a WEIGHTED MIXTURE of the buying methods,
   * so a shift in composition can move it while the methods themselves go the other
   * way. Non-null ONLY when the shift-share decomposition contradicts the pooled
   * direction — so a report can never assert a trend the decomposition reverses.
   */
  mixNote: string | null;
  /** Why the pooled midpoint test was skipped, if it was. */
  cmpSkipReason: "empty_group" | "too_few" | null;
  /** Minimum detectable effect (probability of superiority) at 80% power — makes a
   *  null result informative instead of silent. */
  cmpMdeA: number | null;
  /** The one per-method change that survives BH correction AND the power floor,
   *  pre-rendered. Null when nothing survives (the usual case). */
  methodFinding: string | null;
  // recommendations
  recTotal: number;
  recByCategory: Record<string, number>;
  topRec: Recommendation | null;
};

type Analyses = {
  spendOverview: SpendOverviewResult | null;
  abc: AbcResult | null;
  kraljic: KraljicResult | null;
  performanceSpend: PerformanceSpendResult | null;
  cycleTime: CycleTimeResult | null;
  recommendations: RecommendationsResult | null;
};

const STAGE_LABELS: Record<string, string> = {
  pr_to_po: "PR to PO",
  po_to_delivery: "PO to Delivery",
  delivery_to_invoice: "Delivery to Invoice",
  invoice_to_payment: "Invoice to Payment",
};

export function deriveReportContext(a: Analyses, period: string): ReportContext {
  const s = a.spendOverview;
  const cats = s?.by_category ?? [];
  const catGrand = cats.reduce((x, c) => x + c.total, 0) || s?.total_spend || 1;
  const months = (s?.monthly_trend ?? []).map((m) => m.total);
  const top10 = (s?.top_suppliers ?? []).reduce((x, t) => x + t.total, 0);

  const abc = a.abc;
  const A = abc?.summary.A ?? { n: 0, pct_of_spend: 0 };
  const B = abc?.summary.B ?? { n: 0, pct_of_spend: 0 };
  const C = abc?.summary.C ?? { n: 0, pct_of_spend: 0 };
  const kr = a.kraljic;
  const qprof = (q: KraljicQuadrant): QuadrantProfile =>
    kr?.quadrant_profiles.find((p) => p.quadrant === q) ?? {
      quadrant: q,
      n_suppliers: 0,
      total_spend: 0,
      pct_of_total_spend: 0,
      avg_performance_score: 0,
    };
  const strat = qprof("Strategic");
  const lev = qprof("Leverage");
  const strategicNames = (kr?.quadrant_assignments ?? [])
    .filter((x) => x.quadrant === "Strategic")
    .slice(0, 2)
    .map((x) => x.supplier_name);
  const ps = a.performanceSpend;
  const zone = (z: string) => ps?.zone_profiles.find((p) => p.zone === z);
  const stars = zone("Stars");
  const critical = zone("Critical Issues");
  const gems = zone("Hidden Gems");

  const ct = a.cycleTime;
  const dist = ct?.distribution;
  const stages = ct?.stage_breakdown;
  const slowest =
    stages != null
      ? (Object.entries(stages) as [string, { mean: number | null }][])
          .map(([k, v]) => ({ key: k, mean: v.mean ?? 0 }))
          .sort((x, y) => y.mean - x.mean)[0]
      : null;
  const anomalies = ct?.anomalies ?? [];
  const worstMatch = ct
    ? (Object.entries(ct.three_way_match_by_quadrant).find(
        ([, v]) => v.is_worst,
      ) ?? null)
    : null;

  const cmp = ct?.period_comparison;
  const cmpMedianA = cmp?.median_a ?? 0;
  const cmpMedianB = cmp?.median_b ?? 0;
  const cmpDelta = cmpMedianA - cmpMedianB; // positive => faster in window B
  const cmpPValue = cmp?.p_value ?? null;
  const cmpPStr =
    cmpPValue != null && cmpPValue < 0.001
      ? "< 0.001"
      : `= ${cmpPValue != null ? cmpPValue.toFixed(4) : "—"}`;
  const cmpSignificant =
    !(cmp?.insufficient_data ?? true) && cmpPValue != null && cmpPValue < 0.05;

  const recs = a.recommendations;

  // Mix-adjusted corrective — see ReportContext.mixNote. Uses the most recent
  // transition in the window; null when the window holds < 2 periods or when the
  // decomposition agrees with the pooled reading.
  const cmpSkipReason = cmp?.skip_reason ?? null;
  const cmpMdeA = cmp?.mde_a ?? null;
  const msig = ct?.method_significance;
  const surv = msig?.findings?.[0] ?? null;
  const methodFinding = surv
    ? `${METHOD_LABEL[surv.method] ?? surv.method} orders completed ${surv.direction} in ${surv.to} than ${surv.from} — median ${surv.median_from} to ${surv.median_to} days (Mann-Whitney p = ${(surv.p_value ?? 0).toFixed(3)}, Benjamini-Hochberg q = ${(surv.q_value ?? 0).toFixed(3)}, power ${(surv.power ?? 0).toFixed(2)}); the only one of ${msig?.tested ?? 0} per-method tests to survive correction.`
    : null;

  const mixFacts = buildMixNoteFacts(ct);
  const mixNote = mixFacts
    ? ` Read that trend with care: from ${mixFacts.from} to ${mixFacts.to} pooled cycle time ${
        mixFacts.pooledWord
      } (${mixDays(mixFacts.pooled, " days")}), but ${mixFacts.quantifier} buying methods ${
        mixFacts.withinWord
      } (${mixDays(mixFacts.within, " days")}) — ${mixBecause(mixFacts, true)}.`
    : null;

  return {
    period,
    totalSpend: s?.total_spend ?? 0,
    totalPos: s?.total_pos ?? 0,
    activeSuppliers: s?.active_suppliers ?? 0,
    avgCycle: s?.avg_cycle_time ?? 0,
    cat1: cats[0]?.category ?? "—",
    cat1Pct: cats[0] ? (cats[0].total / catGrand) * 100 : 0,
    cat2: cats[1]?.category ?? "—",
    cat2Pct: cats[1] ? (cats[1].total / catGrand) * 100 : 0,
    monthlyMin: months.length ? Math.min(...months) : 0,
    monthlyMax: months.length ? Math.max(...months) : 0,
    top10Pct: s?.total_spend ? (top10 / s.total_spend) * 100 : 0,
    aN: A.n,
    aPct: A.pct_of_spend * 100,
    conc: buildSpendConcentration(abc),
    bN: B.n,
    bPct: B.pct_of_spend * 100,
    cN: C.n,
    cPct: C.pct_of_spend * 100,
    stratN: strat.n_suppliers,
    stratPct: strat.pct_of_total_spend,
    levN: lev.n_suppliers,
    levPct: lev.pct_of_total_spend,
    bottN: qprof("Bottleneck").n_suppliers,
    routN: qprof("Routine").n_suppliers,
    strategicNames,
    spendMedianLog: kr?.axis_thresholds.spend_median ?? 0,
    riskMedian: kr?.axis_thresholds.risk_median ?? 0,
    starsN: stars?.n_suppliers ?? 0,
    criticalN: critical?.n_suppliers ?? 0,
    criticalPct: critical?.pct_of_total_spend ?? 0,
    gemsN: gems?.n_suppliers ?? 0,
    criticalNames: (ps?.top_critical_issues ?? [])
      .slice(0, 2)
      .map((x) => x.supplier_name),
    gemNames: (ps?.top_hidden_gems ?? []).slice(0, 2).map((x) => x.supplier_name),
    perfMedian: ps?.axis_thresholds.performance_median ?? 0,
    cycleN: dist?.n ?? 0,
    cycleMedian: dist?.median ?? 0,
    cycleMean: dist?.mean ?? 0,
    cycleP25: dist?.p25 ?? 0,
    cycleP75: dist?.p75 ?? 0,
    cycleIqr: dist?.iqr ?? 0,
    slowestStage: slowest ? STAGE_LABELS[slowest.key] ?? slowest.key : "—",
    slowestStageMean: slowest?.mean ?? 0,
    anomalyCount: anomalies.length,
    topAnomaly: anomalies[0]
      ? {
          po_id: anomalies[0].po_id,
          supplier_name: anomalies[0].supplier_name,
          cycle_days: anomalies[0].cycle_days ?? 0,
        }
      : null,
    worstMatchQuadrant: worstMatch ? worstMatch[0] : null,
    worstMatchRate: worstMatch ? worstMatch[1].pass_rate_pct : null,
    cmpInsufficient: cmp?.insufficient_data ?? true,
    cmpMedianA,
    cmpMedianB,
    cmpDelta,
    cmpDpct: cmpMedianA ? (cmpDelta / cmpMedianA) * 100 : 0,
    cmpPValue,
    cmpPStr,
    cmpEffect: cmp?.effect_size_label ?? effectWord(cmp?.rank_biserial_r ?? null),
    cmpEffectSize: cmp?.rank_biserial_r ?? null,
    cmpSignificant,
    cmpNA: cmp?.period_a.n ?? 0,
    cmpNB: cmp?.period_b.n ?? 0,
    cmpLabelA: cmp ? `${cmp.period_a.start} – ${cmp.period_a.end}` : "—",
    cmpLabelB: cmp ? `${cmp.period_b.start} – ${cmp.period_b.end}` : "—",
    mixNote,
    cmpSkipReason,
    cmpMdeA,
    methodFinding,
    recTotal: recs?.summary_stats.total_recommendations ?? 0,
    recByCategory: recs?.summary_stats.by_category ?? {},
    topRec: recs?.summary_stats.highest_impact ?? null,
  };
}

type SectionTemplates = {
  cover: (c: ReportContext) => string;
  spendOverview: (c: ReportContext) => string;
  abc: (c: ReportContext) => string;
  kraljic: (c: ReportContext) => string;
  performanceSpend: (c: ReportContext) => string;
  cycleTime: (c: ReportContext) => string;
  keyFindings: (c: ReportContext) => string[];
  recommendedPriorities: (c: ReportContext) => string;
  methodology: (c: ReportContext) => string;
};

/** Why no pooled test ran. "empty_group" means one half of the window contains no
 *  orders at all, so no comparison exists — never phrase that as stability. */
function skipClause(c: ReportContext): string {
  // Shared wording — the dashboard glance says the same thing via the same helper.
  return ` ${comparisonSkipText(c.cmpSkipReason) ?? comparisonSkipText("too_few")}`;
}

/** A null reported WITH its minimum detectable effect, so the silence is informative. */
function nullClause(c: ReportContext): string {
  const mde = c.cmpMdeA != null ? ` — detecting one would take a probability of superiority of about ${c.cmpMdeA.toFixed(2)} at 80% power` : "";
  return ` No statistically detectable change across the window${mde}.`;
}

/** ⚠️ A significant POOLED result is still a MIXTURE result: cycle time is
 *  near-deterministic in buying method, so a pooled shift can reflect a change in
 *  method composition rather than in process speed. Never instruct anyone to chase a
 *  process regression off this test alone — point at the per-method view instead. */
function pooledShiftClause(c: ReportContext): string {
  return ` The pooled median moved from ${c.cmpMedianA.toFixed(0)} to ${c.cmpMedianB.toFixed(0)} days across the window (p ${c.cmpPStr}). This is a POOLED comparison, so it cannot separate a change in process speed from a change in buying-method mix — read it against the per-method breakdown before acting.`;
}

// ⚠️ CONCENTRATION-FRAMING NOTE. `cover` below already scales its adjective to the
// data (the guard on the next lines) — but `cover` is INERT (the argument-based report
// never renders it). The RENDERED methods (spendOverview, abc) shipped WITHOUT that
// guard and asserted "small set / small group / 80-20" unconditionally, which is false
// on a broad base. The guard existed; it was simply in the one method that doesn't
// render. Fixed 2026-07-24 by threading `c.conc` (the top-fifth Pareto test, shared
// with the dashboard via lib/spend-concentration) into the rendered methods. `cover`
// is left untouched — do not revive it just to reconcile the two.
export const TEMPLATES: Record<ReportTone, SectionTemplates> = {
  // ---- EXECUTIVE: CFO/COO. Strategic, short, business-impact framed, no names.
  executive: {
    cover: (c) => {
      // Scale the adjective to the actual top-10 share — don't hardcode "highly
      // concentrated" (it would contradict a genuinely distributed base).
      const concentration =
        c.top10Pct >= 80
          ? "highly concentrated"
          : c.top10Pct >= 60
            ? "concentrated"
            : "relatively distributed";
      return `${c.period} procurement spend totalled ${usdM(c.totalSpend)} across ${intl.format(
        c.activeSuppliers,
      )} active suppliers. Value is ${concentration} — the ten largest relationships absorb ${pct(
        c.top10Pct,
      )} of outlay — so the agenda is straightforward: protect the few suppliers that matter, apply scale where the market is competitive, and close the process gaps that tie up working capital.`;
    },
    spendOverview: (c) => {
      // Frame it as TWO markets only when both categories are genuinely large.
      // A large cat1 with a small cat2 is single-market dominance (one exposure);
      // if the top-2 share isn't high, just name the largest categories.
      const top2 = c.cat1Pct + c.cat2Pct;
      const CAT2_LARGE = 15;
      let lead: string;
      if (top2 >= 55 && c.cat2Pct >= CAT2_LARGE) {
        lead = `Spend is dominated by ${c.cat1} (${pct(c.cat1Pct)}) and ${c.cat2} (${pct(
          c.cat2Pct,
        )}), leaving the organisation materially exposed to those two markets.`;
      } else if (top2 >= 55) {
        lead = `Spend is dominated by ${c.cat1} (${pct(c.cat1Pct)}), with ${c.cat2} (${pct(
          c.cat2Pct,
        )}) a distant second.`;
      } else {
        lead = `The largest categories are ${c.cat1} (${pct(c.cat1Pct)}) and ${c.cat2} (${pct(
          c.cat2Pct,
        )}).`;
      }
      // ⚠️ Was an unconditional "concentrated in a small set of relationships" — false
      // on a broad base (top-fifth 40% here). Scale it to the observed top-fifth share,
      // shared with the dashboard so the two cannot disagree.
      const conc = c.conc;
      const supplier = conc
        ? conc.meetsPareto
          ? ` The top fifth of suppliers carry ${conc.topSharePct.toFixed(
              0,
            )}% of spend (${ratioLabel(conc)}), so leverage and continuity risk sit with a small set of relationships.`
          : ` The top fifth of suppliers carry ${conc.topSharePct.toFixed(
              0,
            )}% of spend — a ${ratioLabel(conc)} split against the textbook ${EVEN_REFERENCE_PCT}/${PARETO_REFERENCE_PCT} — so leverage is spread across a broad base, not a few relationships.`
        : "";
      return `${lead}${supplier}`;
    },
    abc: (c) => {
      // ⚠️ aN (Class-A count) is NOT "a small group" on this data — 30 suppliers is
      // ~55% of the roster. Whether it is small is the top-fifth test, not the count.
      const conc = c.conc;
      const opener =
        conc && !conc.meetsPareto
          ? `Class A is a broad group here, not a select few: ${c.aN} suppliers account for ${pct(
              c.aPct,
            )} of spend, and even the top fifth hold ${conc.topSharePct.toFixed(
              0,
            )}% (${ratioLabel(conc)} against the textbook ${EVEN_REFERENCE_PCT}/${PARETO_REFERENCE_PCT})`
          : `${c.aN} Class-A suppliers account for ${pct(c.aPct)} of spend`;
      return `${opener}, while the long tail of ${c.cN} contributes only ${pct(
        c.cPct,
      )}. The priority is to govern the high-value group tightly.`;
    },
    kraljic: (c) =>
      `Mapped by value and replaceability, ${c.stratN} suppliers are business-critical and hard to replace, holding ${pct(
        c.stratPct,
      )} of spend; another ${c.levN} carry comparable spend but sit in competitive markets (${pct(
        c.levPct,
      )}). The strategic group warrants board-level relationship ownership; the competitive group is where buying power should translate into better terms.`,
    performanceSpend: (c) => {
      // No Critical-Issues suppliers → self-omit the "value-at-risk / first call"
      // assertion (it assumes a non-empty critical zone).
      if (c.criticalN === 0) {
        return `Crossing spend against delivered performance flags no high-value suppliers underperforming relative to what we pay them — the high-spend base is performing in line with expectations.`;
      }
      return `Crossing spend against delivered performance flags ${c.criticalN} high-value supplier(s) — ${pct(
        c.criticalPct,
      )} of spend — that are underperforming relative to what we pay them. These represent the clearest value-at-risk in the portfolio and the first call on management attention.`;
    },
    cycleTime: (c) => {
      const head = `Procure-to-pay cycle time runs at a median of ${c.cycleMedian.toFixed(
        0,
      )} days (middle-half spread ${c.cycleP25.toFixed(0)}–${c.cycleP75.toFixed(
        0,
      )} days).`;
      if (c.cmpInsufficient) {
        return `${head}${skipClause(c)}${c.methodFinding ? ` ${c.methodFinding}` : ""}`;
      }
      const body = c.cmpSignificant ? pooledShiftClause(c) : nullClause(c);
      return `${head}${body} Sustained monitoring keeps working-capital efficiency on track.${
        c.methodFinding ? ` ${c.methodFinding}` : ""
      }${c.mixNote ?? ""}`;
    },
    keyFindings: (c) => [
      `Value is concentrated: the top ten suppliers carry ${pct(c.top10Pct)} of spend.`,
      `${c.stratN} business-critical suppliers hold ${pct(c.stratPct)} of spend and need protected relationships.`,
      `${c.criticalN} high-value supplier(s) are underperforming — the portfolio's main value-at-risk.`,
      `Procure-to-pay cycle time holds at a median of ${c.cycleMedian.toFixed(0)} days.${
        c.cmpInsufficient || !c.cmpSignificant
          ? " No statistically detectable change across the window."
          : " The pooled median shifted, but pooled comparisons cannot separate process speed from buying-method mix."
      }${c.mixNote ? " Method mix moved; see the cycle-time note." : ""}`,
    ],
    recommendedPriorities: (c) =>
      `The actions below are organised by the three diagnostic analyses — Spend, Suppliers, and Process — with the highest-exposure items first in each. They concentrate on the suppliers and processes where exposure — in spend, risk, or working capital — is greatest. We recommend owning the top ${Math.min(
        5,
        Math.max(3, c.recTotal),
      )} at the executive level and delegating the remainder to category leads.`,
    methodology: () =>
      `Findings combine four standard lenses — spend concentration, a value-versus-risk supplier portfolio, a performance-versus-spend screen, and ongoing process-health monitoring of cycle time — into a single ranked action list. The approach is deliberately fixed and repeatable so results are comparable period over period and decision-grade rather than exploratory.`,
  },

  // ---- OPERATIONAL: procurement team. Action-focused, named suppliers, tactical.
  // (Reproduces the long-standing report voice.)
  operational: {
    cover: (c) =>
      `This report covers procurement activity for ${c.period}. Total spend of ${usdM(
        c.totalSpend,
      )} was distributed across ${intl.format(c.totalPos)} purchase orders from ${intl.format(
        c.activeSuppliers,
      )} active suppliers. The following analyses provide visibility into spend concentration, supplier segmentation, and process efficiency.`,
    spendOverview: (c) =>
      `Spending concentrated in ${c.cat1} (${pct(c.cat1Pct)}), followed by ${c.cat2} (${pct(
        c.cat2Pct,
      )}). Monthly spend ranged from ${usdM(c.monthlyMin)} to ${usdM(
        c.monthlyMax,
      )}. The top 10 suppliers accounted for ${pct(c.top10Pct)} of total spend.`,
    abc: (c) =>
      `ABC classification identified ${c.aN} Class A suppliers representing ${pct(
        c.aPct,
      )} of spend, ${c.bN} Class B (${pct(c.bPct)}), and ${c.cN} Class C (${pct(
        c.cPct,
      )}).`,
    kraljic: (c) =>
      `Kraljic segmentation maps suppliers on profit impact (spend) against supply risk. ${c.stratN} suppliers fall in the Strategic quadrant (high spend, high risk — ${pct(
        c.stratPct,
      )} of spend), ${c.levN} in Leverage (high spend, low risk — ${pct(
        c.levPct,
      )}), ${c.bottN} in Bottleneck (low spend, high risk), and ${c.routN} in Routine (low spend, low risk).${
        c.strategicNames.length
          ? ` Strategic suppliers such as ${c.strategicNames.join(
              " and ",
            )} warrant partnership and senior relationship management,`
          : " Strategic suppliers warrant partnership and senior relationship management,"
      } while Leverage suppliers are where competitive buying power should be applied.`,
    performanceSpend: (c) =>
      `Crossing spend against performance, ${c.starsN} suppliers are Stars (high spend, strong performance) and ${c.criticalN} are Critical Issues (high spend, lagging performance — ${pct(
        c.criticalPct,
      )} of spend)${
        c.criticalNames.length ? `, led by ${c.criticalNames.join(" and ")}` : ""
      }. A further ${c.gemsN} Hidden Gems perform well on small spend and are promotion candidates.`,
    cycleTime: (c) => {
      const bottleneck = `The slowest process stage is ${c.slowestStage}, averaging ${c.slowestStageMean.toFixed(
        1,
      )} days — the first place to look for cycle-time savings.`;
      const outlier = c.topAnomaly
        ? ` The longest cycles are worth a look — ${c.topAnomaly.po_id} (${c.topAnomaly.supplier_name}) ran ${c.topAnomaly.cycle_days} days against a ${c.cycleMean.toFixed(0)}-day average; ${c.anomalyCount} PO(s) sit in the slowest slice of this window.`
        : ` No PO ran far enough above the ${c.cycleMean.toFixed(0)}-day average to stand out this period.`;
      const cmp = c.cmpInsufficient
        ? skipClause(c)
        : c.cmpSignificant
          ? pooledShiftClause(c)
          : nullClause(c);
      const finding = c.methodFinding ? ` ${c.methodFinding}` : "";
      return `${bottleneck}${outlier}${cmp}${finding}${c.mixNote ?? ""}`;
    },
    keyFindings: (c) => [
      `${usdM(c.totalSpend)} total spend across ${intl.format(c.totalPos)} purchase orders.`,
      `${c.aN} Class A suppliers drive ${pct(c.aPct)} of spend.`,
      `The top 10 suppliers account for ${pct(c.top10Pct)} of spend.`,
      ...(c.criticalNames.length
        ? [
            `Engage ${c.criticalNames.join(
              " and ",
            )} — high-spend suppliers underperforming on quality/delivery.`,
          ]
        : []),
    ],
    recommendedPriorities: (c) =>
      `The actions below are organised by analysis — Spend, Suppliers, and Process — and ready to assign; within each, the highest-priority items come first. Each item names the supplier (or process stage), its category, the recommended move, and the evidence behind it.${
        c.criticalNames.length
          ? ` Start with ${c.criticalNames[0]} and the other Critical Issues — the highest-spend underperformers.`
          : ""
      }`,
    methodology: () =>
      `ABC uses fixed 80% / 95% thresholds (Pareto principle). Supplier segmentation uses the Kraljic Matrix — a median split of profit impact (log spend) against supply risk into four quadrants. Performance vs Spend crosses the CIPS-aligned performance score against spend. Cycle time is monitored on total procure-to-pay days, with a descriptive slowest-orders cut and an optional period-vs-period Mann-Whitney U comparison (α = 0.05). Recommendations are grouped by source analysis (Spend / Suppliers / Process); use the named actions directly, each mapping to a specific supplier or process stage.`,
  },

  // ---- ANALYTICAL: analyst. Data-heavy, statistical framing, caveats, methodology.
  analytical: {
    cover: (c) =>
      `This report analyses ${intl.format(c.totalPos)} purchase orders totalling ${usdM(
        c.totalSpend,
      )} across ${intl.format(
        c.activeSuppliers,
      )} suppliers for ${c.period}. Four fixed analyses are applied — Pareto/ABC classification, a Kraljic median-split segmentation, a performance-vs-spend median cross, and cycle-time process-health monitoring with an optional period-vs-period Mann-Whitney U comparison. Spend is right-skewed and highly concentrated (top-decile share ≈ ${pct(
        c.top10Pct,
      )}), which shapes the interpretation of every downstream cut.`,
    spendOverview: (c) => {
      // ⚠️ Was "…consistent with the Pareto pattern the ABC step formalises" — the same
      // false Pareto claim as the old abc close, and it would now contradict the fixed
      // abc method below. Replaced with the actual top-fifth test.
      const conc = c.conc;
      const paretoClause = conc
        ? `, though the top fifth reach only ${conc.topSharePct.toFixed(
            1,
          )}% — a ${ratioLabel(conc)} split against the textbook ${EVEN_REFERENCE_PCT}/${PARETO_REFERENCE_PCT}, ${
            conc.meetsPareto
              ? "close to the Pareto pattern the ABC step formalises"
              : "flatter than the Pareto pattern the ABC step assumes"
          }`
        : "";
      return `The category distribution is concentrated, with ${c.cat1} (${pct(
        c.cat1Pct,
      )}) and ${c.cat2} (${pct(
        c.cat2Pct,
      )}) leading. Monthly realised spend (by payment date) ranges ${usdM(
        c.monthlyMin,
      )}–${usdM(
        c.monthlyMax,
      )}; point-in-time totals should be read against that range. The supplier spend distribution is heavy-tailed — the top ten account for ${pct(
        c.top10Pct,
      )}${paretoClause}.`;
    },
    abc: (c) => {
      // ⚠️ The old close — "the A-share of 80% is broadly consistent with an 80/20
      // concentration" — was a FACTUAL ERROR, not just tone: aPct is pinned near 80%
      // BY CONSTRUCTION (Class A = the suppliers covering the first 80% of spend), so
      // it cannot evidence 80/20. The direct test is the top-fifth share, shared with
      // the dashboard Pareto card via lib/spend-concentration.
      const conc = c.conc;
      const tail = conc
        ? ` The A-share of ${pct(c.aPct)} is a property of the ${PARETO_REFERENCE_PCT}% cut-point, not a measure of concentration. The direct Pareto test is the top fifth of suppliers: they hold ${conc.topSharePct.toFixed(
            1,
          )}% of spend — a ${ratioLabel(conc)} split against the textbook ${EVEN_REFERENCE_PCT}/${PARETO_REFERENCE_PCT} — so spend on this base is ${
            conc.meetsPareto
              ? "close to the classic Pareto split"
              : "flatter than the Pareto premise, and Class A is a broad group rather than a selective one"
          }.`
        : "";
      return `Cumulative-spend classification (${PARETO_REFERENCE_PCT}% / 95% cut-points) yields ${c.aN} Class A (${pct(
        c.aPct,
      )}), ${c.bN} Class B (${pct(c.bPct)}), and ${c.cN} Class C (${pct(c.cPct)}).${tail}`;
    },
    kraljic: (c) =>
      `Quadrants are assigned by a median split of log-spend (median ≈ ${c.spendMedianLog.toFixed(
        1,
      )}) against a composite supply-risk score (median ≈ ${c.riskMedian.toFixed(
        1,
      )}). The split returns ${c.stratN} Strategic, ${c.levN} Leverage, ${c.bottN} Bottleneck and ${c.routN} Routine. Because the split is on log-spend, Strategic + Leverage necessarily capture the high-spend half (${pct(
        c.stratPct + c.levPct,
      )} of spend here); the risk axis then separates the difficult-to-replace suppliers within each spend band. Boundaries are sample-relative and shift with the supplier set under analysis.`,
    performanceSpend: (c) =>
      `Suppliers are placed in four zones by a median × median cross of total spend against the CIPS-aligned performance score (performance median ≈ ${c.perfMedian.toFixed(
        1,
      )}). The result is ${c.starsN} Stars, ${c.criticalN} Critical Issues (${pct(
        c.criticalPct,
      )} of spend), and ${c.gemsN} Hidden Gems. The Critical-Issues mass is the actionable signal — high spend coincident with sub-median performance — but note the zone boundaries are population medians, so membership is relative, not absolute.`,
    cycleTime: (c) => {
      // Derive the skew direction from mean vs median instead of asserting it.
      const skewGap = c.cycleMean - c.cycleMedian;
      const skewPhrase =
        skewGap >= 0.5
          ? `the mean of ${c.cycleMean.toFixed(1)} d exceeding the median indicates the expected right skew`
          : skewGap <= -0.5
            ? `the mean of ${c.cycleMean.toFixed(1)} d falling below the median indicates a left skew`
            : `the mean of ${c.cycleMean.toFixed(1)} d sitting close to the median indicates a roughly symmetric distribution`;
      const shape = `Total cycle time (n = ${intl.format(
        c.cycleN,
      )}) has median ${c.cycleMedian.toFixed(1)} d, IQR ${c.cycleIqr.toFixed(
        1,
      )} d (P25 ${c.cycleP25.toFixed(1)}, P75 ${c.cycleP75.toFixed(
        1,
      )}); ${skewPhrase}. The slowest sub-process is ${c.slowestStage} (mean ${c.slowestStageMean.toFixed(
        1,
      )} d).`;
      const anom = ` ${c.anomalyCount} PO(s) run far enough above the ${c.cycleMean.toFixed(0)}-day window average to be listed as the slowest orders — a descriptive cut, not a statistical outlier test.`;
      const test = c.cmpInsufficient
        ? ` The optional within-window comparison is not computable for the current selection (n_a = ${intl.format(
            c.cmpNA,
          )}, n_b = ${intl.format(c.cmpNB)}; ${
            c.cmpSkipReason === "empty_group"
              ? "one half contains no orders, so no comparison exists"
              : "one side is under the 10-observation floor"
          }).`
        : ` A two-sided Mann-Whitney U test compares two date windows (n_a = ${intl.format(
            c.cmpNA,
          )}, n_b = ${intl.format(
            c.cmpNB,
          )}): medians ${c.cmpMedianA.toFixed(1)} → ${c.cmpMedianB.toFixed(
            1,
          )} d, p ${c.cmpPStr}, rank-biserial r = ${
            c.cmpEffectSize != null ? c.cmpEffectSize.toFixed(3) : "—"
          } (${c.cmpEffect} effect); ${
            c.cmpSignificant ? "significant" : "not significant"
          } at α = 0.05${
            !c.cmpSignificant && c.cmpMdeA != null
              ? `; at these n the minimum detectable effect is a probability of superiority of ${c.cmpMdeA.toFixed(2)} at 80% power`
              : ""
          }. ⚠️ The window is split by ORDER date (the same basis the window is filtered by); splitting by payment date would select short-cycle orders into the earlier group by construction. The comparison is POOLED across buying methods, so a shift in it cannot be attributed to process speed without the per-method view.`;
      const finding = c.methodFinding ? ` ${c.methodFinding}` : "";
      return `${shape}${anom}${test}${finding}${c.mixNote ?? ""}`;
    },
    keyFindings: (c) => [
      `Spend is heavy-tailed: top-decile share ≈ ${pct(c.top10Pct)}; Class A share ${pct(
        c.aPct,
      )}.`,
      `Kraljic split (log-spend × supply-risk medians) → ${c.stratN}/${c.levN}/${c.bottN}/${c.routN} across quadrants.`,
      `Performance × spend cross isolates ${c.criticalN} Critical-Issue suppliers (${pct(
        c.criticalPct,
      )} of spend).`,
      ...(c.cmpInsufficient
        ? [
            `Cycle time: median ${c.cycleMedian.toFixed(1)} d, IQR ${c.cycleIqr.toFixed(
              1,
            )} d; period comparison not computable (window < 10 POs).`,
          ]
        : [
            `Cycle comparison: median ${c.cmpMedianA.toFixed(1)}→${c.cmpMedianB.toFixed(
              1,
            )} d, p ${c.cmpPStr}, ${c.cmpEffect} effect (${
              c.cmpSignificant ? "significant" : "n.s."
            }).`,
          ]),
      `Caveat: filter/threshold boundaries are sample-relative; recompute on a filtered population for population-specific inference.`,
    ],
    recommendedPriorities: () =>
      `Recommendations are grouped by source analysis (Spend / Suppliers / Process) and, within each category, ordered by a per-category priority rank — so ordering is comparable within a category but not strictly commensurable across them. Treat the ranking as a triage aid; the underlying reasoning strings carry the supporting evidence.`,
    methodology: (c) =>
      `Methods (all fixed): ABC at 80%/95% cumulative-spend cut-points; Kraljic via a median split of log1p(spend) against a 0–100 supply-risk composite (supply concentration, cost premium, import friction); performance-vs-spend via a median × median cross of spend against the performance score; cycle-time process-health monitoring on total procure-to-pay days (median/IQR distribution, trailing 3-month rolling trend, plus a descriptive list of the orders furthest above the window mean) with an optional two-sided Mann-Whitney U comparison (α = 0.05) and rank-biserial effect size between two date windows (current comparison n_a = ${intl.format(
        c.cmpNA,
      )}, n_b = ${intl.format(
        c.cmpNB,
      )}). Limitations: thresholds and zone boundaries are sample-relative; aggregates reported under a supplier filter still reflect full-population medians; data are synthetic, calibrated to APQC/Hackett/CIPS benchmarks.`,
  },
};
