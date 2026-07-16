# ARCHITECTURE MAP — 07: RECONCILIATION + COVERAGE PROOF (Phase C)

> Capstone. §5 self-verifying reconciliation, §6 the coverage arithmetic that proves
> "exhaustive," §7 every divergence + unverified item. All `ARCHITECTURE_MAP_*.md` are
> left **untracked** (no `git add`/commit).

---

## 5. KNOWN-FACT RECONCILIATION

### 5a + 5b — AP hub `46 / 36 / 11 / 18` and Process Health `14 / 2 / 35` — VERIFIED against LIVE data

A read-only script (`scratchpad/reconcile.py`) reproduced the production detectors **verbatim**
— `deriveCycleFlags` (`lib/cycle-flags.ts`), the `computeCycleBreakdown` roster/IQR/stage rule
(`lib/cycle-breakdown.ts`), `buildClassificationAnomalies` + `buildAnomalyHub`
(`lib/anomaly-crossref.ts`), `buildTemporalAnomalies` + the `loadTemporalMatrix` period pick
(`lib/temporal-anomalies.ts`/`temporal-load.ts`) — over the **live cached `AnalysisResult`**
(range `2024-01-01…2026-12-31`) + **live `Purchase`** rows. Full trace in `_06 §5`. Result:

| Gate | Expected | Traced from live data | Status |
|---|---|---|---|
| Process Health — outlier suppliers | 14 | **14** (distinct suppliers in `cycle_time.anomalies`, z>2) | ✅ |
| Process Health — inconsistent | 2 | **2** (IQR > 1.5·median; median 11.5, cutoff 17.25) | ✅ |
| Process Health — stage-dominated | 35 | **35** (distinct suppliers with a PO where one stage >60% of cycle) | ✅ |
| AP hub — distinctFlagged | 46 | **46** = \|process36 ∪ classification11 ∪ temporal18\| | ✅ |
| AP hub — process | 36 | **36** = \|outlier14 ∪ inconsistent2 ∪ stageDom35\| | ✅ |
| AP hub — classification | 11 | **11** (lens spread ≥ 80 over 55 eligible) | ✅ |
| AP hub — temporal | 18 | **18** (2025 vs 2024; 2026 skipped partial; spend10/quadrant7/score3) | ✅ |
| AP hub — Important (union) | 17 | **17** (union members that are ABC-A or Strategic) | ✅ |
| AP hub — In 2+ families | 19 | **19** (suppliers in ≥2 families) | ✅ |

**The traced logic yields every gate number exactly → no drift, no misread.** Roster size 55,
647 purchases, 3 periods (2024/2025/2026) all confirmed live.

### 5c — METHODOLOGY PAGE vs CODE (claim-by-claim)

The Methodology page (`app/(dashboard)/methodology/page.tsx`) was read in full; every quantitative
claim was checked against the code traced in `_06 §1-3`. **The page is largely accurate** (it was
rewritten for honesty). **Matches** (claim → code, all ✅):

| Methodology claim | line | Code | Verdict |
|---|---|---|---|
| ABC 80% / next 15% / bottom 5% | :119-128 | `classify ≤0.80 A, ≤0.95 B, else C` `compute_analyses.py:307-312` | ✅ |
| Supply-conc step 0→50…≥5→0 | :166-167 | `_CONC {0:50,1:35,2:22,3:12,4:5}` `compute_analyses.py:831` | ✅ |
| Cost premium `clip(prem·62.5,0,25)`, ≥2 POs, item ≥2 suppliers | :179-186 | `compute_analyses.py:782,790` | ✅ |
| Import friction ID0/AFTA8/RCEP{JP,KR,CN,AU,NZ}16/else25 | :192-194 | `compute_analyses.py:723-739` | ✅ |
| Zones Stars/Critical/Hidden/LongTail via median split | :244-260 | `zone_of` `compute_analyses.py:632-641` | ✅ |
| Composite 0.30·Q+0.30·D+0.22·P+0.18·R | :266,:406 | `WEIGHTS` `scores.py:28-33` | ✅ |
| Quality per-PO avg(defect 0-10, complaint 0-100) | :365-368 | `scores.py:177-180` | ✅ |
| Delivery avg(OTD 0-100, lead 0-60); Process 3WM 0-100 | :371-375 | `scores.py:181-187` | ✅ |
| norm_high/norm_low clamp formulas | :384-385 | `scores.py:88-95` | ✅ |
| Risk `100−(0.6·country+0.4·roster_conc)`; ID0/ASEAN30/AP60/other100 | :428,:434 | `scores.py:198,57-65` | ✅ |
| Service removed, 15% redistributed → 30/30/22/18 | :413-418 | no `service_score` in `scores.py` | ✅ |
| 6 cycle methods (incl. z>2, MWU, rank-biserial) | :283-317 | `cycle_time_analysis` `compute_analyses.py:419-569` | ✅ |
| 3 flags (outlier 2σ / inconsistent 1.5·IQR Tukey / stage >60%) | :319-326 | `cycle-flags.ts` + `cycle-breakdown.ts:215` | ✅ |
| Period comparison = midpoint split | :329-331 | `mid=start+(end-start)/2` `compute_analyses.py:507` | ✅ |
| Impact: spend_norm=log1p(spend)/max×100 | :559-561 | `compute_analyses.py:1056-1057` | ✅ |
| Impact CIE `0.7·spend_norm+0.3·gap` | :566 | `compute_analyses.py:1100` | ✅ |
| Impact HGP `(perf−med)/(100−med)×100` | :572 | `compute_analyses.py:1112-1126` | ✅ |
| Impact Bottleneck = supply_risk_score | :576-578 | `compute_analyses.py:1152` | ✅ |
| Impact slow-stage `mean/18×100` | :583-584 | `compute_analyses.py:1222` | ✅ |
| 82% composite period-sensitive, Risk 18% fixed | :781-785 | `_06 §1` filter-live | ✅ |
| Constants: ABC 80/95, 2σ, 8-day, MWU all fixed | :825-828 | `_06 §4` | ✅ |

**MISMATCHES (4) — flagged:**

| # | Methodology claim | line | Code reality | Severity |
|---|---|---|---|---|
| **MM1** | "Periods auto-detected — one period per distinct year in the **`pr_date`** values" | :599-601 | Period tag = **payment-year** (`(paymentDate ?? prDate).getUTCFullYear()`, `upload/route.ts:297`; Python `COALESCE(paymentDate,prDate)`, `compute_analyses.py:111`). pr_date is only the FALLBACK. | **Real** — stale source claim |
| **MM2** | "Range … computed on-the-fly … **rather than reading the cache**" (~5 s every time) | :607-613 | Range results **ARE cached** (`AnalysisResult` rows with `periodId IS NULL`, keyed by range dates; cleared on import, regenerate lazily). Live DB shows 3 cached range spans. Only the FIRST range load after an import is live. | **Real** — partial (first-load-only) |
| **MM3** | §5.1: "'below' = below the median; 'above' = **at or over it**" (at-median → above) | :481-483 | `supplier-classification.ts:108` `s.performance_score <= median` → **at-median = "below"** (matches Python `hi_perf = perf > median`). The page's OWN §5.1 prose inverts the tie vs its code (whose comment at `:14` correctly says "at or below = below"). | **Real** — boundary contradiction at exactly-median |
| **MM4** | §6 "Impact Score" groups **slow-stage under "Process Improvement"** (`mean_days÷18×100`) | :581-585 | `process_improvement` is COMPLIANCE-ONLY (`min(100,fail%)`); `slow_stage` is a SEPARATE category `:1187-1225`. The §6 top list (`:527-539`) correctly separates them; only the impact bullet conflates. Formulas correct. | Minor — internal inconsistency |

**OMISSION (not a contradiction):** the Kraljic median split is described generically (":153, :202"); the code's **spend-axis `>` vs risk-axis `>=` asymmetry** (`compute_analyses.py:872,879`) is not mentioned.

---

## 6. COVERAGE PROOF (the arithmetic — headline: every delta is 0)

| Inventory | Denominator | Documented | Δ | How proven |
|---|---:|---:|---:|---|
| **A1 Files** | 183 | 183 | **0** | Partition (`_00`) assigns each file to exactly one doc (38+36+34+25+39+11=183); every file has an entry, verified by a script checking each `.ts/.tsx` basename appears in its owning doc (post exports-index append: 0 missing). |
| **A2 DB fields** | 97 scalar + 18 rel + 2 enums | 97 + 18 + 2 | **0** | `_01 §1` walks every model field-by-field (agent-verified 97/97, 18/18); both enums documented. |
| **A3 Exports (TS)** | 382 decl / **377 distinct** | 377 | **0** | Each companion doc carries an auto-generated **EXPORTS COMPLETENESS INDEX** listing every `export` in its files at `file:line`. (382 raw `^export` lines collapse to 377 distinct symbols — multi-name `export {…}` lines + one anonymous default.) |
| **A3 Exports (Python)** | 63 top-level | 63 | **0** | `_06` documents every emitter/helper (`scores.py` 16, `compute_analyses.py` 34, `import_compute.py` 3, `transform_dataset.py` 10) — all named with line cites. |
| **A4 Thresholds** | 25 constants + inline | 25 | **0** | `_06 §4` is a complete file:line table; every A5 metric resolves to one of them (§5 traces confirm). |
| **A5 Metrics rendered** | 209 | 209 | **0** | Per-page numbered enumerations: Spend+Classification 57 (`_03`), Process+Action 62 (`_04`), Import+Reports+Methodology 90 (`_05`). Each enumerated value is documented by construction. |
| **A6 Queries** | 80 TS + 9 Python = **89** | 89 | **0** | Per-owner TS call-sites (grep): topology 19, spend/class 15, process/action 6, import/reports 38, compute 2 = 80; every query-bearing file is documented in its §3b. Python 9 SQL statements enumerated in `_06 §A6-python`. |

**Coverage note on A6 counting:** the agents' self-reported query counts (14/13/7/36/2) are lower
than the grep call-site counts (19/15/6/38/2) because the docs group multi-query routes into one
§3b entry while grep counts each `prisma.*`/`$transaction` token; **no query-bearing file is
undocumented** (A1 Δ=0 guarantees every query lives in a documented file). One agent (process/action)
documented MORE than grep found (it also documented the delegated `getAnalysisResult`/`getRangeAnalyses`
read-helpers).

**Every inventory delta is 0. No silent drops.** The banned-summary rule was honored — each
inventory item is expanded individually (the exports indexes and the §4 threshold table are the
proof-of-enumeration).

---

## 7. DIVERGENCES & UNVERIFIED

### 7a — Divergences found (29), grouped

**Code-vs-CLAUDE.md:**
- **V1** `StatBlock` padding is `px-3.5 py-3` / `px-5 py-5` (`stat-block.tsx:41-46`), not CLAUDE.md's "p-3 / p-4".
- **V2** `SortHead` is NOT a shared primitive — duplicated in 4 files (`ActionDashboardView.tsx:855`, `StageDecompositionTable.tsx:24`, `CycleSupplierSection.tsx:141`, `CycleTimeView.tsx:46`); only `SortArrow` + `useTableSort` are shared (CLAUDE.md implies `SortHead` is shared).
- **V3** UI base library is **Base UI** (`@base-ui/react`), not Radix (except `form.tsx` = Radix, `sonner.tsx` = next-themes/sonner).

**Code-vs-Methodology (from §5c):** **V4** period source pr_date vs payment-year (MM1); **V5** range "not cached" vs cached (MM2); **V6** §5.1 at-median tie inverted (MM3); **V7** §6 slow-stage grouped under Process-Improvement (MM4); **V8** Kraljic `>`/`>=` asymmetry undocumented.

**Code-vs-itself (duplication / re-derivation):**
- **V9** `inconsistent` flag re-derived in `CycleTimeGlancePanel.tsx:127-129` independently of the authoritative `deriveCycleFlags` call (`CycleTimeClient.tsx:118`) — same 1.5×median-IQR rule, two code paths.
- **V10** `FLAG_META` triplicated (`CycleSupplierSection.tsx:36-40`, `ActionDashboardView.tsx:150-154`, `CycleTimeAnomalyCards.tsx:18-22`) — not a shared export.
- **V11** tail-spend `0.01` re-derived client-side in `action-insights.ts:374`, distinct from the Python emitter constant `TAIL_SPEND_SHARE` (`compute_analyses.py:999`).
- **V12** `≥ 80` lens-disagreement cutoff hardcoded in copy at `report-narrative.ts:636` + `ReportDocument.tsx:356` — neither interpolates `CLASSIFICATION_DISAGREEMENT_CUTOFF` (`anomaly-crossref.ts:190`). (CLAUDE.md listed this as a latent item; **confirmed**, note actual line is :636 not :637.)
- **V13** `transform_dataset.py` module docstring is STALE — "Five sub-scores (… **service** …)", weights "**0.25/0.25/0.15/0.20/0.15**", risk "100 − weighted(country, **complaints, single-source**)" (`:34-35`) — all superseded by the 4-dim `scores.py` it actually imports (`:65-77`; the inline comment at `:229-231` IS corrected). It also still reads a 3-sheet `procurement_data_raw.xlsx` with a `SupplierMetrics` sheet (`:180-183`) vs the live two-file import.

**Hardcoded hex (violates the "theme-aware tokens only, NO hardcoded hex" scope rule):**
- **V14** `#94a3b8` on scatter reference lines — `KraljicScatterChart.tsx:152-158`, `PerformanceSpendScatter.tsx:157-166` (spot-verified live). Plus green/red/amber Tailwind literals in the Spend decomposition panel.
- **V15** `SupplierDetailPanel.tsx:18-25` hardcodes hex AND carries dead `review`/`demote` action keys not in the `RecommendationAction` union.

**Dead / orphaned code:**
- **V16** `ReportPreset` model + table + migration `add_report_preset` fully orphaned — `prisma.reportPreset` grep = 0 hits (CLAUDE.md's known open item, **confirmed**).
- **V17** `SupplierMetric.categoryCompetition` is write-only — written `compute_analyses.py:1383`, read by zero TS.
- **V18** `PerformanceScoreCard.tsx` is dead — never imported (grep-verified).
- **V19** `Import.fileType` schema comment still lists `'supplier_metrics'` (`schema.prisma:147`) though that sheet was dropped.
- **V20** `lib/python.ts` has NO `runCycleCompare` (deleted; only 3 spawn wrappers remain) — the cycle-compare route/CLI path is gone.

**Behavioural / latent (confirm CLAUDE.md's open items):**
- **V21** Spend-Overview ranking lists the full 55-supplier roster incl. inactive; a UI-added supplier with POs but no `SupplierMetric` row would be dropped from the ranking (the CLAUDE.md latent metric-less-supplier hole) — not firing today.
- **V22** bulk import writes `total_value_usd` + `*_days` VERBATIM from file (`upload/route.ts:279-290`) while a manual add COMPUTES them (`purchase-import.ts:73-82`) — same field, two provenances.
- **V23** `recommendations.generated_at` wall-clock timestamp (`compute_analyses.py:1357`) makes that one analysis payload non-byte-reproducible (CLAUDE.md open item, confirmed).
- **V24** `.dark` theme is fully defined + wired in `globals.css:227` but **no toggler exists** in the surveyed components — no reachable dark mode at runtime (see U-items).
- **V25** `PeriodSelector` year options are data-driven from `periods`, not the literal 2024/2025/2026 (benign; contradicts any doc implying hardcoded years).
- **V26** redirects `/`→`/spend-overview` and `/abc-analysis`→`/spend-overview` live in App-Router **pages** (`redirect()`), not `next.config.ts` (which holds only `/cycle-time`→`/process-health`).
- **V27** `avg_cycle_time` KPI is emitted but only surfaced on the report-embedded `OverviewCharts`, not the standalone Spend Overview page.
- **V28** Pareto chart pin is inert on Spend Overview (no `PinProvider` wraps `AbcParetoCard`).
- **V29** `ClassificationRankingRow.performance_score` doc comment says "latest-in-range snapshot" but the value is filter-live (stale comment).

### 7b — Unverified / [INFERRED] (with what would resolve each)

| # | Item | Resolution |
|---|---|---|
| U1 | eslint "set-state-in-effect ban" attributed to `eslint-config-next` presets, not a local rule | inspect the resolved config in `node_modules/eslint-config-next` |
| U2 | `ReportingPeriod.isLocked` + `Session.expiresAt` have no observed runtime reader | repo-wide grep incl. generated client usage |
| U3 | Which mechanism toggles `.dark` (no toggler found) → whether dark mode is reachable at all | read root providers / any theme switch outside the surveyed set |
| U4 | Methodology §8.3 data-claims ("cost premium registers for 24/55", "slow-stage fires 2024 not 2025/26", "real maxima 35 and 70") | re-run `compute_analyses.py` per period + inspect risk_components; only `inconsistent = 2/55` was independently re-verified here (✅) |
| U5 | Exact live category count (`total_categories = 14`) | asserted by CLAUDE.md + the emitter path `compute_analyses.py:285`; not re-queried (roster **55** WAS re-verified live via `reconcile.py`) |

**Note — items positively RESOLVED during this pass** (were listed as unverifiable by sub-agents):
roster size **55** (re-verified live), Process Health **14/2/35** + AP hub **46/36/11/18** (re-verified
live), and `DATABASE_URL` reaching Python (`compute_analyses.py:49-58` reads `.env` via `load_dotenv`
+ `os.environ` — works both when Node passes env and standalone).
