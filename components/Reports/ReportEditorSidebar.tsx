"use client";

import { useState } from "react";
import { Settings, X, ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import {
  type ReportConfig,
  type SectionKey,
  type DetailLevel,
  type ReportTone,
  type Tier,
  ALL_TIERS,
  ALL_REC_CATEGORIES,
  REC_CATEGORY_LABELS,
  SECTION_LABELS,
} from "@/lib/report-config";
import type { RecommendationCategory } from "@/lib/analysis-types";
import { Button } from "@/components/ui/button";
import { DownloadPdfButton } from "@/components/DownloadPdfButton";

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

const TONE_LABELS: Record<ReportTone, string> = {
  executive: "Executive",
  operational: "Operational",
  analytical: "Analytical",
};

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
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

export function ReportEditorSidebar({
  config,
  onConfigChange,
  periods,
  allCategories,
  canSave,
  saving,
  onSave,
  pdfFilename,
}: {
  config: ReportConfig;
  onConfigChange: (c: ReportConfig) => void;
  periods: PeriodOption[];
  allCategories: string[];
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  pdfFilename: string;
}) {
  const [open, setOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);

  const set = (patch: Partial<ReportConfig>) =>
    onConfigChange({ ...config, ...patch });

  const isRange = config.period.mode === "range";
  const selectCls =
    "rounded-md border bg-background px-2 py-1 text-sm w-full";

  if (!open) {
    return (
      <div className="sticky top-0 flex h-[calc(100vh-2rem)] w-11 shrink-0 flex-col items-center border-r pt-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open report settings"
          onClick={() => setOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <aside className="sticky top-0 flex h-[calc(100vh-2rem)] w-[230px] shrink-0 flex-col overflow-y-auto border-r">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Report settings</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close report settings"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-5 p-3">
        {/* Period */}
        <section className="space-y-2">
          <GroupLabel>Period</GroupLabel>
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
            className={selectCls}
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
              className={selectCls}
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
                className={selectCls}
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
                className={selectCls}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* Tone */}
        <section className="space-y-2">
          <GroupLabel>Tone</GroupLabel>
          {(["executive", "operational", "analytical"] as ReportTone[]).map(
            (tn) => (
              <label key={tn} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reportTone"
                  checked={config.tone === tn}
                  onChange={() => set({ tone: tn })}
                  className="h-4 w-4 accent-primary"
                />
                {TONE_LABELS[tn]}
              </label>
            ),
          )}
        </section>

        {/* Detail level */}
        <section className="space-y-2">
          <GroupLabel>Detail</GroupLabel>
          {(["brief", "standard", "detailed"] as DetailLevel[]).map((lvl) => (
            <label key={lvl} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="detailLevel"
                checked={config.detailLevel === lvl}
                onChange={() => set({ detailLevel: lvl })}
                className="h-4 w-4 accent-primary"
              />
              <span className="capitalize">{lvl}</span>
            </label>
          ))}
        </section>

        {/* Sections */}
        <section className="space-y-2">
          <GroupLabel>Sections</GroupLabel>
          <Check checked disabled label="Executive Summary" />
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

        {/* Recommendation filters (only if Action Dashboard on) */}
        {config.sections.actionDashboard && (
          <section className="space-y-2">
            <GroupLabel>Recommendations</GroupLabel>
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
                      topN: Math.max(5, Math.min(20, Number(e.target.value) || 10)),
                    },
                  })
                }
                className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>
          </section>
        )}

        {/* Tier filter */}
        <section className="space-y-2">
          <GroupLabel>Tier filter</GroupLabel>
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
        </section>

        {/* Category filter */}
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setCatsOpen((v) => !v)}
            className="flex w-full items-center gap-1 text-left"
          >
            {catsOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <GroupLabel>
              Categories ({config.filters.categories.length}/{allCategories.length})
            </GroupLabel>
          </button>
          {catsOpen && (
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border p-2">
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
          )}
        </section>
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 border-t p-3">
        <span title={canSave ? undefined : "Range reports are ephemeral — switch to single year to save"}>
          <Button
            className="w-full"
            disabled={!canSave || saving}
            onClick={onSave}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </span>
        <DownloadPdfButton filename={pdfFilename} />
      </div>
    </aside>
  );
}
