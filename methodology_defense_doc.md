# Procurement Dashboard — Methodology Defense Doc

## Reflects the current codebase (composite restructured in commit aca864c)

⚠️ **HONEST NOTE**: This is compiled from the current methodology as implemented in
`python/scores.py` (the single source of truth for the composite + sub-scores) and
`python/compute_analyses.py` (Kraljic supply risk + Action Priorities). Sections marked
**[NEEDS SOURCE URL]** require citations pulled from your prior source library (the ~47
sources referenced in earlier chats). The formulas and weights below ARE what's in the
codebase — the citations backing them are what's missing.

---

## 1. THE PERFORMANCE COMPOSITE

### Formula (locked in codebase — `python/scores.py`)

```
composite = 0.30 × Quality
         + 0.30 × Delivery
         + 0.22 × Process
         + 0.18 × Risk
```

Output: 0-100 scale, 2dp precision throughout dashboard. **Four dimensions.**

### Weight rationale

| Dimension | Weight | Rationale |
|---|---|---|
| Quality | 30% | Operational performance critical in mining; defects and complaints on delivered goods can halt equipment |
| Delivery | 30% | On-time delivery in mining directly affects production uptime |
| Process | 22% | Three-way match is audit-critical for state-owned-enterprise procurement |
| Risk | 18% | Structural supplier-reliability signal, complementary to strategic Kraljic risk |

**Total = 100%** (Quality + Delivery dominant at 60% — the operational-reliability floor for
mining; Process 22% audit weight; Risk 18% structural signal).

### Why four dimensions — the restructure (defensible improvement)

The composite was deliberately **scoped to the dimensions that can be measured directly from
transaction data**, rather than from manual survey inputs:

- **Service was removed.** The former Service dimension (RFx response rate + average response
  time) relied on manual RFx estimates that don't exist in the transactional dataset — it was
  a survey-style signal, not a measured one. It was dropped and its 15% weight **redistributed
  across the remaining four dimensions in proportion to their prior weights** (rounded to the
  clean 30/30/22/18 above). The relative priorities are unchanged: Quality and Delivery remain
  co-dominant, Process sits above Risk, exactly as before.
- **Quality moved to per-transaction measurement.** Defect and complaint counts are now read
  per purchase order (`defect_count` / `complaint_count` on each PO) and aggregated over the
  filtered POs, instead of being fixed per-supplier survey constants — so Quality reflects the
  actual transactions in the selected period.
- **Risk was made purely structural.** The complaint term was removed from Risk to eliminate
  double-counting with Quality (complaints now live only in Quality). The binary single-source
  flag was replaced with a **continuous roster-concentration measure**. Risk is now a clean,
  purely structural signal (geography + supplier availability) with no performance term.

### Defense framing (the standard defense)

> "Dimension selection follows standard procurement scorecard practice (CIPS Supplier
> Performance Management framework), scoped to what the transaction data can measure directly.
> Weight calibration reflects Adaro's mining-industry priorities — operational reliability
> dominates because equipment downtime is the primary revenue risk. Process weight is elevated
> because three-way match compliance is audit-critical for state-owned-enterprise procurement
> in Indonesia."

**Key point for defense**: dimensions are prescribed by frameworks, weights are
organization-calibrated, and the score is scoped to directly-measured transactional signals.
This is standard SRM practice — no framework prescribes universal weights because industry
context varies.

---

## 2. EACH DIMENSION'S FORMULA

### Quality (30% weight)

```
Quality = (norm_low(defect_rate_pct, 0, 10) + norm_low(complaint_rate_pct, 0, 100)) / 2
```

**Where** (both aggregated over the filtered POs — filter-live, not survey constants):
- `defect_rate_pct` = defective units / units ordered × 100 (quantity-based)
- `complaint_rate_pct` = share of orders with ≥1 complaint × 100 (per-order, 0–100%)
- `norm_low(x, min, max)` = normalizes so lower raw values give higher score, clamped to [0,100]

**Raw data**: per-PO `defect_count`, `complaint_count`, `quantity` on the Purchase table

**Bound justification**: 10% defect = functionally "failed process" (Six Sigma sets a far
tighter DPMO; 10% is a generous worst-case ceiling). Complaint rate is bounded 0–100% by
construction — a supplier drawing a complaint on every order scores 0.

**[NEEDS SOURCE URL]**: ISM defect-rate benchmarks, ASQ quality-metrics standards

---

### Delivery (30% weight)

```
Delivery = (norm_high(OTD%, 0, 100) + norm_low(lead_time, 0, 60)) / 2
```

**Where**:
- `OTD%` = On-Time Delivery percentage
- `lead_time` = days from PO to delivery (`po_to_delivery_days`)

**Raw data**: `on_time_delivery` (per PO), `po_to_delivery_days` — both aggregated over the
filtered POs.

**Bound justification**: 60 days = mining-equipment ceiling. Beyond 60 days is atypical for
regular mining supply chain.

**[NEEDS SOURCE URL]**: KPI Depot OTD standards, mining-industry supplier lead-time benchmarks,
APQC PCF procurement KPIs

---

### Process (22% weight)

```
Process = norm_high(three_way_match_rate, 0, 100)
```

**Where**:
- `three_way_match_rate` = % of POs where PO, receipt, and invoice all match

**Raw data**: `three_way_match_pass` per PO, aggregated over the filtered POs.

**Bound justification**: 100% is the audit target. Any deviation indicates process leakage.

**Note**: single-input dimension (unusual — the others have two inputs). Weight of 22% reflects
audit importance despite fewer inputs.

**[NEEDS SOURCE URL]**: Three-way match standards, APQC PCF process-compliance metrics, SAP
audit-control documentation

---

### Risk — Composite Risk sub-score (18% weight)

```
Risk = 100 - (0.6 × country_distance + 0.4 × roster_concentration)
```

**Where**:
- `country_distance` = geographic/trade-proximity risk tier: ID 0 / ASEAN 30 / Asia-Pacific 60
  / other 100
- `roster_concentration` = continuous supply-availability measure (0–100) from the number of
  alternative suppliers in the same category across the full roster: single-source → 100,
  ≥5 alternatives → 0, graded in between. This is the **same roster signal the Kraljic
  supply-concentration axis uses** (scaled to 0–100), so the composite and Kraljic agree on
  concentration.

**Polarity**: Higher score = SAFER (opposite of Kraljic supply risk — see Section 4)

**Structural by design**: Risk carries **no complaint term** (removed — complaints belong to
Quality, and keeping them here double-counted) and **no binary single-source flag** (replaced
by the continuous roster measure above). It is purely structural: geography + supplier
availability.

**[NEEDS SOURCE URL]**: Country-risk indices (World Bank governance indicators possibly),
supplier-concentration risk methodology

**⚠️ WEAKNESS TO ACKNOWLEDGE**: `country_distance` uses a coarse 4-tier scheme (0/30/60/100)
based on geographic and trade proximity — a crude proxy. Defense: "A more principled approach
would map to World Bank Worldwide Governance Indicators — flagged as future refinement."

---

## 3. SOURCES BY DIMENSION

**⚠️ MAJOR GAP**: I don't have the URL library from your earlier chats. What follows is a
template to fill in from your existing source materials (the ~47 sources referenced in the
Procurement Learning Dashboard).

### Frameworks generally cited across dimensions
- **CIPS Supplier Performance Management** — `[NEEDS URL]`
- **APQC Process Classification Framework (PCF)** — `[NEEDS URL]`
- **ISM (Institute for Supply Management)** — `[NEEDS URL]`

### Per dimension
| Dimension | Suggested source types | URL |
|---|---|---|
| Quality | ASQ defect-rate methodology, Six Sigma DPMO standards | `[NEEDS URL]` |
| Delivery | KPI Depot OTD benchmarks, APQC delivery KPIs | `[NEEDS URL]` |
| Process | APQC three-way match, SAP audit controls | `[NEEDS URL]` |
| Risk (composite) | Supplier-risk methodology (Ivalua, Coupa) | `[NEEDS URL]` |
| Supply Risk (Kraljic) | Kraljic 1983 HBR article, CIPS Kraljic guide | `[NEEDS URL]` |

**Kraljic original**: Kraljic, Peter (1983). "Purchasing Must Become Supply Management."
*Harvard Business Review*, September 1983. `[URL if available]`

---

## 4. KRALJIC SUPPLY RISK METHODOLOGY

### Formula (`python/compute_analyses.py`)

```
supply_risk = supply_concentration + cost_premium + import_friction   (clipped to [0,100])
```

**Components (summed, higher = riskier)**:

| Component | What it captures | Range |
|---|---|---|
| supply_concentration | # of alternative suppliers in the category across the full roster (single-source → 50, ≥5 alternatives → 0) — merges the old single-source flag + competition into one roster-derived measure | 0–50 |
| cost_premium | Period-scoped item-price premium vs the spend-weighted item benchmark (only for benchmarkable items) | 0–25 |
| import_friction | Indonesia trade-agreement coverage: ID 0 / ASEAN (AFTA) 8 / RCEP non-ASEAN 16 / other 25 | 0/8/16/25 |

**Total supply_risk**: sum of the three components (max 50+25+25 = 100), used as the Kraljic
Matrix Y-axis. The former `single_source + competition + country + switching` scheme was
replaced — the stored single-source flag contradicted the actual roster ~91% of the time and
double-counted with competition, so both were merged into the roster-derived
`supply_concentration`.

### Kraljic Matrix quadrants (from supply_risk × spend, median split)

| Quadrant | Spend | Supply Risk | Sourcing strategy |
|---|---|---|---|
| Strategic | High | High | Partnership, joint development |
| Leverage | High | Low | Competitive tendering, use buying power |
| Bottleneck | Low | High | Ensure continuity, dual-source |
| Routine | Low | Low | Standardize, automate |

### Critical distinction — TWO risk scores

**This is the #1 defense trap**. Same word "risk", different formulas, opposite polarity:

| | Composite Risk (sub-score) | Kraljic Supply Risk |
|---|---|---|
| Lives in | Performance composite (18% weight) | Kraljic Matrix Y-axis |
| Formula | `100 − (0.6·country + 0.4·concentration)` | `concentration + cost_premium + import_friction` |
| Direction | Higher = SAFER | Higher = RISKIER |
| Country scale | 0/30/60/100 (distance) | 0/8/16/25 (import friction) |
| Purpose | Operational reliability | Strategic positioning |
| Question it answers | "Is this supplier structurally low-risk?" | "If they disappeared, how stuck would we be?" |

Both use the **same roster-concentration signal** (single-source → high risk), so they agree on
availability — but they weight and frame it differently, and their polarities are opposite by
design.

**Defense line**: "If asked about 'the risk score', I clarify which one — the two measure
different things and have opposite polarity by design."

---

## 5. KEY DEFENSE FRAMING

### The core defense argument

**"Dimensions are prescribed by frameworks. Weights are organization-calibrated. The score is
scoped to what the transaction data measures directly."**

Longer version:

> "Every element of the composite score reflects a specific procurement framework:
> - The FOUR dimensions (Quality, Delivery, Process, Risk) follow CIPS Supplier Performance
>   Management practice and APQC Process Classification Framework, scoped to signals the
>   transactional dataset measures directly (a Service dimension built on manual RFx estimates
>   was removed for that reason — its weight redistributed proportionally, priorities unchanged).
> - The FORMULAS within each dimension use standard KPIs (OTD%, defect rate, 3-way match) with
>   industry-benchmarked bounds.
> - The WEIGHTS reflect Adaro's mining-industry priorities — no framework prescribes universal
>   weights because industry context varies. Aviation weights safety differently than retail;
>   mining weights operational reliability differently than SaaS.
> - The BOUNDS on each metric use industry thresholds: Six Sigma for defects, mining-equipment
>   norms for lead time, audit targets for 3-way match."

### Anticipated challenges

**Challenge**: "Why 30% on Quality and not 25%?"
**Defense**: "The 30/30/22/18 distribution keeps Quality + Delivery dominant at 60%
(operational-risk floor for mining), Process at 22% for audit priority, Risk at 18% as the
structural signal. These weights came from removing the survey-based Service dimension and
redistributing its share proportionally across the remaining four — the relative ordering is
unchanged. Alternative weightings would be defensible with corresponding rationale — this is a
calibration choice, not a mathematical constraint."

**Challenge**: "Why did you remove the Service dimension?"
**Defense**: "Service relied on RFx response rate and average response time — manual,
survey-style estimates that aren't present in the transactional data. Rather than carry a
dimension the transactions can't support, I scoped the composite to directly-measured signals
and redistributed Service's weight proportionally, which leaves the other dimensions' relative
priorities intact. This makes every input in the score traceable to a transaction."

**Challenge**: "Why not use a standard weight from CIPS?"
**Defense**: "CIPS prescribes the framework and dimension selection but leaves weight
calibration to the organization. Universal weights across industries would be methodologically
weaker, not stronger."

**Challenge**: "What if defect rate is only 3% — is the 10% bound realistic?"
**Defense**: "The bound is the ceiling for norm_low — a supplier at 10% scores 0, a supplier at
0% scores 100. Real defect rates in the dataset are much lower. The 10% ceiling handles the
theoretical worst-case; tighter bounds would compress the score range and hurt discrimination
between suppliers."

**Challenge**: "Should the analytics reclassify suppliers into tiers?"
**Defense**: "No — and an earlier 'tier reclassification' recommendation was deliberately
dropped for exactly this reason. A supplier's tier is a **declared** contractual attribute set
at onboarding, not something the analytics should compute or override. Treating a computed
score as a tier verdict conflates 'current operational performance' with 'contractual identity'
— two different things. Because the declared tier added no analytical signal and invited that
confusion, tier was removed from the dashboard entirely; performance is reported on its own
terms via the composite and the Kraljic/performance positioning."

**Challenge**: "Two 'risk' scores — that's confusing."
**Defense**: "Fair point — this is the trap in the methodology. Composite Risk (in the
performance scorecard) asks 'is this supplier structurally low-risk?' Kraljic Supply Risk (on
the strategic matrix) asks 'if they disappeared tomorrow, how stuck would we be?' Same word,
different questions, opposite polarity by convention. They share the roster-concentration signal
but weight and frame it differently. Renaming one could reduce confusion — flagged as future
refinement."

---

## 6. ACTION PRIORITIES (recommendation categories)

The Action Priorities view turns the three diagnostic analyses (Spend / Suppliers / Process)
into acknowledged, prioritized actions. Current categories (`python/compute_analyses.py`,
`recommendations_analysis()`):

**From Spend:**
- **Concentration** — categories where spend is most concentrated (resilience exposure, not
  performance).
- **Critical Spend** — the A-tier "vital few" (reuses the ABC 80/95 classification), your
  largest relationships, warranting the most oversight.
- **Tail Spend** — the long tail of sub-1% suppliers; consolidation candidates.

**From Suppliers:**
- **Critical Issues Engagement** — high-spend suppliers performing below the portfolio median.
- **Hidden Gems Promotion** — strong performers with small current spend.
- **Bottleneck Risk Mitigation** — low-spend but hard-to-replace (high supply risk, few
  alternatives).

**From Process:**
- **Process Improvement** — the worst three-way-match compliance quadrant.
- **Slowest Stage** — the internal procure-to-pay stage(s) above the 8-day flag.

**Dropped — "Tier Reclassification".** An earlier version recommended reclassifying suppliers
whose computed score disagreed with their declared tier. This was removed as incompatible with
the declared-not-computed principle (see §5): tier is a contractual attribute, not an analytics
output, and the app no longer surfaces tier at all. Do not reintroduce it.

---

## 7. WHAT TO PULL FROM YOUR EXISTING MATERIALS

To complete this doc for defense-ready quality, extract from your earlier chats/materials:

1. **The 47-source library** — pull specific URLs mapped to each dimension
2. **CIPS Supplier Performance Management guide URL** — cited as framework backbone
3. **APQC PCF procurement KPI URLs** — backs multiple dimensions
4. **Kraljic original HBR article citation** — backs supply-risk methodology
5. **Any Ivalua/Coupa/KPI Depot references** — backs specific KPI definitions
6. **Country-risk index reference** — for defending country_distance tiers
7. **Six Sigma / ASQ references** — for defending the defect-rate bound

## 8. HONEST GAPS TO ACKNOWLEDGE IF ASKED

- `country_distance` uses a coarse geographic/trade-proximity binning — crude proxy, would
  improve with World Bank governance indicators.
- The composite's Risk sub-score is purely structural (geography + roster concentration) — it
  intentionally carries no live performance signal; operational reliability lives in Quality /
  Delivery / Process instead.
- `norm_low` / `norm_high` are simple linear, clamped [0,100] normalizations against fixed
  industry bounds (not population min/max) — chosen for stability and transparency, not
  sophistication.
- Sub-score aggregation within each dimension (averaging two normalized inputs) is a simple
  mean — some frameworks weight the sub-inputs; ours doesn't, for simplicity and transparency.

Being upfront about known weaknesses strengthens the defense — the supervisor sees you
understand the methodology's limits rather than presenting it as perfect.

---

## FINAL DEFENSE SLIDE (one-liner summary)

> "The composite scorecard follows standard SRM practice — four dimensions prescribed by CIPS
> and APQC, scoped to signals the transaction data measures directly (a survey-based Service
> dimension was removed and its weight redistributed proportionally). Formulas are built from
> industry-standard KPIs with benchmarked bounds; weights are calibrated for mining-industry
> operational priorities. Two 'risk' scores exist by design — one structural, part of the
> composite; one strategic, the Kraljic Y-axis — with opposite polarity. Tier is declared, not
> computed — and was removed from the dashboard entirely rather than reverse-engineered from a
> score."
