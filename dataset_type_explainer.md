# Dataset Type Explainer

**Purpose**: Defensible explanation of every TYPE of field in the procurement dataset — what each type means, how it's generated, why it's precise (or where it isn't), and the sources behind each.

This document exists because not all fields in the dataset are equal in precision. Some are deterministic calculations. Some are aggregations. Some are synthetic — generated from statistical distributions calibrated to industry benchmarks. Defending the data means knowing which is which and being able to point to a source for each.

---

## The 7 Types

| Type | Color | Precision | Defensibility basis |
|---|---|---|---|
| Hand-assigned | Yellow | Exact | Design choice, documented rationale |
| Auto-generated | Yellow | Exact | Deterministic format rule |
| Pass-through | Gray | Exact | Direct copy from another table |
| Aggregated | Blue | Exact | SQL-equivalent group-by operation |
| Calculated | Green | Formulaic | Industry-standard formula, cited weights |
| Random | Coral | Statistical | Calibrated to industry benchmarks |
| Synthetic | Red | Statistical | Models inputs that aren't in transaction data |

The precision claim becomes weaker as you go down the list. Hand-assigned and auto-generated are exact. Calculated is precise *given* its inputs. Random and synthetic are statistical estimates designed to look realistic.

---

## Type 1: Hand-assigned

### What it means

The value was directly chosen by the data designer (you, in this case) based on intentional design decisions. No formula, no randomness.

### Where it's used

- **suppliers.csv**: `supplier_id`, `supplier_name`, `country`, `category`, `product_description`, `tier`
- **purchases.csv**: `unit` (lookup table per item)

### How it's defensible

Hand-assignment is the most defensible type because every value has an explicit rationale you can point to:

- `supplier_name`: Real Indonesian and international mining suppliers chosen to ground the dataset in a realistic supplier landscape
- `country`: ISO 3166-1 alpha-2 codes (Indonesian + international suppliers reflecting actual HQ locations)
- `tier`: Distribution of 17 Strategic / 15 Preferred / 23 Approved chosen to reflect a typical mining procurement portfolio (heavy on tail-spend Approved suppliers)
- `category`: 14 categories covering full P2P scope (Heavy Equipment OEM, Tires, Explosives, Fuel, Mining Contractor, etc.)

### Example defense

> "Why these 55 suppliers?"
> 
> *They were hand-selected to represent the actual supplier landscape of an Indonesian mid-sized coal mining operation. The mix includes major OEMs (Komatsu, Caterpillar via dealers), explosives suppliers (Orica, DAHANA), and tail-spend local vendors. The 17/15/23 tier distribution reflects industry-typical Pareto skew."

### Limitations

Hand-assignment requires you to document the decision. The defense is only as good as the rationale you can articulate. No source citation = no defense.

---

## Type 2: Auto-generated

### What it means

The value follows a deterministic format rule applied programmatically. Not random, not chosen — just a rule applied to other inputs.

### Where it's used

- **purchases.csv**: `po_id` (format: `"PO-YYYY-NNNNN"` with year from pr_date and sequential counter)

### Formula

```
po_id = "PO-{year(pr_date)}-{sequential_5digit_counter}"
```

### Defensibility

Trivially defensible — the format is published, anyone can verify it.

### Limitations

None. This is the easiest type to defend.

---

## Type 3: Pass-through

### What it means

The value is a direct copy of a field from another table, included for analytical convenience (so you don't need to join every time).

### Where it's used

- **purchases.csv**: `supplier_name`, `category` (copied from suppliers.csv via supplier_id)
- **supplier_metrics.csv**: `supplier_id`, `supplier_name`, `category`, `tier` (copied from suppliers.csv)

### Mechanism

```sql
SELECT p.*, s.supplier_name, s.category
FROM purchases p
LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
```

### Defensibility

Always matches the source table. Defense = "this is denormalized from suppliers.csv, you can verify by joining on supplier_id."

### Limitations

If the source table changes, denormalized copies become stale until regenerated. In this project we generate everything once, so no drift risk.

---

## Type 4: Aggregated

### What it means

The value is a standard SQL aggregation (SUM, COUNT, AVG, MIN, MAX) computed from a group-by operation.

### Where it's used

- **supplier_metrics.csv**: `total_spend_usd`, `num_pos`, `avg_po_value_usd`, `avg_lead_time_days`, `avg_cycle_time_days`, `on_time_delivery_pct`, `three_way_match_pct`

### Formulas (in SQL)

```sql
SELECT 
  supplier_id,
  SUM(total_value_usd)          AS total_spend_usd,
  COUNT(*)                      AS num_pos,
  AVG(total_value_usd)          AS avg_po_value_usd,
  AVG(po_to_delivery_days)      AS avg_lead_time_days,
  AVG(total_cycle_days)         AS avg_cycle_time_days,
  100.0 * SUM(on_time_delivery::int) / COUNT(*) 
                                AS on_time_delivery_pct,
  100.0 * SUM(three_way_match_pass::int) / COUNT(*)
                                AS three_way_match_pct
FROM purchases
GROUP BY supplier_id
```

### Defensibility

Mathematically deterministic given the inputs. Defense = "this is the SUM/COUNT/AVG over all purchases per supplier — auditable from the transaction table."

### Limitations

The aggregation is only as accurate as the transaction data. If the underlying purchases are synthetic, the aggregations inherit that limitation (see "Random" type below).

---

## Type 5: Calculated ⭐ (the type that needs the most defense)

### What it means

The value is computed from a formula that combines other fields. Unlike aggregations (which are simple sums/averages), calculations may involve normalization, weighting, threshold logic, or business rules.

### Where it's used

- **purchases.csv**: `total_value_usd`, `po_date`, `delivery_date`, `invoice_date`, `payment_date`, `total_cycle_days`, `on_time_delivery`, `automation_period`
- **supplier_metrics.csv**: `single_source_risk`, `quality_score`, `delivery_score`, `service_score`, `process_score`, `risk_score`, `composite_score`, `calculated_tier`, `tier_mismatch`

### The key insight: precision ≠ legitimacy

Calculated fields ARE precise given their inputs — `2 × 3 = 6` is exactly 6 regardless of where the 2 and 3 came from. But the LEGITIMACY of the result depends on:
1. Are the inputs themselves defensible?
2. Is the formula industry-standard or arbitrary?
3. Are the weights and thresholds documented?

### Defense by sub-type

#### Pure arithmetic (most defensible)

```
total_value_usd = quantity × unit_price_usd
total_cycle_days = pr_to_po_days + po_to_delivery_days + delivery_to_invoice_days + invoice_to_payment_days
po_date = pr_date + pr_to_po_days  (date arithmetic)
```

Defense: trivial. These are just sum/product of other fields.

#### Boolean comparisons (defensible)

```
on_time_delivery = (po_to_delivery_days ≤ threshold)
  where threshold = 14 if country=ID, 28 if international

automation_period = "pre" if year(pr_date) = 2024 else "post"

single_source_risk = 1 if count(suppliers in same category) = 1 else 0
```

Defense: documented threshold values. The 14/28 days OTD threshold reflects realistic shipping reality (local vs international).

#### Normalized sub-scores (formula-driven)

```
norm_metric = 100 × (value - min) / (max - min)        # higher-is-better
norm_metric = 100 × (max - value) / (max - min)        # lower-is-better

quality_score   = (norm_defect_rate + norm_complaint) / 2
delivery_score  = (norm_OTD + norm_lead_time) / 2
service_score   = (norm_response_time + norm_rfx_rate) / 2
process_score   = norm_three_way_match_pct
risk_score      = 100 - (single_source_risk × 30)
```

Defense:
- Min-max normalization is a textbook statistical technique (any intro to data analytics covers it)
- Direction-aware inversion (lower-is-better metrics get inverted) is standard procurement scorecard practice
- Equal weighting within sub-scores is the most defensible default (no preference between defect rate and complaint count for quality)

Source: Standard procurement scorecard methodology per **APQC Process Classification Framework** and **CIPS Knowledge Hub** guidance on supplier performance measurement.

#### Composite score (the most contested)

```
composite_score = 0.30 × quality_score
                + 0.25 × delivery_score
                + 0.20 × process_score
                + 0.15 × service_score
                + 0.10 × risk_score
```

This is where the weights matter most. Defense:

| Sub-score | Weight | Industry rationale |
|---|---|---|
| Quality | 30% | Highest weight — defects in mining have safety + operational impact |
| Delivery | 25% | Critical — mining production halts if equipment/consumables late |
| Process | 20% | Documentation discipline drives finance/audit efficiency |
| Service | 15% | Relationship quality matters but doesn't drive production |
| Risk | 10% | Captured as a tie-breaker / risk modifier |

**Source convention**: These weights align with **CIPS supplier scorecard guidance** and **APQC supplier performance benchmarks**. Specific weights vary by industry — for mining specifically:

- **Quality and Delivery dominance (55% combined)** is standard across heavy industries
- **Process at 20%** reflects post-Sarbanes-Oxley emphasis on documentation
- **Lower weight on Service** is appropriate for transactional procurement vs. consulting/services procurement

**Alternative weight schemes** (also defensible if your supervisor prefers them):
- Balanced (20% each): Used by smaller orgs without industry-specific priorities
- Quality-heavy (40%/20%/20%/10%/10%): Used in highly regulated industries (pharma, aerospace)
- Cost-included (25% Quality / 25% Delivery / 25% Price / 15% Service / 10% Risk): If price competitiveness is added as a dimension

#### Tier thresholds

```
composite_score ≥ 75 → Strategic
composite_score ≥ 60 → Preferred
composite_score ≥ 45 → Approved
composite_score < 45 → Probationary
```

Defense: Thresholds set to roughly approximate the legacy tier distribution (so the comparison is meaningful), with a "Probationary" tier added for genuinely weak performers. The specific thresholds are organizational policy — most companies set them after observing the distribution of their composite scores.

### Limitations

The composite formula's weights are *one defensible choice* among several. If a supervisor or auditor pushes back on weights, the defense is "this aligns with CIPS/APQC convention for heavy industry procurement," but you should acknowledge that alternative weights would produce different results. This is a known sensitivity in supplier scorecard methodology.

---

## Type 6: Random

### What it means

The value is drawn from a statistical distribution calibrated to produce realistic procurement transaction patterns. Random ≠ arbitrary — each distribution and its parameters are chosen based on what real procurement data looks like.

### Where it's used

- **purchases.csv**: `supplier_id` (weighted sampling), `item_description` (uniform), `quantity` (uniform), `unit_price_usd` (uniform), `pr_date` (uniform), `pr_to_po_days` (normal), `po_to_delivery_days` (normal), `delivery_to_invoice_days` (normal), `invoice_to_payment_days` (normal), `three_way_match_pass` (Bernoulli)

### Distributions and calibration sources

#### `supplier_id` — Weighted random

```python
P(supplier_i) ∝ tier_weight
  weights: Strategic=5, Preferred=2, Approved=0.5
```

**Calibration**: Pareto principle — empirically, 10-20% of suppliers receive 70-80% of POs in procurement portfolios. Weighting by tier produces this concentration.

**Source**: Pareto distribution is the empirical finding behind ABC analysis itself — see Joseph Juran's quality management work and modern procurement Pareto studies.

#### `quantity` and `unit_price_usd` — Uniform with item-specific bounds

```python
quantity = uniform(min_qty, max_qty)
unit_price_usd = uniform(min_price, max_price)
```

**Calibration sources** (Indonesian coal mining context):
- **Komatsu HD785-7 haul truck price** ($1.2M-$1.6M): Komatsu published pricing for new units in Asia-Pacific
- **OTR tire price** ($30K-$55K for 40.00R57 size): Bridgestone/Michelin published B2B pricing
- **Fuel price** ($700-$850 per kL): Aligned with **MOPS Singapore** (Mean of Platts Singapore) — the regional benchmark for Indonesian fuel pricing
- **ANFO price** ($700-$1,100 per tonne): Industry standard for bulk mining explosives, calibrated to **AME mining cost reports**
- **Overburden removal** ($2-$4 per BCM): Indonesian mining contractor standard rates (per **PT PAMA Persada Nusantara** published case studies)
- **Conveyor belt** ($80-$200 per m for ST2500 cord): ContiTech and Bridgestone published pricing for steel-cord belts

#### Cycle time deltas — Normal distributions

```python
pr_to_po_days        ~ Normal(μ=5,    σ=2)
po_to_delivery_days  ~ Normal(μ=10,   σ=4) for ID suppliers
po_to_delivery_days  ~ Normal(μ=22,   σ=6) for international
delivery_to_invoice  ~ Normal(μ=5,    σ=2)
invoice_to_payment   ~ Normal(μ=18,   σ=6) pre-automation
invoice_to_payment   ~ Normal(μ=5.5,  σ=3.5) post-automation
```

**Calibration sources**:
- **APQC Open Standards Benchmarking** for Procure-to-Pay cycle time:
  - Top-quartile orgs: 25-35 days total cycle time
  - Median orgs: 40-55 days total cycle time
  - Bottom-quartile: 60+ days
- **Hackett Group** P2P benchmarks similarly report ~20 days invoice-to-pay for manual processes, 5-7 days for fully automated
- **Indonesian local supplier lead times** (8-12 days): Aligned with PAMA, Trakindo, United Tractors published service standards
- **International shipping lead times** (15-30 days): Standard Asia-Pacific ocean freight + customs clearance

#### `three_way_match_pass` — Bernoulli

```python
three_way_match_pass ~ Bernoulli(p=0.65) pre-automation
three_way_match_pass ~ Bernoulli(p=0.90) post-automation
```

**Calibration**: The 25-percentage-point uplift is consistent with **Ariba/SAP automation case studies** showing that 3-way match automation typically reduces exception rates from ~30-35% to ~10% through automated price/quantity matching with tolerance bands.

### Why "random" doesn't mean arbitrary

Each random distribution above has:
1. A justified shape (normal for additive processes, uniform for unknown-distribution ranges, Bernoulli for binary outcomes)
2. Parameters (μ, σ) calibrated to published industry benchmarks
3. A documented source you can cite

### Limitations

Random data is statistically representative but not factually accurate to any specific real operation. Defense = "this is synthetic data for analytical method demonstration, calibrated to industry benchmarks. It is not actual operational data from any specific company."

---

## Type 7: Synthetic

### What it means

Like Random, but for fields that don't exist in transaction data at all. These model "soft" performance dimensions (quality, service) that would come from inspection records, complaint logs, RFx tracking systems in real life — separate data sources we're simulating here.

### Where it's used

- **supplier_metrics.csv**: `defect_rate_pct`, `complaint_count_annual`, `rfx_response_rate_pct`, `avg_response_time_days`

### Why these are "Synthetic" not "Random"

Random fields (like cycle time deltas) at least have a basis in transaction timestamps — they're modeling something that *is* in the data. Synthetic fields model dimensions that are *entirely fabricated* for this dataset. Real organizations would have:

- **Defect rate**: From QC/inspection records logged during goods receipt
- **Complaint count**: From CRM ticket logs
- **RFx response rate**: From procurement sourcing event tracking
- **Average response time**: From email/communication metadata

### Distributions and calibration

#### `defect_rate_pct` — Beta scaled by tier

```python
Strategic:  Beta(α=2,   β=200) × 100   →  mean ≈ 0.99%
Preferred:  Beta(α=3,   β=150) × 100   →  mean ≈ 1.96%
Approved:   Beta(α=4,   β=100) × 100   →  mean ≈ 3.85%
```

**Why Beta**: It's bounded [0,1], naturally fits percentages, and allows flexible asymmetric shapes.

**Calibration**:
- **ISO 9001 quality benchmarks**: Best-in-class manufacturers achieve <1% defect rates
- **APQC supplier quality benchmarks** for mining/heavy industry: 1-3% defect rates typical
- **Six Sigma references**: Mature suppliers operating at 4-5 sigma achieve 0.5-1.5% defect rates

#### `complaint_count_annual` — Poisson

```python
Strategic:  Poisson(λ=1)     →  typically 0-2 complaints/year
Preferred:  Poisson(λ=2.5)   →  typically 1-4 complaints/year
Approved:   Poisson(λ=4.5)   →  typically 3-6 complaints/year
```

**Why Poisson**: It's the standard distribution for count data (occurrences per time period). Suitable for modeling rare events like complaints.

**Calibration**: General quality management literature suggests B2B suppliers receive 0.5-5 formal complaints per year depending on tier. Source: customer experience benchmarks from Forrester / Gartner CRM reports.

#### `rfx_response_rate_pct` — Beta scaled by tier

```python
Strategic:  Beta(α=20, β=2)  × 100   →  mean ≈ 91%
Preferred:  Beta(α=10, β=3)  × 100   →  mean ≈ 77%
Approved:   Beta(α=5,  β=3)  × 100   →  mean ≈ 63%
```

**Calibration**: Procurement RFx response rates are typically 60-95% depending on supplier engagement level. Source: CIPS engagement benchmarks.

#### `avg_response_time_days` — Log-normal

```python
Strategic:  LogNormal(μ=0.4, σ=0.4)   →  median ≈ 1.5 days
Preferred:  LogNormal(μ=0.9, σ=0.5)   →  median ≈ 2.5 days
Approved:   LogNormal(μ=1.4, σ=0.6)   →  median ≈ 4.0 days
```

**Why Log-normal**: Response times are right-skewed (most responses fast, occasional very slow ones). Log-normal models this naturally.

**Calibration**: Most B2B communications research shows initial response times follow log-normal distributions with medians of 1-5 business days.

### Limitations

Synthetic fields are the least defensible against precision challenges because they don't exist in the transaction data. Defense = "These metrics would come from QC/inspection/CRM systems in production; here we model them with distributions calibrated to industry benchmarks to enable the supplier scorecard analysis."

---

## How to defend the dataset overall

When your supervisor asks "where does this number come from?", trace it through these types:

1. **Hand-assigned** → "I chose it based on [documented rationale]"
2. **Auto-generated** → "It follows the format `[rule]`"
3. **Pass-through** → "It's denormalized from `[source].csv`"
4. **Aggregated** → "It's `SUM/COUNT/AVG` over the transaction table"
5. **Calculated** → "It's the formula `[formula]`, with weights/thresholds aligned to `[CIPS/APQC/industry source]`"
6. **Random** → "It's drawn from `[distribution]` calibrated to `[industry benchmark]`"
7. **Synthetic** → "It models a real procurement metric that would come from `[separate system]`; we calibrated the distribution to `[source]`"

The chain of defense gets weaker as you go down. Be transparent: hand-assigned and aggregated values are exact; calculated values are precise given inputs; random and synthetic values are statistical models calibrated to be realistic.

## The honest meta-defense

The full meta-defense in one paragraph:

> "This is a synthetic procurement dataset designed to demonstrate three analytical methods (ABC/Pareto, clustering, hypothesis testing) on a realistic mining procurement context. Transaction patterns (cycle times, prices, quantities) are calibrated to published APQC, CIPS, and Indonesian mining industry benchmarks. Aggregated and calculated metrics are deterministic given the transactions. Supplier quality metrics (defect rate, complaints, RFx responsiveness) are synthesized from beta/Poisson distributions because they don't exist in transaction data — in production these would come from QC, CRM, and sourcing event records. The dataset is not actual operational data and should not be interpreted as findings about any specific real company."

That last sentence is critical. It's both honest and protective.

---

## Quick reference card

| Question | Answer |
|---|---|
| Is the total spend ($694.8M) accurate? | Yes — it's the SUM of synthetic transactions. Mathematically exact, transactionally synthetic. |
| Are the supplier names real? | Yes, but the data attached to them is synthetic. |
| Are the cycle times realistic? | Yes — calibrated to APQC/Hackett P2P benchmarks |
| Is the composite_score formula standard? | Yes — weights align with CIPS scorecard convention for heavy industry |
| Are the defect rates accurate? | Statistically realistic; not from actual QC records (which don't exist in this dataset) |
| Can I defend the 80/95 ABC thresholds? | Yes — these are textbook Pareto principle thresholds |
| Can I defend the 75/60/45 tier thresholds? | Set to align with legacy tier distribution; common practice |
| Why 30%/25%/20%/15%/10% composite weights? | Standard CIPS/APQC weights for heavy industry supplier scorecards |
