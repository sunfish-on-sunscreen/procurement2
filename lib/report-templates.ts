import type {
  SpendOverviewResult,
  AbcResult,
  ClusteringResult,
  ClusterProfile,
  HypothesisResult,
} from "@/lib/analysis-types";

export type ReportNarratives = {
  cover_intro: string;
  spend: string;
  abc: string;
  clustering: string;
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
  recommendations: string[];
  narratives: ReportNarratives;
};

export type ReportInput = {
  period: { name: string; startDate: string; endDate: string };
  spendOverview: SpendOverviewResult;
  abc: AbcResult;
  clustering: ClusteringResult;
  hypothesis: HypothesisResult;
};

const intl = new Intl.NumberFormat("en-US");
const usdM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;
const pct = (n: number) => `${n.toFixed(1)}%`;

const SEGMENT_ORDER = [
  "Star Performers",
  "Strategic Underperformers",
  "Reliable Specialists",
  "Tail Spenders",
] as const;

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/** Bijective cluster -> segment-name mapping (mirrors SupplierSegmentsView). */
function assignSegments(profiles: ClusterProfile[]): Map<number, string> {
  const otd = normalize(profiles.map((p) => p.onTimeDeliveryPct));
  const rfx = normalize(profiles.map((p) => p.rfxResponseRatePct));
  const tw = normalize(profiles.map((p) => p.threeWayMatchPct));
  const defectInv = normalize(profiles.map((p) => -p.defectRatePct));
  const leadInv = normalize(profiles.map((p) => -p.avgLeadTimeDays));
  const perf = profiles.map(
    (_p, i) => (otd[i] + rfx[i] + tw[i] + defectInv[i] + leadInv[i]) / 5,
  );
  const spend = profiles.map((p) => p.log_spend);

  const out = new Map<number, string>();
  const remaining = new Set(profiles.map((_p, i) => i));
  const pick = (score: (i: number) => number, best: "max" | "min") =>
    [...remaining].reduce((a, b) =>
      best === "max"
        ? score(a) >= score(b)
          ? a
          : b
        : score(a) <= score(b)
          ? a
          : b,
    );

  const tail = pick((i) => spend[i], "min");
  out.set(profiles[tail].cluster, "Tail Spenders");
  remaining.delete(tail);
  const star = pick((i) => perf[i], "max");
  out.set(profiles[star].cluster, "Star Performers");
  remaining.delete(star);
  const under = pick((i) => spend[i], "max");
  out.set(profiles[under].cluster, "Strategic Underperformers");
  remaining.delete(under);
  out.set(profiles[[...remaining][0]].cluster, "Reliable Specialists");
  return out;
}

function segmentSentence(name: string, p: ClusterProfile): string {
  const otime = p.onTimeDeliveryPct.toFixed(1);
  const defect = p.defectRatePct.toFixed(2);
  switch (name) {
    case "Star Performers":
      return `Star Performers — ${p.n_suppliers} suppliers with strong all-around performance (${otime}% on-time, ${defect}% defects). Consider strategic partnerships and contract extensions.`;
    case "Strategic Underperformers":
      return `Strategic Underperformers — ${p.n_suppliers} high-spend suppliers with quality concerns (${defect}% defects, ${otime}% on-time). Highest-priority improvement targets given spend exposure.`;
    case "Reliable Specialists":
      return `Reliable Specialists — ${p.n_suppliers} mid-spend suppliers with solid, consistent scores across delivery, quality, and process. Maintain steady engagement.`;
    case "Tail Spenders":
      return `Tail Spenders — ${p.n_suppliers} low-spend tail suppliers. Candidates for consolidation or simplified management.`;
    default:
      return "";
  }
}

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
  const { period, spendOverview: s, abc, clustering, hypothesis: h } = input;

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

  const profiles = [...clustering.cluster_profiles].sort(
    (a, b) => a.cluster - b.cluster,
  );
  const seg = assignSegments(profiles);
  const byName = new Map<string, ClusterProfile>();
  profiles.forEach((p) => byName.set(seg.get(p.cluster)!, p));
  const clusteringNarr = SEGMENT_ORDER.map((name) => {
    const p = byName.get(name);
    return p ? segmentSentence(name, p) : "";
  })
    .filter(Boolean)
    .join(" ");

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
  const underProfile = profiles.find(
    (p) => seg.get(p.cluster) === "Strategic Underperformers",
  );
  if (underProfile) {
    const names = clustering.cluster_assignments
      .filter((a) => a.cluster === underProfile.cluster)
      .slice(0, 2)
      .map((a) => a.supplier_name);
    for (const nm of names) {
      recommendations.push(
        `Engage supplier development for ${nm} (Strategic Underperformer segment).`,
      );
    }
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

  const narratives: ReportNarratives = {
    cover_intro,
    spend,
    abc: abcNarr,
    clustering: clusteringNarr,
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
    narratives,
  };

  const narrative = [
    `# Executive Summary — ${period.name}`,
    `## Overview`,
    cover_intro,
    `## Spend`,
    spend,
    `## ABC Analysis`,
    abcNarr,
    `## Supplier Segments`,
    clusteringNarr,
    `## Cycle Time`,
    cycle_time,
    `## Recommendations`,
    ...recommendations.map((r) => `- ${r}`),
  ].join("\n\n");

  return { narrative, metrics };
}
