"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type {
  SpendOverviewResult,
  AbcResult,
  KraljicResult,
  KraljicQuadrant,
  CycleTimeResult,
  PerformanceSpendResult,
  RecommendationsResult,
  Recommendation,
} from "@/lib/analysis-types";
import { deriveReportContext, TEMPLATES } from "@/lib/report-templates";
import {
  type ReportConfig,
  type SectionKey,
  tierFilterActive,
  categoryFilterActive,
} from "@/lib/report-config";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import { usePin } from "@/components/Reports/PinContext";
import { buttonVariants } from "@/components/ui/button";
import { OverviewCharts } from "@/components/analysis/OverviewCharts";
import { CycleTimeView } from "@/components/CycleTimeView";
import { DownloadPdfButton } from "@/components/DownloadPdfButton";

export type ReportAnalyses = {
  spend_overview: SpendOverviewResult | null;
  abc: AbcResult | null;
  kraljic: KraljicResult | null;
  cycle_time: CycleTimeResult | null;
  performance_spend: PerformanceSpendResult | null;
  recommendations: RecommendationsResult | null;
};

export type ReportMeta = {
  title: string;
  periodLabel: string;
  generatedBy: string;
  generatedAt: string; // ISO
  filename: string;
  ephemeral?: boolean;
};

const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];
const ZONE_ORDER = [
  "Stars",
  "Critical Issues",
  "Hidden Gems",
  "Long Tail",
] as const;
const ACTION_COLORS: Record<string, string> = {
  engage: "#ef4444",
  review: "#f59e0b",
  mitigate: "#f97316",
  promote: "#10b981",
  demote: "#64748b",
  improve: "#3b82f6",
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="pdf-page-break flex flex-col gap-4">{children}</section>
  );
}

export function ReportDocument({
  meta,
  analyses,
  config,
  supplierCategory,
  legacyCycle,
  embedded = false,
}: {
  meta: ReportMeta;
  analyses: ReportAnalyses;
  config: ReportConfig;
  supplierCategory: Record<string, string>;
  /**
   * Set only for reports persisted before Batch 5 (no `cycle_framing` marker):
   * the stored pre/post automation cycle narrative. When present, the cycle
   * section renders this legacy text + a note instead of the live monitoring
   * view — old reports are preserved as historical context, not back-filled.
   */
  legacyCycle?: string | null;
  /**
   * When true (the live editor at /reports/preview), suppress the built-in
   * sticky header (Back + Download) — the editor shell/sidebar owns those.
   */
  embedded?: boolean;
}) {
  const { pinnedSupplierId, pin } = usePin();
  const { sections, detailLevel } = config;
  const brief = detailLevel === "brief";
  const detailed = detailLevel === "detailed";
  const totalCategories = new Set(Object.values(supplierCategory)).size || 1;

  // Tone narratives are generated at RENDER time from the analyses (default to
  // operational for pre-3d reports that have no tone in their config).
  const tone = config.tone ?? "operational";
  const ctx = deriveReportContext(
    {
      spendOverview: analyses.spend_overview,
      abc: analyses.abc,
      kraljic: analyses.kraljic,
      performanceSpend: analyses.performance_spend,
      cycleTime: analyses.cycle_time,
      recommendations: analyses.recommendations,
    },
    meta.periodLabel,
  );
  const T = TEMPLATES[tone];

  // Visibility-only row filter for a section (tier + category, per scope).
  function keep<T extends { tier?: string; supplier_id?: string }>(
    rows: T[],
    section: SectionKey,
  ): T[] {
    let out = rows;
    if (tierFilterActive(config, section)) {
      out = out.filter((r) => r.tier == null || config.filters.tiers.includes(r.tier as never));
    }
    if (categoryFilterActive(config, section, totalCategories)) {
      out = out.filter((r) => {
        const cat = r.supplier_id ? supplierCategory[r.supplier_id] : undefined;
        return cat == null || config.filters.categories.includes(cat);
      });
    }
    return out;
  }

  const filterNote = (section: SectionKey): string | null => {
    const t = tierFilterActive(config, section)
      ? `tiers: ${config.filters.tiers.join(", ")}`
      : null;
    const c = categoryFilterActive(config, section, totalCategories)
      ? `${config.filters.categories.length} categories`
      : null;
    const parts = [t, c].filter(Boolean);
    return parts.length ? `Filtered to ${parts.join("; ")}.` : null;
  };

  // ---- Recommendations: filter by category + scope, then cap ----------------
  const recsAll = analyses.recommendations?.recommendations ?? [];
  const recsScoped = keep(
    recsAll.filter((r) =>
      config.recommendationFilters.categories.includes(r.type),
    ).map((r) => ({ ...r, tier: r.current_tier })),
    "actionDashboard",
  ) as (Recommendation & { tier?: string })[];
  const recCap = brief ? 3 : detailed ? recsScoped.length : config.recommendationFilters.topN;
  const recsToShow = recsScoped.slice(0, recCap);

  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <div className="no-print sticky top-0 z-10 -mx-6 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur">
          <Link
            href="/reports"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <span className="hidden truncate text-sm font-medium sm:block">
            {meta.title}
          </span>
          <DownloadPdfButton filename={meta.filename} />
        </div>
      )}

      <div
        id="report-root"
        className="mx-auto flex w-full max-w-[820px] flex-col gap-8"
      >
        {/* Cover — always */}
        <section className="pdf-page-break flex flex-col gap-3 rounded-lg border bg-card p-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Adaro &middot; Procurement Analytics
          </p>
          <h1 className="text-3xl font-bold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">
            Period: {meta.periodLabel} &middot; {detailLevel} detail &middot;
            Generated {new Date(meta.generatedAt).toLocaleString()} by{" "}
            {meta.generatedBy}
            {meta.ephemeral ? " · not saved (range report)" : ""}
          </p>
          <p className="mt-4 text-sm leading-relaxed">
            {T.cover(ctx)}
          </p>
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Key findings</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {T.keyFindings(ctx).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          {brief && recsToShow.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Top priorities</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {recsToShow.map((r, i) => (
                  <li key={i}>
                    <span className="uppercase">{r.action}</span>{" "}
                    {r.supplier_name ?? r.scope} — {r.reasoning}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Brief stops at the cover. */}
        {!brief && (
          <>
            {/* Spend Overview */}
            {sections.spendOverview && analyses.spend_overview && (
              <Section>
                <h2 className="text-xl font-semibold">Spend Overview</h2>
                <OverviewCharts spend={analyses.spend_overview} />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {T.spendOverview(ctx)}
                </p>
              </Section>
            )}

            {/* ABC Analysis */}
            {sections.abc && analyses.abc && (
              <Section>
                <h2 className="text-xl font-semibold">ABC Analysis</h2>
                {(() => {
                  const rows = keep(analyses.abc!.classifications, "abc");
                  const shown = detailed ? rows : rows.slice(0, 20);
                  const note = filterNote("abc");
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-1 text-right font-medium">#</th>
                            <th className="py-1 font-medium">Supplier</th>
                            <th className="py-1 font-medium">Tier</th>
                            <th className="py-1 font-medium">Class</th>
                            <th className="py-1 text-right font-medium">Spend</th>
                            <th className="py-1 text-right font-medium">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((c) => (
                            <tr
                              key={c.supplier_id}
                              onClick={() => pin(c.supplier_id)}
                              className={`cursor-pointer border-b ${
                                c.supplier_id === pinnedSupplierId
                                  ? "bg-foreground/5 ring-1 ring-inset ring-foreground/30"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <td className="py-1 text-right">{c.rank}</td>
                              <td className="py-1 font-medium">
                                {c.supplier_name}
                              </td>
                              <td className="py-1">{c.tier}</td>
                              <td className="py-1">{c.abc_class}</td>
                              <td className="py-1 text-right">{usd(c.total)}</td>
                              <td className="py-1 text-right">
                                {(c.pct * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!detailed && rows.length > 20 && (
                        <p className="text-xs text-muted-foreground">
                          Showing top 20 of {rows.length}. Use Detailed for the
                          full list.
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.abc(ctx)}
                        {note ? ` ${note}` : ""}
                      </p>
                    </>
                  );
                })()}
              </Section>
            )}

            {/* Supplier Quadrant (Kraljic) */}
            {sections.kraljic && analyses.kraljic && (
              <Section>
                <h2 className="text-xl font-semibold">
                  Supplier Quadrant (Kraljic Matrix)
                </h2>
                {(() => {
                  const assigns = keep(
                    analyses.kraljic!.quadrant_assignments,
                    "kraljic",
                  );
                  const filteredCount = (q: KraljicQuadrant) =>
                    assigns.filter((a) => a.quadrant === q).length;
                  const note = filterNote("kraljic");
                  const isFiltered = note != null;
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 font-medium">Quadrant</th>
                            <th className="py-2 text-right font-medium">
                              Suppliers
                            </th>
                            <th className="py-2 text-right font-medium">
                              % of Spend
                            </th>
                            <th className="py-2 text-right font-medium">
                              Avg Performance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {QUADRANT_ORDER.map((q) => {
                            const p = analyses.kraljic!.quadrant_profiles.find(
                              (x) => x.quadrant === q,
                            );
                            return (
                              <tr key={q} className="border-b">
                                <td className="py-2 font-medium">
                                  <span
                                    className="mr-2 inline-block h-3 w-3 rounded-full align-middle"
                                    style={{ backgroundColor: QUADRANT_COLORS[q] }}
                                  />
                                  {q}
                                </td>
                                <td className="py-2 text-right">
                                  {isFiltered
                                    ? filteredCount(q)
                                    : (p?.n_suppliers ?? 0)}
                                </td>
                                <td className="py-2 text-right">
                                  {(p?.pct_of_total_spend ?? 0).toFixed(1)}%
                                </td>
                                <td className="py-2 text-right">
                                  {p?.avg_performance_score != null
                                    ? p.avg_performance_score.toFixed(1)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.kraljic(ctx)}
                        {note
                          ? ` ${note} Supplier counts reflect the filter; spend and performance aggregates reflect the full population.`
                          : ""}
                      </p>
                      {detailed && (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-1 font-medium">Supplier</th>
                              <th className="py-1 font-medium">Tier</th>
                              <th className="py-1 font-medium">Quadrant</th>
                              <th className="py-1 text-right font-medium">
                                Supply risk
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {assigns.map((a) => (
                              <tr key={a.supplier_id} className="border-b">
                                <td className="py-1">{a.supplier_name}</td>
                                <td className="py-1">{a.tier}</td>
                                <td className="py-1">{a.quadrant}</td>
                                <td className="py-1 text-right">
                                  {a.supply_risk_score.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </Section>
            )}

            {/* Performance vs Spend */}
            {sections.performanceSpend && analyses.performance_spend && (
              <Section>
                <h2 className="text-xl font-semibold">Performance vs Spend</h2>
                {(() => {
                  const ps = analyses.performance_spend!;
                  const note = filterNote("performanceSpend");
                  const crit = keep(ps.top_critical_issues, "performanceSpend");
                  const fullRows = keep(ps.suppliers, "performanceSpend");
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 font-medium">Zone</th>
                            <th className="py-2 text-right font-medium">
                              Suppliers
                            </th>
                            <th className="py-2 text-right font-medium">
                              % of Spend
                            </th>
                            <th className="py-2 text-right font-medium">
                              Avg Performance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ZONE_ORDER.map((z) => {
                            const p = ps.zone_profiles.find((x) => x.zone === z);
                            return (
                              <tr key={z} className="border-b">
                                <td className="py-2 font-medium">{z}</td>
                                <td className="py-2 text-right">
                                  {p?.n_suppliers ?? 0}
                                </td>
                                <td className="py-2 text-right">
                                  {(p?.pct_of_total_spend ?? 0).toFixed(1)}%
                                </td>
                                <td className="py-2 text-right">
                                  {p?.avg_performance != null
                                    ? p.avg_performance.toFixed(1)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.performanceSpend(ctx)}
                        {note ? ` ${note}` : ""}
                      </p>
                      {crit.length > 0 && (
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">
                            Top critical issues (high spend, low performance)
                          </h3>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {crit.map((s) => (
                              <li key={s.supplier_id}>
                                {s.supplier_name} ({s.tier}) — {usd(s.total_spend_usd)},
                                performance {s.performance_score.toFixed(1)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detailed && (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-1 font-medium">Supplier</th>
                              <th className="py-1 font-medium">Tier</th>
                              <th className="py-1 font-medium">Zone</th>
                              <th className="py-1 text-right font-medium">Spend</th>
                              <th className="py-1 text-right font-medium">Perf.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fullRows.map((s) => (
                              <tr key={s.supplier_id} className="border-b">
                                <td className="py-1">{s.supplier_name}</td>
                                <td className="py-1">{s.tier}</td>
                                <td className="py-1">{s.zone}</td>
                                <td className="py-1 text-right">
                                  {usd(s.total_spend_usd)}
                                </td>
                                <td className="py-1 text-right">
                                  {s.performance_score.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </Section>
            )}

            {/* Cycle Time */}
            {sections.cycleTime &&
              (legacyCycle ? (
                // Pre-Batch-5 report: preserve the original pre/post framing.
                <Section>
                  <h2 className="text-xl font-semibold">Cycle Time</h2>
                  <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    This report uses the legacy pre/post automation comparison
                    framing. New reports use ongoing process health monitoring.
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {legacyCycle}
                  </p>
                </Section>
              ) : (
                analyses.cycle_time && (
                  <Section>
                    <h2 className="text-xl font-semibold">
                      Cycle Time — Process Health Monitoring
                    </h2>
                    <CycleTimeView data={analyses.cycle_time} />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {T.cycleTime(ctx)}
                    </p>
                  </Section>
                )
              ))}

            {/* Action Dashboard / Recommendations */}
            {sections.actionDashboard && (
              <Section>
                <h2 className="text-xl font-semibold">
                  Recommended Priorities
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {T.recommendedPriorities(ctx)}
                </p>
                {filterNote("actionDashboard") && (
                  <p className="text-xs text-muted-foreground">
                    {filterNote("actionDashboard")}
                  </p>
                )}
                {recsToShow.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recommendations match the selected filters.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {recsToShow.map((p, i) => {
                      const pinned =
                        p.supplier_id != null &&
                        p.supplier_id === pinnedSupplierId;
                      return (
                      <div
                        key={i}
                        onClick={() => p.supplier_id && pin(p.supplier_id)}
                        className={`rounded-md border p-3 ${
                          p.supplier_id ? "cursor-pointer" : ""
                        } ${pinned ? "ring-1 ring-inset ring-foreground/30" : ""}`}
                        style={{
                          borderLeft: `4px solid ${ACTION_COLORS[p.action] ?? "#64748b"}`,
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide">
                            {p.action}
                          </span>
                          <span className="font-medium">
                            {p.supplier_name ?? p.scope}
                          </span>
                          {p.current_tier && (
                            <span className="text-xs text-muted-foreground">
                              ({p.current_tier})
                            </span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            Impact {p.impact_score.toFixed(0)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {p.reasoning}
                        </p>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            )}

            {/* Methodology */}
            {sections.methodology && (
              <Section>
                <h2 className="text-xl font-semibold text-foreground">
                  Methodology
                </h2>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <p>{T.methodology(ctx)}</p>
                  <p className="text-xs">
                    Synthetic data calibrated to APQC, Hackett Group, CIPS, MOPS,
                    and AME benchmarks. References: Juran (1951); Mann &amp;
                    Whitney (1947); Kraljic (1983).
                  </p>
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
