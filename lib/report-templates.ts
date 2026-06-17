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

  const cover_intro = `This executive summary covers procurement activity for ${period.name} at Adaro. Total spend of ${usdM(
    s.total_spend,
  )} was distributed across ${intl.format(s.total_pos)} purchase orders from ${intl.format(
    s.active_suppliers,
  )} active suppliers. The following analyses provide visibility into spend concentration, supplier segmentation, and process efficiency.`;

  const cats = s.by_category;
  const catGrand = cats.reduce((a, c) => a + c.total, 0) || s.total_spend;
  const top1 = cats[0];
  const top2 = cats[1];
  const months = s.monthly_trend.map((m) => m.total);
  const minM = months.length ? Math.min(...months) : 0;
  const maxM = months.length ? Math.max(...months) : 0;
  const top10Total = s.top_suppliers.reduce((a, t) => a + t.total, 0);
  const top10Pct = s.total_spend ? (top10Total / s.total_spend) * 100 : 0;
  const spend = `Spending concentrated in ${top1 ? top1.category : "—"} (${pct(
    top1 ? (top1.total / catGrand) * 100 : 0,
  )}), followed by ${top2 ? top2.category : "—"} (${pct(
    top2 ? (top2.total / catGrand) * 100 : 0,
  )}). Monthly spend ranged from ${usdM(minM)} to ${usdM(
    maxM,
  )}. The top 10 suppliers accounted for ${pct(top10Pct)} of total spend.`;

  const A = abc.summary.A;
  const B = abc.summary.B;
  const C = abc.summary.C;
  const strategicNonA = abc.classifications.filter(
    (c) => c.tier === "Strategic" && c.abc_class !== "A",
  ).length;
  const mismatchNote =
    strategicNonA > 0
      ? ` Notably, ${strategicNonA} Strategic-tier supplier(s) fell into non-A classes, indicating a tier/spend mismatch worth review.`
      : "";
  const abcNarr = `ABC classification identified ${A.n} Class A suppliers representing ${pct(
    A.pct_of_spend * 100,
  )} of spend, ${B.n} Class B (${pct(B.pct_of_spend * 100)}), and ${C.n} Class C (${pct(
    C.pct_of_spend * 100,
  )}).${mismatchNote}`;

  // --- Kraljic quadrant narrative -----------------------------------------
  const byQ = new Map<KraljicQuadrant, QuadrantProfile>();
  for (const p of kraljic.quadrant_profiles) byQ.set(p.quadrant, p);
  const qp = (q: KraljicQuadrant): QuadrantProfile =>
    byQ.get(q) ?? {
      quadrant: q,
      n_suppliers: 0,
      total_spend: 0,
      pct_of_total_spend: 0,
      avg_performance_score: 0,
      median_risk: 0,
      median_spend: 0,
    };
  const strat = qp("Strategic");
  const lev = qp("Leverage");
  const bott = qp("Bottleneck");
  const rout = qp("Routine");
  const kraljicNarr = `Kraljic segmentation maps suppliers on profit impact (spend) against supply risk. ${strat.n_suppliers} suppliers fall in the Strategic quadrant (high spend, high risk — ${pct(
    strat.pct_of_total_spend,
  )} of spend), ${lev.n_suppliers} in Leverage (high spend, low risk — ${pct(
    lev.pct_of_total_spend,
  )}), ${bott.n_suppliers} in Bottleneck (low spend, high risk), and ${rout.n_suppliers} in Routine (low spend, low risk). Strategic suppliers warrant partnership and senior relationship management, while Leverage suppliers are where competitive buying power should be applied.`;

  // --- Performance vs Spend narrative -------------------------------------
  const zoneOf = (z: PerformanceSpendResult["zone_profiles"][number]["zone"]) =>
    ps.zone_profiles.find((p) => p.zone === z);
  const stars = zoneOf("Stars");
  const critical = zoneOf("Critical Issues");
  const gems = zoneOf("Hidden Gems");
  const performance = `Crossing spend against performance, ${
    stars?.n_suppliers ?? 0
  } suppliers are Stars (high spend, strong performance) and ${
    critical?.n_suppliers ?? 0
  } are Critical Issues (high spend, lagging performance — ${pct(
    critical?.pct_of_total_spend ?? 0,
  )} of spend). A further ${
    gems?.n_suppliers ?? 0
  } Hidden Gems perform well on small spend and are promotion candidates.`;

  let cycle_time: string;
  if (h.insufficient_data) {
    cycle_time = `Automation impact could not be tested for this period — it contains data from only one automation era. A reliable pre/post comparison of invoice-to-payment time requires a range spanning both 2024 (pre) and 2025 (post).`;
  } else {
    const pre = h.pre_stats.mean ?? 0;
    const post = h.post_stats.mean ?? 0;
    const delta = pre - post;
    const dpct = pre ? (delta / pre) * 100 : 0;
    const pStr =
      h.p_value != null && h.p_value < 0.001
        ? "< 0.001"
        : `= ${h.p_value != null ? h.p_value.toFixed(4) : "—"}`;
    cycle_time = `Automation introduced 2025-01-01 reduced invoice-to-payment cycle time from ${pre.toFixed(
      1,
    )} days to ${post.toFixed(1)} days, a ${delta.toFixed(1)}-day (${dpct.toFixed(
      1,
    )}%) improvement (p ${pStr}, ${effectWord(
      h.effect_size,
    )} effect size). The improvement is ${
      h.significant
        ? "statistically and practically significant"
        : "not statistically significant"
    }.`;
  }

  const recommendations: string[] = [];
  if (strategicNonA > 0) {
    recommendations.push(
      `Reclassify ${strategicNonA} supplier(s) whose legacy tier no longer matches their actual spend and ABC class.`,
    );
  }
  // Name a couple of Strategic-quadrant suppliers for relationship management.
  const strategicNames = kraljic.quadrant_assignments
    .filter((a) => a.quadrant === "Strategic")
    .slice(0, 2)
    .map((a) => a.supplier_name);
  for (const nm of strategicNames) {
    recommendations.push(
      `Establish senior-level relationship management for ${nm} (Strategic quadrant — high spend and high supply risk).`,
    );
  }
  // Under-tiered: Approved suppliers sitting in high-impact quadrants.
  const underTiered = kraljic.quadrant_assignments.filter(
    (a) =>
      a.tier === "Approved" &&
      (a.quadrant === "Strategic" || a.quadrant === "Leverage"),
  ).length;
  if (underTiered > 0) {
    recommendations.push(
      `Review ${underTiered} Approved-tier supplier(s) sitting in the Strategic or Leverage quadrant — their spend impact suggests they are promotion candidates.`,
    );
  }
  if (!h.insufficient_data && h.significant) {
    recommendations.push(
      `Extend the payment-automation pilot to the remaining process stages, building on the demonstrated cycle-time reduction.`,
    );
  }
  recommendations.push(
    `Schedule a quarterly review of Class A supplier performance to protect the ${pct(
      A.pct_of_spend * 100,
    )} of spend they represent.`,
  );

  const key_findings = [
    `${usdM(s.total_spend)} total spend across ${intl.format(s.total_pos)} purchase orders.`,
    `${A.n} Class A suppliers drive ${pct(A.pct_of_spend * 100)} of spend.`,
    `The top 10 suppliers account for ${pct(top10Pct)} of spend.`,
  ];

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
