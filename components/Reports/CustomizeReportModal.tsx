"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  type ReportConfig,
  type SectionKey,
  type DetailLevel,
  type Tier,
  ALL_TIERS,
  ALL_REC_CATEGORIES,
  REC_CATEGORY_LABELS,
  SECTION_LABELS,
  FILTERABLE_SECTIONS,
} from "@/lib/report-config";
import type { RecommendationCategory } from "@/lib/analysis-types";

type PeriodOption = { id: string; name: string };

const SECTION_ORDER: SectionKey[] = [
  "spendOverview",
  "abc",
  "kraljic",
  "performanceSpend",
  "cycleTime",
  "actionDashboard",
  "methodology",
];

const DETAIL_DESC: Record<DetailLevel, string> = {
  brief: "~1 page — executive summary + key findings only.",
  standard: "Full sections with narratives, tables and charts.",
  detailed: "Standard plus appendices (all suppliers, full lists).",
};

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: () => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
      />
      <span className={disabled ? "text-muted-foreground" : ""}>{label}</span>
    </label>
  );
}

export function CustomizeReportModal({
  open,
  onClose,
  initialConfig,
  periods,
  allCategories,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  initialConfig: ReportConfig;
  periods: PeriodOption[];
  allCategories: string[];
  onGenerate: (config: ReportConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState<ReportConfig>(initialConfig);
  const [perSection, setPerSection] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<ReportConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

  const isRange = config.period.mode === "range";

  async function handleGenerate() {
    setBusy(true);
    try {
      await onGenerate(config);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize Report</DialogTitle>
          <DialogDescription>
            Choose the period, sections, detail level and filters.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* 1. Period */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Period
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={config.period.mode}
                onChange={(e) =>
                  set({
                    period: {
                      ...config.period,
                      mode: e.target.value as "single" | "range",
                    },
                  })
                }
                className="rounded-md border bg-background px-2 py-1 text-sm"
              >
                <option value="single">Single Year</option>
                <option value="range">Range</option>
              </select>
              {!isRange ? (
                <select
                  value={config.period.singleId ?? ""}
                  onChange={(e) =>
                    set({ period: { ...config.period, singleId: e.target.value } })
                  }
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-1">
                  <select
                    value={config.period.fromId ?? ""}
                    onChange={(e) =>
                      set({ period: { ...config.period, fromId: e.target.value } })
                    }
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">to</span>
                  <select
                    value={config.period.toId ?? ""}
                    onChange={(e) =>
                      set({ period: { ...config.period, toId: e.target.value } })
                    }
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {isRange && (
              <p className="text-xs text-muted-foreground">
                Range reports render fresh and are not saved to your reports list.
              </p>
            )}
          </section>

          {/* 2. Sections */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              What to include
            </h4>
            <Check checked disabled label="Executive Summary (always included)" />
            {SECTION_ORDER.map((s) => (
              <Check
                key={s}
                checked={config.sections[s]}
                onChange={() =>
                  set({
                    sections: { ...config.sections, [s]: !config.sections[s] },
                  })
                }
                label={SECTION_LABELS[s]}
              />
            ))}
          </section>

          {/* 3. Recommendation filters (only if Action Dashboard on) */}
          {config.sections.actionDashboard && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Recommendation filters
              </h4>
              {ALL_REC_CATEGORIES.map((cat) => (
                <Check
                  key={cat}
                  checked={config.recommendationFilters.categories.includes(cat)}
                  onChange={() =>
                    set({
                      recommendationFilters: {
                        ...config.recommendationFilters,
                        categories: toggle(
                          config.recommendationFilters.categories,
                          cat,
                        ) as RecommendationCategory[],
                      },
                    })
                  }
                  label={REC_CATEGORY_LABELS[cat]}
                />
              ))}
              <label className="flex items-center gap-2 text-sm">
                <span>Top N:</span>
                <input
                  type="number"
                  min={5}
                  max={20}
                  value={config.recommendationFilters.topN}
                  onChange={(e) =>
                    set({
                      recommendationFilters: {
                        ...config.recommendationFilters,
                        topN: Math.max(
                          5,
                          Math.min(20, Number(e.target.value) || 10),
                        ),
                      },
                    })
                  }
                  className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                />
              </label>
            </section>
          )}

          {/* 4. Detail level */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Detail level
            </h4>
            {(["brief", "standard", "detailed"] as DetailLevel[]).map((lvl) => (
              <label key={lvl} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="detailLevel"
                  checked={config.detailLevel === lvl}
                  onChange={() => set({ detailLevel: lvl })}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="font-medium capitalize">{lvl}</span>
                  <span className="block text-xs text-muted-foreground">
                    {DETAIL_DESC[lvl]}
                  </span>
                </span>
              </label>
            ))}
          </section>

          {/* 5. Supplier filters */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Supplier filters
            </h4>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Filter by tier:</p>
              <div className="flex flex-wrap gap-3">
                {ALL_TIERS.map((t) => (
                  <Check
                    key={t}
                    checked={config.filters.tiers.includes(t)}
                    onChange={() =>
                      set({
                        filters: {
                          ...config.filters,
                          tiers: toggle(config.filters.tiers, t) as Tier[],
                        },
                      })
                    }
                    label={t}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Filter by category:
              </p>
              <div className="grid max-h-28 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-md border p-2">
                {allCategories.map((cat) => (
                  <Check
                    key={cat}
                    checked={config.filters.categories.includes(cat)}
                    onChange={() =>
                      set({
                        filters: {
                          ...config.filters,
                          categories: toggle(config.filters.categories, cat),
                        },
                      })
                    }
                    label={cat}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPerSection((v) => !v)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              {perSection ? "Hide per-section scope" : "Customize per section"}
            </button>
            {perSection && (
              <div className="grid grid-cols-2 gap-4 rounded-md border p-2 text-xs">
                <div>
                  <p className="mb-1 font-medium">Tier filter applies to:</p>
                  {FILTERABLE_SECTIONS.map((s) => (
                    <Check
                      key={s}
                      checked={config.filterScope.tierApplies.includes(s)}
                      onChange={() =>
                        set({
                          filterScope: {
                            ...config.filterScope,
                            tierApplies: toggle(
                              config.filterScope.tierApplies,
                              s,
                            ),
                          },
                        })
                      }
                      label={SECTION_LABELS[s]}
                    />
                  ))}
                </div>
                <div>
                  <p className="mb-1 font-medium">Category filter applies to:</p>
                  {FILTERABLE_SECTIONS.map((s) => (
                    <Check
                      key={s}
                      checked={config.filterScope.categoryApplies.includes(s)}
                      onChange={() =>
                        set({
                          filterScope: {
                            ...config.filterScope,
                            categoryApplies: toggle(
                              config.filterScope.categoryApplies,
                              s,
                            ),
                          },
                        })
                      }
                      label={SECTION_LABELS[s]}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={busy}>
            {busy ? "Generating…" : "Generate Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
