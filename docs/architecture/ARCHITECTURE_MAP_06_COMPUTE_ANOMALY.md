# ARCHITECTURE MAP — 06: COMPUTE SUBSTRATE + CROSS-PAGE ANOMALY LAYER (§4)

> Authored by direct full reads of the 11 files below. Every formula/threshold is
> quoted with `file:line`. This file is the CANONICAL formula derivation the per-page
> §3c sections (`_03`,`_04`,`_05`) cite for values that originate in Python.
>
> **Owned files (11):** `python/scores.py`, `python/compute_analyses.py`,
> `python/import_compute.py`, `python/test_scores.py`, `python/test_import_compute.py`,
> `scripts/transform_dataset.py`, `lib/cycle-breakdown.ts`, `lib/cycle-flags.ts`,
> `lib/anomaly-crossref.ts`, `lib/temporal-anomalies.ts`, `lib/temporal-load.ts`.

---

## 0. COMPUTE PIPELINE OVERVIEW (the TS/SQL ↔ Python boundary)

Two Python entry points, spawned from Node (`lib/python.ts`, documented in `_01`):

1. **Import compute** — `python/import_compute.py` (stdin JSON `{suppliers, purchases}` → stdout JSON rows). Produces **per-period `SupplierMetric`** rows (identity + payment-year period + operational aggregates + the 6 derived scores). Pure; no DB. `compute_supplier_metrics` (`import_compute.py:37-61`) = `scores.roster_category_counts` → `scores.build_period_metrics` → `scores.compute_scores`.
2. **Analysis compute** — `python/compute_analyses.py`, two modes (`main`, `compute_analyses.py:1429-1569`):
   - **Mode A** `--period-id <id>`: computes the 6 analyses over that period's date bounds and **UPSERTs** each into `AnalysisResult` keyed `(periodId, analysisType)` (`upsert`, `:1398-1411`); also denormalizes risk/quadrant onto `SupplierMetric` (`writeback_supplier_metrics`, `:1377-1392`).
   - **Mode B** `--start-date --end-date`: computes over the span and prints ONE JSON `{spend_overview, abc, performance_spend, kraljic, recommendations, cycle_time}` to stdout — **no DB write** (`:1556-1559`). This is the range path; the cached range rows (`periodId IS NULL`) equal a fresh Mode B (verified — see §Reconciliation).

**Boundary:** the import route (TS) writes raw `Supplier`/`Purchase`/`SupplierMetric`; **all 6 scores and all 6 analyses are computed in Python**. The one TS-side compute that mirrors Python is `lib/cycle-breakdown.ts` (per-supplier IQR + stage anomalies + control exposure) — deliberately in TS because it reads per-PO rows the cached analyses don't carry.

**Period tag** = `COALESCE(paymentDate, prDate)` year (`load_frames`, `compute_analyses.py:108-113`; `build_period_metrics`, `scores.py:146-148`).

### §A6-python — every Python raw SQL statement (completes A6)

| # | Statement | file:line |
|---|---|---|
| 1 | `SELECT * FROM "Purchase" WHERE COALESCE("paymentDate","prDate") BETWEEN %s AND %s` | `compute_analyses.py:108-114` |
| 2 | `SELECT * FROM "Supplier" WHERE false` (empty-range guard) | `:116` |
| 3 | `SELECT * FROM "SupplierMetric" WHERE false` (empty-range guard) | `:117` |
| 4 | `SELECT DISTINCT ON ("externalId") * FROM "Supplier" WHERE "externalId" IN %s` | `:121-126` |
| 5 | `SELECT DISTINCT ON (m."supplierExternalId") m.* FROM "SupplierMetric" m JOIN "ReportingPeriod" rp … WHERE rp."startDate">=%s AND rp."endDate"<=%s ORDER BY … rp."startDate" DESC` | `:134-143` |
| 6 | `SELECT DISTINCT ON ("externalId") "externalId", category FROM "Supplier"` (roster sizes) | `:161-166` |
| 7 | `UPDATE "SupplierMetric" SET "supplyRiskScore","kraljicQuadrant","categoryCompetition" WHERE "supplierExternalId"=%s` | `:1381-1391` |
| 8 | `INSERT INTO "AnalysisResult" … ON CONFLICT ("periodId","analysisType") DO UPDATE …` | `:1402-1410` |
| 9 | `SELECT "startDate","endDate","name" FROM "ReportingPeriod" WHERE id=%s` | `:1416-1419` |

`import_compute.py` issues **no SQL** (reads JSON stdin). `transform_dataset.py` reads/writes **xlsx only**, no SQL.

---

## 1. THE SCORE ENGINE — `python/scores.py` (267 lines; single source of truth for the 6 supplier scores)

**Composite weights** (`WEIGHTS`, `scores.py:28-33`): `quality 0.30, delivery 0.30, process 0.22, risk 0.18`. Composite = `Σ weight·subscore`, 2dp (`compute_scores`, `:201-203`):
```
m["composite_score"] = np.round(sum(m[col] * w for col, w in WEIGHTS.items()), 2)
```

**Operational aggregates** per PO-group (`_aggregate_purchase_group`, `:107-132`) — shared by `build_period_metrics` (`:135-165`, grouped supplier×payment-year) and `build_window_metrics` (`:235-267`, grouped supplier over any filtered window):
| Field | Formula | line |
|---|---|---|
| `total_spend_usd` | `round(Σ total_value_usd, 2)` | :120 |
| `num_pos` | `len(group)` | :114 |
| `avg_po_value_usd` | `round(spend/npos, 2)` | :122 |
| `avg_lead_time_days` | `round(mean(po_to_delivery_days), 2)` | :123 |
| `avg_cycle_time_days` | `round(mean(total_cycle_days), 2)` | :124 |
| `on_time_delivery_pct` | `round(mean(on_time_delivery)·100, 2)` | :125 |
| `three_way_match_pct` | `round(mean(three_way_match_pass)·100, 2)` | :126 |
| `defect_rate_pct` | `round((Σdefect_count / Σquantity)·100, 2)` (quantity-based) | :130 |
| `complaint_rate_pct` | `round((orders_with_≥1_complaint / npos)·100, 2)` (per-order) | :131 |

**The four sub-scores** (`compute_scores`, `:177-200`):
| Sub-score | Formula | line | Bounds |
|---|---|---|---|
| `quality_score` | `mean( norm_low(defect_rate_pct,0,10), norm_low(complaint_rate_pct,0,100) )` | :177-180 | fixed 0-10 / 0-100 |
| `delivery_score` | `mean( norm_high(on_time_delivery_pct,0,100), norm_low(avg_lead_time_days,0,60) )` | :181-184 | 0-100 / 0-60 |
| `process_score` | `norm_high(three_way_match_pct,0,100)` | :185-187 | 0-100 |
| `risk_score` | `100 − (0.6·country_distance + 0.4·concentration_0_100(other_in_category))`, clipped [0,100] — **structural only, higher = safer** | :188-200 | — |

**Normalizers** (fixed industry bounds, clamped [0,100]): `norm_high = clip((v−lo)/(hi−lo),0,1)·100` (`:88-90`); `norm_low = clip((hi−v)/(hi−lo),0,1)·100` (`:93-95`).

**`country_distance_score`** (`:57-65`): `ID/INDONESIA → 0`; `{SG,MY,TH,VN,PH,BN,MM,LA,KH} → 30`; `{CN,JP,KR,AU,NZ,IN} → 60`; else `100`.

**Roster concentration** for the risk sub-score (`:78-83`): `_CONC_POINTS = {0:50, 1:35, 2:22, 3:12, 4:5}` (≥5 → 0), then `concentration_0_100 = points·2` (so 0-others → 100, ≥5 → 0). `other_in_category = max(0, roster_cat_count[cat] − 1)` (`:196`). Roster count = full master roster, active-or-not (`roster_category_counts`, `:98-104`).

> **Hand-verified** (`test_composite_handcalc`, `test_scores.py:110-126`): JP supplier, defect 2%/complaint 10%, OTD 90/lead 12, 3WM 100, category with 2 others → quality 85, delivery 85, process 100, risk `100−(0.6·60+0.4·44)=46.4`, composite `0.30·85+0.30·85+0.22·100+0.18·46.4=81.35`. **No `service_score`** (asserted absent, `:126`).

**Filter-live composite:** `build_window_metrics` (`:235-267`) re-aggregates over ANY filtered PO set and re-scores; a single-year window reproduces that year's `build_period_metrics` row **byte-for-byte** (locked by `test_window_matches_period`, `test_scores.py:129-156`). In `compute_analyses.py`, `build_live_composite_map` (`:182-215`) builds `{supplier_id → composite}` from the window's POs; the three `perf_of()` closures read `_LIVE_COMPOSITE_MAP` first, stored `SupplierMetric.compositeScore` as fallback (`:605-613`, `:921-929`, `:1047-1054`). So `0.82` of the composite (Q+D+P) is filter-dependent; only Risk `0.18` is window-independent.

---

## 2. `compute_analyses.py` — the 6 emitters (formula-by-formula)

### 2a. `spend_overview` (`:221-290`)
- `total_spend = Σ totalValueUsd` (`:222`); `total_pos = len` (`:276`); `active_suppliers = nunique(supplierExternalId)` (`:277`); `avg_cycle_time = mean(totalCycleDays)` (`:278`).
- **`total_categories = len(cat)`** (`:285`) — the DISTINCT REAL category count (the "14 not 9" fix). `by_category` is capped top-8-by-spend **+ a synthetic `"Other"` rollup** (`:224-226`), so `len(by_category) ≤ 9` understates reality; the display reads `total_categories`.
- `top_suppliers` = top-10 by spend (`:228-235`); `top_suppliers_by_category` = up to 10 per category (`:248-258`); `monthly_trend` = payment-month spend + `po_count` (`:263-272`).

### 2b. `abc` / Pareto (`:296-343`) — **fixed thresholds 0.80 / 0.95**
`classify(cum_pct)` (`:307-312`): `≤0.80 → A`, `≤0.95 → B`, else `C`. Suppliers ranked by spend desc, `cumulative_pct = cumsum(pct)` (`:305`). `thresholds: [0.80, 0.95]` (`:340`). Per-class `summary` = n / total_spend / pct_of_spend (`:329-337`).

### 2c. `performance_spend` (zones) (`:578-700`) — **median split log_spend × composite**
`spend_med = median(log_spend over eligible)` (`:629`), `perf_med = median(perf_of over eligible)` (`:630`). `zone_of` (`:632-641`): `hi_spend = log_spend > spend_med`, `hi_perf = perf > perf_med` →
`Stars` (hi/hi), `Critical Issues` (hi-spend/lo-perf), `Hidden Gems` (lo-spend/hi-perf), `Long Tail` (lo/lo). Both use strict `>`. Emits per-supplier rows, `zone_profiles` (n/spend/avg_performance 4dp), `axis_thresholds`, `top_critical_issues`/`top_hidden_gems` (top-5), `performance_by_quadrant`.

### 2d. `kraljic` (`:891-982`) + supply-risk (`:794-862`)
`supply_risk_score = supply_concentration(0-50) + cost_premium(0-25) + import_friction(0/8/16/25)`, clipped [0,100] (`compute_supply_risk`, `:839`):
| Component | Rule | line |
|---|---|---|
| supply_concentration | `_CONC = {0:50, 1:35, 2:22, 3:12, 4:5}` on # OTHER category suppliers (full roster; ≥5→0) | :831-832 |
| cost_premium | `clip(premium·62.5, 0, 25)`; premium = spend-wtd avg unit price / item benchmark − 1; counted only when supplier×item ≥2 POs AND item has ≥2 suppliers | :742-791 |
| import_friction | `ID→0, AFTA{MY,SG,TH,VN,PH,BN,MM,LA,KH}→8, RCEP{JP,KR,CN,AU,NZ}→16, else→25` | :719-739 |

**Quadrant assignment** (`assign_kraljic_quadrants`, `:865-888`): median split — `hi_spend = log_spend > spend_med` (strict, continuous, `:872`); **`hi_risk = risk ≥ risk_med`** (`>=`, `:879` — B5: the discrete risk score ties at median, so `>=` balances the split; asymmetry intentional). `Strategic`(hi/hi), `Leverage`(hi-spend/lo-risk), `Bottleneck`(lo-spend/hi-risk), `Routine`(lo/lo). `risk_components` per assignment sum EXACTLY to `supply_risk_score` (2dp, `:931-943`).

### 2e. `cycle_time` (`:419-569`) — metric = `total_cycle_days`
- `distribution` (`:448-461`): median, p25, p75, iqr, min, max, mean, n.
- `stage_breakdown` (`:469-474`): `_desc_stats` (mean/median/p25/p75/n) for each of `pr_to_po`, `po_to_delivery`, `delivery_to_invoice`, `invoice_to_payment`.
- **Anomalies (`:476-502`) — z-score outliers.** `std = std(ddof=1)` (`:486`); `z = (cycle − mean)/std`; flag **`z > 2`** (one-sided, right skew), emitted z-descending, **COMPLETE set** (no `.head` cap — the count feeds `has_outlier`). Each: po_id, supplier_id, cycle_days, z_score.
- `period_comparison` (`:504-520`): midpoint split → `_comparison_block` two-sided **Mann-Whitney U** + rank-biserial `r = 1 − 2U/(n_a·n_b)` (`:406-407`); `<10` in either group → `insufficient_data` (`:402`).
- `cycle_by_quadrant` (`:535-541`) descriptives; `three_way_match_by_quadrant` (`:542-557`): pass_rate per quadrant, `is_worst` = lowest pass-rate quadrant.

### 2f. `recommendations` (`:1002-1374`) — 8 categories + thresholds
Thresholds: `CATEGORY_CONC_THRESHOLD = 0.30` (`:996`), `TAIL_SPEND_SHARE = 0.01` (`:999`), slow-stage flag `mean > 8` days (`:1206`).
| # | `type` | Selection | impact_score | line |
|---|---|---|---|---|
| 1 | `critical_issues_engagement` | top-5 Critical-Issues zone by spend | `min(100, 0.7·spend_norm + 0.3·min(100, gap·2))` | :1080-1104 |
| 2 | `hidden_gems_promotion` | top-5 Hidden-Gems by perf | `min(100, surplus/(100−perf_med)·100)` | :1106-1129 |
| 3 | `bottleneck_risk` | top-5 Bottleneck by supply risk | `min(100, risk)` | :1131-1156 |
| 4 | `process_improvement` | worst-quadrant 3-way-match failure % (1 item) | `min(100, fail%)` | :1158-1185 |
| 4b | `slow_stage` | internal stages (`pr_to_po`, `delivery_to_invoice`, `invoice_to_payment`; PO→Delivery excluded) with mean > 8, ranked | `min(100, avg/18·100)`; `cycle_share_pct = avg/Σstage_means·100` | :1187-1225 |
| 5 | `concentration` | categories with share > 0.30 | `min(100, share·100)` | :1227-1253 |
| 6 | `critical_spend` | all ABC A-tier, by spend | `min(100, share_pct)` | :1255-1280 |
| 7 | `tail_spend` | ONE card summarizing sub-1% suppliers | `min(100, tail_supplier_pct)` | :1282-1312 |
`summary_stats.narrative` (`:1329-1372`): `top10_in_attention` (top-10 ∩ engage∪mitigate), top-category share, `a_items_count`, `slowest_stage_name/avg_days`. `generated_at` = wall-clock ISO (`:1357` — the byte-repro gap noted in CLAUDE.md).

---

## 3. §4 — CROSS-PAGE ANOMALY INTELLIGENCE LAYER

Three families, merged by `buildAnomalyHub` (`anomaly-crossref.ts:327-377`). All PURE; consume the cached analyses + the TS breakdown.

### Family 1 — PROCESS (cycle flags)
**Detector `deriveCycleFlags`** (`cycle-flags.ts:57-102`), over the breakdown roster + `cycle_time.anomalies` + breakdown `stageAnomalies`:
| Flag | Rule | line |
|---|---|---|
| `has_outlier` | supplier appears in `cycle_time.anomalies` (a PO with z>2) | :68, :74 |
| `inconsistent` | supplier `iqr > 1.5 × median(all roster IQRs)` (Tukey) | :66-67, :75 |
| `has_stage_dom` | supplier appears in breakdown `stageAnomalies` (a PO where one stage > 60% of cycle) | :69, :76 |
**Breakdown** (`cycle-breakdown.ts:54-243`): per-supplier median/p25/p75/`iqr` via linear-interp `quantile` (`:26-34`), `round1` (`:36`); `stageAnomalies` = POs where `max(stage)/total > 0.6` (`:205-216`); `controlExposure` = failed-3WM spend / total (`:227-240`). **`buildAnomalyCrossref`** (`:73-144`) joins each ≥1-flag supplier with ABC (roster) + spend/Kraljic/zone (perf); `important = abc==='A' || kraljic==='Strategic'` (`isImportant`, `:63-66`); rolls up `flaggedCount`, `importantCount`, `importantSpend`, `flagMix`.

### Family 2 — CLASSIFICATION (cross-lens disagreement)
**`buildClassificationAnomalies`** (`anomaly-crossref.ts:238-297`). For each eligible supplier (has a numeric Kraljic supply-risk), percentile-rank three lenses — Spend, Performance, Supply-risk — via `percentileRanker` (`:198-210`, mean-rank tie handling), integer-round each, take `disagreement = max − min`, flag when **`≥ CLASSIFICATION_DISAGREEMENT_CUTOFF = 80`** (`:190`, `:268`). Verdict from max/min axes (`verdictFor`, `:224-226`).

### Family 3 — TEMPORAL (changed over time)
**Loader `loadTemporalMatrix`** (`temporal-load.ts:33-85`): periods asc; RANGE → latest-two, **skip a partial newest year** (`totals[latest] < 0.5·totals[prior]`, `PARTIAL_YEAR_SPEND_FRACTION`, `:68`) → compare the two comparable years with `skippedLabel`; SINGLE-YEAR → Y vs Y-1, `no-prior`/`partial-year` note states (`:53-63`). **Detector `buildTemporalAnomalies`** (`temporal-anomalies.ts:164-252`), per supplier active in BOTH years:
| Detector | Rule | constant | line |
|---|---|---|---|
| spend | fold `max/min ≥ 2.5` AND `max ≥ 100_000` | `SPEND_FOLD_CUTOFF=2.5`, `SPEND_SMALL_BASE_MIN=100_000` | :33,:35,:181 |
| score | `|Δcomposite| ≥ 18` pts | `SCORE_SWING_CUTOFF=18` | :37,:193 |
| quadrant | any Kraljic quadrant change (axes_flipped 1 or 2) | — | :199-207 |
`significance = axes_flipped·1000 + min(|spend%|,500) + |Δscore|·5` (`:216-219`).

### `buildAnomalyHub` (`anomaly-crossref.ts:327-377`)
Runs all three, then unions: `familiesBySupplier` map (`:344-355`), `distinctFlagged = map.size` (`:372`), `compoundCount` = suppliers in ≥2 families (`:357-358`), `importantUnionCount` = union members that are A-tier/Strategic (`:361-366`).

### Where each family surfaces
| Family | Process Health (`process-health`) | Action Priorities hub | Reports appendix |
|---|---|---|---|
| Process | 3 flag cards (**14/2/35**) + roster "Anomalies" col | family card + unified table | 3-family summary |
| Classification | — | family card + table | ✓ |
| Temporal | — | family card + table (note-states) | ✓ (period-aware) |
(Consumption/render citations are in `_04` for the pages and `_05` for reports.)

---

## 4. A4 — COMPLETE THRESHOLD / CONSTANT ENUMERATION (compute + anomaly)

| Constant / threshold | Value | file:line |
|---|---|---|
| Composite weights Q/D/P/R | 0.30 / 0.30 / 0.22 / 0.18 | `scores.py:28-33` |
| quality bounds | defect 0-10, complaint 0-100 | `scores.py:177-180` |
| delivery bounds | OTD 0-100, lead 0-60 | `scores.py:181-184` |
| risk weights | 0.6·country + 0.4·conc | `scores.py:198` |
| country_distance tiers | 0 / 30 / 60 / 100 | `scores.py:57-65` |
| `_CONC_POINTS` (composite) | 0:50,1:35,2:22,3:12,4:5 (×2) | `scores.py:78-83` |
| ABC thresholds | 0.80 / 0.95 | `compute_analyses.py:308-312, 340` |
| Kraljic risk components caps | 50 / 25 / 25 | `compute_analyses.py:831-839` |
| cost_premium slope | `·62.5`, clip 0-25 | `compute_analyses.py:790` |
| import_friction tiers | 0 / 8 / 16 / 25 | `compute_analyses.py:723-739` |
| spend axis split | strict `>` | `compute_analyses.py:872` |
| risk axis split | `>=` | `compute_analyses.py:879` |
| perf zone split | strict `>` ×2 | `compute_analyses.py:633-634` |
| cycle outlier | z `> 2` (ddof=1) | `compute_analyses.py:486-490` |
| MWU insufficient | n `< 10` | `compute_analyses.py:402` |
| CATEGORY_CONC_THRESHOLD | 0.30 | `compute_analyses.py:996` |
| TAIL_SPEND_SHARE | 0.01 | `compute_analyses.py:999` |
| slow-stage flag | mean `> 8` days | `compute_analyses.py:1206` |
| slow-stage impact denom | `/18` | `compute_analyses.py:1222` |
| Inconsistent flag | iqr `> 1.5·median(IQRs)` | `cycle-flags.ts:67,75` |
| stage-dominated | `maxStage/total > 0.6` | `cycle-breakdown.ts:215` |
| CLASSIFICATION_DISAGREEMENT_CUTOFF | 80 | `anomaly-crossref.ts:190` |
| SPEND_FOLD_CUTOFF | 2.5 | `temporal-anomalies.ts:33` |
| SPEND_SMALL_BASE_MIN | 100_000 | `temporal-anomalies.ts:35` |
| SCORE_SWING_CUTOFF | 18 | `temporal-anomalies.ts:37` |
| PARTIAL_YEAR_SPEND_FRACTION | 0.5 | `temporal-anomalies.ts:40` |

---

## 5. RECONCILIATION TRACE (self-verifying — run against LIVE data 2026-07-15)

A read-only script (`scratchpad/reconcile.py`) reproduced `deriveCycleFlags` + `buildClassificationAnomalies` + `buildTemporalAnomalies` + `buildAnomalyHub` VERBATIM over the live cached `AnalysisResult` (range `2024-01-01..2026-12-31`) + live `Purchase` rows. **Every gate number matched exactly:**

```
PROCESS HEALTH  (expect 14 / 2 / 35):
  outlier suppliers : 14      inconsistent : 2  (iqr median 11.5, cutoff 17.25)
  stage-dominated   : 35      roster size  : 55
AP HUB  (expect 46 / 36 / 11 / 18, Important 17, In-2+ 19):
  distinctFlagged 46   process 36   classification 11   temporal 18
  importantUnion 17    compound(≥2 fam) 19
  temporal: latest=2025 vs prior=2024 (2026 skipped as partial); byDetector spend10/quadrant7/score3
```
The traced logic yields the gate numbers → **no drift, no misread.** `process(36) = |outlier14 ∪ inconsistent2 ∪ stageDom35|`; `distinctFlagged(46) = |process36 ∪ classification11 ∪ temporal18|` with `compound 19` overlap.

---

## 6. OFFLINE TRANSFORMER + TESTS

- **`scripts/transform_dataset.py`** (285 lines) — offline-only enriched-xlsx generator; the running app never reads its output (`_01` confirms the import path). Imports all formulas from `scores.py` (`:65-77`), so the derived scores can't drift from the runtime. **⚠️ DIVERGENCE (stale docstring):** the module docstring still describes the OLD model — "Five sub-scores (quality/delivery/**service**/process)" and "composite_score (weights **0.25/0.25/0.15/0.20/0.15**)" (`transform_dataset.py:34-35`) and "risk_score: … 100 - weighted(country, **complaints, single-source**)" (`:34`), all superseded by the 4-dim `scores.py` it actually calls (the inline comment at `:229-231` IS corrected). It also still reads a 3-sheet `procurement_data_raw.xlsx` with a `SupplierMetrics` sheet (`:180-183`), whereas the live import is two separate files with no metrics sheet.
- **`test_scores.py`** — `test_normalizers`/`test_country_distance`/`test_concentration_curve`/`test_composite_handcalc`/`test_window_matches_period` lock formula exactness; `test_baseline_reproduction` **RETIRED** (`:281-288`, anchored to pre-overhaul baseline).
- **`test_import_compute.py`** — `test_shape_and_columns` asserts payment-year row-set **`{2024:53, 2025:50, 2026:20}` = 123 rows** (`:47-53`); `test_wrapper_matches_engine` proves `compute_supplier_metrics` is a pure pass-through; `test_reconciliation_regression` **RETIRED** (`:121-126`).

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `CrossAnomalyRow` | type | `anomaly-crossref.ts:36` |
| `AnomalyCrossref` | type | `anomaly-crossref.ts:50` |
| `buildAnomalyCrossref` | fn | `anomaly-crossref.ts:73` |
| `DisagreementAxis` | type | `anomaly-crossref.ts:151` |
| `ClassificationAnomalyRow` | type | `anomaly-crossref.ts:154` |
| `ClassificationAnomalies` | type | `anomaly-crossref.ts:175` |
| `CLASSIFICATION_DISAGREEMENT_CUTOFF` | const | `anomaly-crossref.ts:190` |
| `buildClassificationAnomalies` | fn | `anomaly-crossref.ts:238` |
| `AnomalyFamily` | type | `anomaly-crossref.ts:300` |
| `AnomalyHub` | type | `anomaly-crossref.ts:302` |
| `buildAnomalyHub` | fn | `anomaly-crossref.ts:327` |
| `computeCycleBreakdown` | fn | `cycle-breakdown.ts:54` |
| `CycleFlagDerivation` | type | `cycle-flags.ts:39` |
| `deriveCycleFlags` | fn | `cycle-flags.ts:57` |
| `SPEND_FOLD_CUTOFF` | const | `temporal-anomalies.ts:33` |
| `SPEND_SMALL_BASE_MIN` | const | `temporal-anomalies.ts:35` |
| `SCORE_SWING_CUTOFF` | const | `temporal-anomalies.ts:37` |
| `PARTIAL_YEAR_SPEND_FRACTION` | const | `temporal-anomalies.ts:40` |
| `TemporalPoint` | type | `temporal-anomalies.ts:42` |
| `TemporalSupplierRow` | type | `temporal-anomalies.ts:45` |
| `TemporalMatrix` | type | `temporal-anomalies.ts:53` |
| `TemporalLoad` | type | `temporal-anomalies.ts:71` |
| `TemporalChange` | type | `temporal-anomalies.ts:77` |
| `TemporalAnomalyRow` | type | `temporal-anomalies.ts:83` |
| `TemporalAnomalies` | type | `temporal-anomalies.ts:94` |
| `buildTemporalMatrix` | fn | `temporal-anomalies.ts:124` |
| `buildTemporalAnomalies` | fn | `temporal-anomalies.ts:164` |
| `loadTemporalMatrix` | fn | `temporal-load.ts:33` |

**Total distinct exports across this doc's files: 28.**
