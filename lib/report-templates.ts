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
  RecommendationAction,
} from "@/lib/analysis-types";
import type { ReportTone } from "@/lib/report-config";

export type ReportNarratives = {
  cover_intro: string;
  spend: string;
  abc: string;
  kraljic: string;
  performance: string;
  cycle_time: string;
};

export type ReportMetrics = {
  headline_numbers: {
    total_spend: number;
    total_pos: number;
    active_suppliers: number;
    avg_cycle_time: number;
  };
  key_findings: string[];
  recommendations: string[]; // legacy free-text recommendation lines
  action_items: string[]; // NEW: action-oriented one-liners (top recs)
  priorities: Recommendation[]; // NEW: structured top recommendations
  narratives: ReportNarratives;
  // Marks reports generated with the Batch 5 process-health-monitoring cycle
  // framing. Reports persisted before Batch 5 lack it; the report detail page
  // uses its absence to render the legacy pre/post cycle narrative + a note.
  cycle_framing?: "monitoring";
};

export type ReportInput = {
  period: { name: string; startDate: string; endDate: string };
  spendOverview: SpendOverviewResult;
  abc: AbcResult;
  kraljic: KraljicResult;
  performanceSpend: PerformanceSpendResult;
  cycleTime: CycleTimeResult;
  recommendations: RecommendationsResult;
};

const ACTION_VERB: Record<RecommendationAction, string> = {
  promote: "Promote",
  engage: "Engage",
  mitigate: "Mitigate risk for",
  improve: "Improve",
  diversify: "Diversify",
};

/** First sentence of a reasoning string, for compact bullets. */
function firstSentence(s: string): string {
  const i = s.indexOf(". ");
  return i === -1 ? s : s.slice(0, i + 1);
}

function actionLine(r: Recommendation): string {
  const who = r.supplier_name ?? r.scope ?? "Process";
  return `${ACTION_VERB[r.action]} ${who} — ${firstSentence(r.reasoning)}`;
}

/**
 * Turns the recommendations engine output into the report's action sections:
 * a short "key actions" bullet list and the top-N structured priorities.
 */
export function generateActionOrientedNarratives(recs: RecommendationsResult): {
  actionItems: string[];
  priorities: Recommendation[];
} {
  const ranked = recs.recommendations; // already sorted by impact desc
  return {
    actionItems: ranked.slice(0, 8).map(actionLine),
    priorities: ranked.slice(0, 10),
  };
}

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
  const A = abc?.summary.A ?? { n: 0, total_spend: 0, pct_of_spend: 0 };
  const B = abc?.summary.B ?? { n: 0, total_spend: 0, pct_of_spend: 0 };
  const C = abc?.summary.C ?? { n: 0, total_spend: 0, pct_of_spend: 0 };
  const kr = a.kraljic;
  const qprof = (q: KraljicQuadrant): QuadrantProfile =>
    kr?.quadrant_profiles.find((p) => p.quadrant === q) ?? {
      quadrant: q,
      n_suppliers: 0,
      total_spend: 0,
      pct_of_total_spend: 0,
      avg_performance_score: 0,
      median_risk: 0,
      median_spend: 0,
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
      return `${lead} With the top ten suppliers carrying ${pct(
        c.top10Pct,
      )} of spend, negotiation leverage and continuity risk are concentrated in a small set of relationships.`;
    },
    abc: (c) =>
      `A small group of suppliers drives the bulk of value: ${c.aN} account for ${pct(
        c.aPct,
      )} of spend, while the long tail of ${c.cN} contributes only ${pct(
        c.cPct,
      )}. The priority is to govern the high-value group tightly.`,
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
        return `${head} There is not yet enough data in the selected period to compare two windows, so the trend is reported as monitoring only.`;
      }
      const dir = c.cmpDelta > 0 ? "improved" : "deteriorated";
      return `${head} Comparing the two halves of the period, performance has ${
        c.cmpSignificant ? `${dir} materially` : "held broadly steady"
      } — the median moved from ${c.cmpMedianA.toFixed(
        0,
      )} to ${c.cmpMedianB.toFixed(0)} days${
        c.cmpSignificant ? "" : " (not a statistically meaningful shift)"
      }. Sustained monitoring keeps working-capital efficiency on track.`;
    },
    keyFindings: (c) => [
      `Value is concentrated: the top ten suppliers carry ${pct(c.top10Pct)} of spend.`,
      `${c.stratN} business-critical suppliers hold ${pct(c.stratPct)} of spend and need protected relationships.`,
      `${c.criticalN} high-value supplier(s) are underperforming — the portfolio's main value-at-risk.`,
      `Procure-to-pay cycle time holds at a median of ${c.cycleMedian.toFixed(
        0,
      )} days${
        c.cmpSignificant
          ? `, ${c.cmpDelta > 0 ? "improving" : "deteriorating"} across the period`
          : ""
      }.`,
    ],
    recommendedPriorities: (c) =>
      `The actions below are ranked by impact on value at stake. Read top-down: the highest-ranked items concern the suppliers and processes where exposure — in spend, risk, or working capital — is greatest. We recommend owning the top ${Math.min(
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
      `This executive summary covers procurement activity for ${c.period} at Adaro. Total spend of ${usdM(
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
        ? ` Investigate outliers such as ${c.topAnomaly.po_id} (${c.topAnomaly.supplier_name}, ${c.topAnomaly.cycle_days} days); ${c.anomalyCount} PO(s) exceeded the 2σ anomaly threshold.`
        : ` No POs exceeded the 2σ anomaly threshold this period.`;
      const cmp = c.cmpInsufficient
        ? ` A period-vs-period comparison needs more data than the current selection provides.`
        : c.cmpSignificant
          ? ` Cycle time ${
              c.cmpDelta > 0 ? "improved" : "worsened"
            } significantly between ${c.cmpLabelA} and ${c.cmpLabelB} (median ${c.cmpMedianA.toFixed(
              0,
            )}→${c.cmpMedianB.toFixed(0)} days, p ${c.cmpPStr}, ${c.cmpEffect} effect) — ${
              c.cmpDelta > 0
                ? "lock in the contributing changes"
                : "trace the regression to its process stage"
            }.`
          : ` The two halves of the period show no statistically significant cycle-time difference.`;
      return `${bottleneck}${outlier}${cmp}`;
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
      `The actions below are ranked by impact score and ready to assign. Work the list top-down: each item names the supplier (or process stage), the recommended move, and the evidence behind it.${
        c.criticalNames.length
          ? ` Start with ${c.criticalNames[0]} and the other Critical Issues — the highest-spend underperformers.`
          : ""
      }`,
    methodology: () =>
      `ABC uses fixed 80% / 95% thresholds (Pareto principle). Supplier segmentation uses the Kraljic Matrix — a median split of profit impact (log spend) against supply risk into four quadrants. Performance vs Spend crosses the CIPS-aligned performance score against spend. Cycle time is monitored on total procure-to-pay days, with Z-score outlier detection and an optional period-vs-period Mann-Whitney U comparison (α = 0.05). Recommendation impact scores are normalized to 0–100 per category. Use the named actions directly; each maps to a specific supplier or process stage.`,
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
    spendOverview: (c) =>
      `The category distribution is concentrated, with ${c.cat1} (${pct(
        c.cat1Pct,
      )}) and ${c.cat2} (${pct(
        c.cat2Pct,
      )}) leading. Monthly realised spend (by payment date) ranges ${usdM(
        c.monthlyMin,
      )}–${usdM(
        c.monthlyMax,
      )}; point-in-time totals should be read against that range. The supplier spend distribution is heavy-tailed — the top ten account for ${pct(
        c.top10Pct,
      )} — consistent with the Pareto pattern the ABC step formalises.`,
    abc: (c) =>
      `Cumulative-spend classification (80% / 95% cut-points) yields ${c.aN} Class A (${pct(
        c.aPct,
      )}), ${c.bN} Class B (${pct(c.bPct)}), and ${c.cN} Class C (${pct(
        c.cPct,
      )}). The A-share of ${pct(
        c.aPct,
      )} is broadly consistent with an 80/20 concentration.`,
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
      const anom = ` Z-score screening flags ${c.anomalyCount} PO(s) with cycle time > 2σ above the mean as outliers.`;
      const test = c.cmpInsufficient
        ? ` The optional period comparison is not computable for the current selection (one window has < 10 POs: n_a = ${intl.format(
            c.cmpNA,
          )}, n_b = ${intl.format(c.cmpNB)}).`
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
          } at α = 0.05. The non-parametric test is used because cycle-time distributions are right-skewed and violate normality.`;
      return `${shape}${anom}${test}`;
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
    recommendedPriorities: (c) =>
      `Recommendations are ranked by an impact score normalised to 0–100 within each category, so cross-category ordering is by construction comparable but not strictly commensurable. ${
        c.topRec
          ? `The highest-scoring item (${c.topRec.type.replace(
              /_/g,
              " ",
            )}, score ${c.topRec.impact_score.toFixed(0)}) leads the list.`
          : ""
      } Treat the ranking as a triage aid; the underlying reasoning strings carry the supporting evidence.`,
    methodology: (c) =>
      `Methods (all fixed): ABC at 80%/95% cumulative-spend cut-points; Kraljic via a median split of log1p(spend) against a 0–100 supply-risk composite (supply concentration, cost premium, import friction); performance-vs-spend via a median × median cross of spend against the performance score; cycle-time process-health monitoring on total procure-to-pay days (median/IQR distribution, trailing 3-month rolling trend, Z-score outliers at > 2σ) with an optional two-sided Mann-Whitney U comparison (α = 0.05) and rank-biserial effect size between two date windows (current comparison n_a = ${intl.format(
        c.cmpNA,
      )}, n_b = ${intl.format(
        c.cmpNB,
      )}). Limitations: thresholds and zone boundaries are sample-relative; aggregates reported under a supplier filter still reflect full-population medians; data are synthetic, calibrated to APQC/Hackett/CIPS benchmarks.`,
  },
};

export function generateExecutiveSummary(input: ReportInput): {
  narrative: string;
  metrics: ReportMetrics;
} {
  const {
    period,
    spendOverview: s,
    abc,
    kraljic,
    performanceSpend: ps,
    cycleTime: ct,
    recommendations: recs,
  } = input;

  // Narratives come from the OPERATIONAL templates (single source of truth, so
  // the stored markdown matches what ReportDocument renders for tone=operational).
  const ctx = deriveReportContext(
    {
      spendOverview: s,
      abc,
      kraljic,
      performanceSpend: ps,
      cycleTime: ct,
      recommendations: recs,
    },
    period.name,
  );
  const T = TEMPLATES.operational;
  const cover_intro = T.cover(ctx);
  const spend = T.spendOverview(ctx);
  const abcNarr = T.abc(ctx);
  const kraljicNarr = T.kraljic(ctx);
  const performance = T.performanceSpend(ctx);
  const cycle_time = T.cycleTime(ctx);
  const key_findings = T.keyFindings(ctx);

  const recommendations: string[] = [];
  for (const nm of ctx.strategicNames) {
    recommendations.push(
      `Establish senior-level relationship management for ${nm} (Strategic quadrant — high spend and high supply risk).`,
    );
  }
  if (ctx.cmpSignificant) {
    recommendations.push(
      ctx.cmpDelta > 0
        ? `Cycle time improved significantly across the period (median ${ctx.cmpMedianA.toFixed(
            0,
          )}→${ctx.cmpMedianB.toFixed(
            0,
          )} days); document and sustain the contributing process changes.`
        : `Cycle time deteriorated significantly across the period (median ${ctx.cmpMedianA.toFixed(
            0,
          )}→${ctx.cmpMedianB.toFixed(
            0,
          )} days); trace the regression to the ${ctx.slowestStage} stage.`,
    );
  } else if (ctx.slowestStageMean > 8) {
    recommendations.push(
      `Target the ${ctx.slowestStage} stage (averaging ${ctx.slowestStageMean.toFixed(
        1,
      )} days) to reduce overall procure-to-pay cycle time.`,
    );
  }
  recommendations.push(
    `Schedule a quarterly review of Class A supplier performance to protect the ${pct(
      ctx.aPct,
    )} of spend they represent.`,
  );

  // --- Action-oriented sections (NEW) -------------------------------------
  const { actionItems, priorities } = generateActionOrientedNarratives(recs);

  const narratives: ReportNarratives = {
    cover_intro,
    spend,
    abc: abcNarr,
    kraljic: kraljicNarr,
    performance,
    cycle_time,
  };

  const metrics: ReportMetrics = {
    headline_numbers: {
      total_spend: s.total_spend,
      total_pos: s.total_pos,
      active_suppliers: s.active_suppliers,
      avg_cycle_time: s.avg_cycle_time,
    },
    key_findings,
    recommendations,
    action_items: actionItems,
    priorities,
    narratives,
    cycle_framing: "monitoring",
  };

  const narrative = [
    `# Executive Summary — ${period.name}`,
    `## Overview`,
    cover_intro,
    `## Key Findings & Actions`,
    ...actionItems.map((a) => `- ${a}`),
    `## Spend`,
    spend,
    `## ABC Analysis & Supplier Quadrant`,
    `${abcNarr} ${kraljicNarr}`,
    `## Performance vs Spend`,
    performance,
    `## Cycle Time`,
    cycle_time,
    `## Recommended Priorities`,
    ...priorities.map(
      (p) => `- ${ACTION_VERB[p.action]} ${p.supplier_name ?? p.scope}: ${p.reasoning}`,
    ),
  ].join("\n\n");

  return { narrative, metrics };
}
