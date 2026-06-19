import type {
  SpendOverviewResult,
  AbcResult,
  KraljicResult,
  KraljicQuadrant,
  QuadrantProfile,
  HypothesisResult,
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
};

export type ReportInput = {
  period: { name: string; startDate: string; endDate: string };
  spendOverview: SpendOverviewResult;
  abc: AbcResult;
  kraljic: KraljicResult;
  performanceSpend: PerformanceSpendResult;
  hypothesis: HypothesisResult;
  recommendations: RecommendationsResult;
};

const ACTION_VERB: Record<RecommendationAction, string> = {
  promote: "Promote",
  demote: "Demote",
  review: "Review tier for",
  engage: "Engage",
  mitigate: "Mitigate risk for",
  improve: "Improve",
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
  coreNonA: number;
  // kraljic
  stratN: number;
  stratPct: number;
  levN: number;
  levPct: number;
  bottN: number;
  routN: number;
  strategicNames: string[];
  underTiered: number;
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
  // cycle
  cycleInsufficient: boolean;
  pre: number;
  post: number;
  delta: number;
  dpct: number;
  pValue: number | null;
  pStr: string;
  effect: string;
  effectSize: number | null;
  significant: boolean;
  nPre: number;
  nPost: number;
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
  hypothesis: HypothesisResult | null;
  recommendations: RecommendationsResult | null;
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
  const coreNonA =
    abc?.classifications.filter((c) => c.tier === "Core" && c.abc_class !== "A")
      .length ?? 0;

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
  const underTiered = (kr?.quadrant_assignments ?? []).filter(
    (x) =>
      x.tier === "Standard" &&
      (x.quadrant === "Strategic" || x.quadrant === "Leverage"),
  ).length;

  const ps = a.performanceSpend;
  const zone = (z: string) => ps?.zone_profiles.find((p) => p.zone === z);
  const stars = zone("Stars");
  const critical = zone("Critical Issues");
  const gems = zone("Hidden Gems");

  const h = a.hypothesis;
  const pre = h?.pre_stats.mean ?? 0;
  const post = h?.post_stats.mean ?? 0;
  const delta = pre - post;
  const pValue = h?.p_value ?? null;
  const pStr =
    pValue != null && pValue < 0.001
      ? "< 0.001"
      : `= ${pValue != null ? pValue.toFixed(4) : "—"}`;

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
    coreNonA,
    stratN: strat.n_suppliers,
    stratPct: strat.pct_of_total_spend,
    levN: lev.n_suppliers,
    levPct: lev.pct_of_total_spend,
    bottN: qprof("Bottleneck").n_suppliers,
    routN: qprof("Routine").n_suppliers,
    strategicNames,
    underTiered,
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
    cycleInsufficient: h?.insufficient_data ?? true,
    pre,
    post,
    delta,
    dpct: pre ? (delta / pre) * 100 : 0,
    pValue,
    pStr,
    effect: effectWord(h?.effect_size ?? null),
    effectSize: h?.effect_size ?? null,
    significant: h?.significant ?? false,
    nPre: h?.pre_stats.n ?? 0,
    nPost: h?.post_stats.n ?? 0,
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
    cover: (c) =>
      `${c.period} procurement spend totalled ${usdM(c.totalSpend)} across ${intl.format(
        c.activeSuppliers,
      )} active suppliers. Value is highly concentrated — the ten largest relationships absorb ${pct(
        c.top10Pct,
      )} of outlay — so the agenda is straightforward: protect the few suppliers that matter, apply scale where the market is competitive, and close the process gaps that tie up working capital.`,
    spendOverview: (c) =>
      `Spend is dominated by ${c.cat1} (${pct(c.cat1Pct)}) and ${c.cat2} (${pct(
        c.cat2Pct,
      )}), leaving the organisation materially exposed to those two markets. With the top ten suppliers carrying ${pct(
        c.top10Pct,
      )} of spend, negotiation leverage and continuity risk are concentrated in a small set of relationships.`,
    abc: (c) =>
      `A small group of suppliers drives the bulk of value: ${c.aN} account for ${pct(
        c.aPct,
      )} of spend, while the long tail of ${c.cN} contributes only ${pct(
        c.cPct,
      )}. The priority is to govern the high-value group tightly${
        c.coreNonA > 0
          ? ` and to revisit ${c.coreNonA} top-tier designation(s) that no longer match where the money actually goes`
          : ""
      }.`,
    kraljic: (c) =>
      `Mapped by value and replaceability, ${c.stratN} suppliers are business-critical and hard to replace, holding ${pct(
        c.stratPct,
      )} of spend; another ${c.levN} carry comparable spend but sit in competitive markets (${pct(
        c.levPct,
      )}). The strategic group warrants board-level relationship ownership; the competitive group is where buying power should translate into better terms.`,
    performanceSpend: (c) =>
      `Crossing spend against delivered performance flags ${c.criticalN} high-value supplier(s) — ${pct(
        c.criticalPct,
      )} of spend — that are underperforming relative to what we pay them. These represent the clearest value-at-risk in the portfolio and the first call on management attention.`,
    cycleTime: (c) =>
      c.cycleInsufficient
        ? `Process efficiency could not be assessed over a single automation era; a multi-year view is needed to quantify the impact of payment automation.`
        : `Payment automation cut the invoice-to-pay cycle by ${c.delta.toFixed(
            0,
          )} days (${pct(
            c.dpct,
          )}), a ${c.significant ? "material" : "modest"} improvement in working-capital efficiency that ${
            c.significant ? "supports" : "does not yet justify"
          } extending automation to the remaining process stages.`,
    keyFindings: (c) => [
      `Value is concentrated: the top ten suppliers carry ${pct(c.top10Pct)} of spend.`,
      `${c.stratN} business-critical suppliers hold ${pct(c.stratPct)} of spend and need protected relationships.`,
      `${c.criticalN} high-value supplier(s) are underperforming — the portfolio's main value-at-risk.`,
      ...(c.cycleInsufficient
        ? []
        : [
            `Payment automation freed ~${c.delta.toFixed(0)} days of working capital per invoice cycle.`,
          ]),
    ],
    recommendedPriorities: (c) =>
      `The actions below are ranked by impact on value at stake. Read top-down: the highest-ranked items concern the suppliers and processes where exposure — in spend, risk, or working capital — is greatest. We recommend owning the top ${Math.min(
        5,
        Math.max(3, c.recTotal),
      )} at the executive level and delegating the remainder to category leads.`,
    methodology: () =>
      `Findings combine four standard lenses — spend concentration, a value-versus-risk supplier portfolio, a performance-versus-spend screen, and a before/after test of process automation — into a single ranked action list. The approach is deliberately fixed and repeatable so results are comparable period over period and decision-grade rather than exploratory.`,
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
      )}).${
        c.coreNonA > 0
          ? ` Notably, ${c.coreNonA} Core-tier supplier(s) fell into non-A classes, indicating a tier/spend mismatch worth review.`
          : ""
      }`,
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
    cycleTime: (c) =>
      c.cycleInsufficient
        ? `Automation impact could not be tested for this period — it contains data from only one automation era. A reliable pre/post comparison of invoice-to-payment time requires a range spanning both 2024 (pre) and 2025 (post).`
        : `Automation introduced 2025-01-01 reduced invoice-to-payment cycle time from ${c.pre.toFixed(
            1,
          )} days to ${c.post.toFixed(1)} days, a ${c.delta.toFixed(
            1,
          )}-day (${pct(c.dpct)}) improvement (p ${c.pStr}, ${c.effect} effect size). The improvement is ${
            c.significant
              ? "statistically and practically significant"
              : "not statistically significant"
          }.`,
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
      ...(c.underTiered > 0
        ? [
            `Review ${c.underTiered} Standard-tier supplier(s) sitting in high-impact quadrants for promotion.`,
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
      `ABC uses fixed 80% / 95% thresholds (Pareto principle). Supplier segmentation uses the Kraljic Matrix — a median split of profit impact (log spend) against supply risk into four quadrants. Performance vs Spend crosses the CIPS-aligned composite score against spend. Automation impact uses the Mann-Whitney U test (α = 0.05). Recommendation impact scores are normalized to 0–100 per category. Use the named actions directly; each maps to a specific supplier or process stage.`,
  },

  // ---- ANALYTICAL: analyst. Data-heavy, statistical framing, caveats, methodology.
  analytical: {
    cover: (c) =>
      `This report analyses ${intl.format(c.totalPos)} purchase orders totalling ${usdM(
        c.totalSpend,
      )} across ${intl.format(
        c.activeSuppliers,
      )} suppliers for ${c.period}. Four fixed analyses are applied — Pareto/ABC classification, a Kraljic median-split segmentation, a performance-vs-spend median cross, and a Mann-Whitney U test of automation impact. Spend is right-skewed and highly concentrated (top-decile share ≈ ${pct(
        c.top10Pct,
      )}), which shapes the interpretation of every downstream cut.`,
    spendOverview: (c) =>
      `The category distribution is concentrated, with ${c.cat1} (${pct(
        c.cat1Pct,
      )}) and ${c.cat2} (${pct(
        c.cat2Pct,
      )}) leading. Monthly realised spend (by invoice date) ranges ${usdM(
        c.monthlyMin,
      )}–${usdM(
        c.monthlyMax,
      )}; the series is volatile rather than seasonal, so point-in-time totals should be read against the range. The supplier spend distribution is heavy-tailed — the top ten account for ${pct(
        c.top10Pct,
      )} — consistent with the Pareto pattern the ABC step formalises.`,
    abc: (c) =>
      `Cumulative-spend classification (80% / 95% cut-points) yields ${c.aN} Class A (${pct(
        c.aPct,
      )}), ${c.bN} Class B (${pct(c.bPct)}), and ${c.cN} Class C (${pct(
        c.cPct,
      )}). The A-share of ${pct(
        c.aPct,
      )} is broadly consistent with an 80/20 concentration.${
        c.coreNonA > 0
          ? ` ${c.coreNonA} Core-tier supplier(s) fall outside Class A, a tier/spend discordance worth flagging though not necessarily an error — tier reflects relationship policy, ABC reflects realised spend.`
          : ""
      }`,
    kraljic: (c) =>
      `Quadrants are assigned by a median split of log-spend (median ≈ ${c.spendMedianLog.toFixed(
        1,
      )}) against a composite supply-risk score (median ≈ ${c.riskMedian.toFixed(
        1,
      )}). The split returns ${c.stratN} Strategic, ${c.levN} Leverage, ${c.bottN} Bottleneck and ${c.routN} Routine. Because the split is on log-spend, Strategic + Leverage necessarily capture the high-spend half (${pct(
        c.stratPct + c.levPct,
      )} of spend here); the risk axis then separates the difficult-to-replace suppliers within each spend band. Boundaries are sample-relative and shift with the supplier set under analysis.`,
    performanceSpend: (c) =>
      `Suppliers are placed in four zones by a median × median cross of total spend against the CIPS-aligned composite score (performance median ≈ ${c.perfMedian.toFixed(
        1,
      )}). The result is ${c.starsN} Stars, ${c.criticalN} Critical Issues (${pct(
        c.criticalPct,
      )} of spend), and ${c.gemsN} Hidden Gems. The Critical-Issues mass is the actionable signal — high spend coincident with sub-median performance — but note the zone boundaries are population medians, so membership is relative, not absolute.`,
    cycleTime: (c) =>
      c.cycleInsufficient
        ? `The Mann-Whitney U test is not computable here: the period contains a single automation era (n_pre = ${c.nPre}, n_post = ${c.nPost}), so no two-sample comparison exists. A range spanning the 2025-01-01 automation boundary is required.`
        : `A two-sample Mann-Whitney U test compares invoice-to-payment time pre- vs post-automation (n_pre = ${intl.format(
            c.nPre,
          )}, n_post = ${intl.format(c.nPost)}). Means move from ${c.pre.toFixed(
            1,
          )} to ${c.post.toFixed(1)} days (Δ ${c.delta.toFixed(1)} d, ${pct(
            c.dpct,
          )}); p ${c.pStr}, rank-biserial r = ${
            c.effectSize != null ? c.effectSize.toFixed(3) : "—"
          } (${c.effect} effect). The non-parametric test is used because cycle-time distributions are right-skewed; the result is ${
            c.significant ? "significant at α = 0.05" : "not significant at α = 0.05"
          }.`,
    keyFindings: (c) => [
      `Spend is heavy-tailed: top-decile share ≈ ${pct(c.top10Pct)}; Class A share ${pct(
        c.aPct,
      )}.`,
      `Kraljic split (log-spend × supply-risk medians) → ${c.stratN}/${c.levN}/${c.bottN}/${c.routN} across quadrants.`,
      `Performance × spend cross isolates ${c.criticalN} Critical-Issue suppliers (${pct(
        c.criticalPct,
      )} of spend).`,
      ...(c.cycleInsufficient
        ? [`Automation effect untestable in-period (single era).`]
        : [
            `Automation effect: Δ ${c.delta.toFixed(1)} d, p ${c.pStr}, ${c.effect} effect (${
              c.significant ? "significant" : "n.s."
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
      `Methods (all fixed): ABC at 80%/95% cumulative-spend cut-points; Kraljic via a median split of log1p(spend) against a 0–100 supply-risk composite (single-source, category competition, country distance, switching cost); performance-vs-spend via a median × median cross of spend against the composite score; automation impact via a two-sample Mann-Whitney U (α = 0.05) with a rank-biserial effect size and a 1,000-iteration bootstrap CI. Limitations: thresholds and zone boundaries are sample-relative; aggregates reported under a supplier filter still reflect full-population medians (n_pre = ${intl.format(
        c.nPre,
      )}, n_post = ${intl.format(
        c.nPost,
      )}); data are synthetic, calibrated to APQC/Hackett/CIPS benchmarks.`,
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
    hypothesis: h,
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
      hypothesis: h,
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
  if (ctx.coreNonA > 0) {
    recommendations.push(
      `Reclassify ${ctx.coreNonA} supplier(s) whose legacy tier no longer matches their actual spend and ABC class.`,
    );
  }
  for (const nm of ctx.strategicNames) {
    recommendations.push(
      `Establish senior-level relationship management for ${nm} (Strategic quadrant — high spend and high supply risk).`,
    );
  }
  if (ctx.underTiered > 0) {
    recommendations.push(
      `Review ${ctx.underTiered} Standard-tier supplier(s) sitting in the Strategic or Leverage quadrant — their spend impact suggests they are promotion candidates.`,
    );
  }
  if (!ctx.cycleInsufficient && ctx.significant) {
    recommendations.push(
      `Extend the payment-automation pilot to the remaining process stages, building on the demonstrated cycle-time reduction.`,
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
