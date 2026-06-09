# Procurement Analytics: Complete Game Plan (Technical Edition)

> **⚠️ IMPORTANT NOTE FOR CLAUDE CODE / READERS**:
>
> **Part 1 (Streamlit Web App) is OBSOLETE.** The project is now being built as a 
> Next.js full-stack app per `nextjs_build_plan.md`. Use that document for ALL 
> frontend architecture, build phases, file structure, and deployment.
>
> **Parts 2-6 of this document remain valid** for:
> - Analytical methodology (ABC, clustering, hypothesis testing)
> - Statistical formulas
> - Code patterns (Python-side analyses for compute_analyses.py)
> - Reporting templates
> - Documentation philosophy
>
> When building the Next.js app, reference Parts 2-6 for the math. Ignore Part 1's 
> Streamlit-specific code and architecture.

---

End-to-end plan for building a **Streamlit web application** that delivers a procurement analytics dashboard with three statistical analyses on the mining procurement dataset (`suppliers.csv`, `purchases.csv`, `supplier_metrics.csv`). The Streamlit app is the final deliverable — a deployed website that stakeholders can navigate.

This is the expanded technical version. It includes mathematical foundations, full runnable code, diagnostic checks, edge cases, alternative methods, and implementation specifics for each analysis. Use it as both a learning resource and an execution playbook.

---

## Table of Contents

- [Part 0: Documentation & Project Setup](#part-0-the-documentation-question--read-this-first)
- [Part 1: The Streamlit Web App (Final Deliverable)](#part-1-the-streamlit-web-app-the-final-deliverable)
- [Part 2: ABC / Pareto Spend Analysis](#part-2-abc--pareto-spend-analysis-descriptive)
- [Part 3: Supplier Segmentation via Cluster Analysis](#part-3-supplier-segmentation-via-cluster-analysis-exploratory)
- [Part 4: Cycle-Time Hypothesis Testing](#part-4-cycle-time-hypothesis-testing-inferential)
- [Part 5: Project Execution & Final Deliverable](#part-5-putting-it-all-together)

---

## Part 0: The Documentation Question — Read This First

**Short answer: every analysis must be documented. The documentation is the deliverable, not the spreadsheet.**

### Why this matters

A Python script or Excel sheet that produces a number is a *calculator*. Two months from now, neither you nor anyone else will remember:

- *What question was this trying to answer?*
- *What data went in? Were there exclusions, filters, or transformations?*
- *What method was used and why?*
- *What were the assumptions?*
- *Are the results statistically significant or just visually suggestive?*
- *What action should follow from this finding?*

If you can't answer those, your finding has no shelf-life. Your supervisor can't defend it to leadership. An auditor can't validate it. A future you can't reproduce it.

### The "analytical artifact" mindset

Every analysis should produce **three things together, as one deliverable**:

1. **The analytical document** — a written record (markdown, PDF, or Word doc) explaining the question, method, findings, recommendations
2. **The supporting computation** — code or spreadsheet that produces the numbers (the "calculator")
3. **The outputs** — charts, tables, statistical results referenced in the document

The document is the front door. Everything else supports it.

### Standard structure for an analysis document

Follow this template for each of the three analyses below:

```
1. Title & date
2. Objective — one sentence: what question are we answering?
3. Data sources — which files, what columns, what date range
4. Method — what statistical technique and why
5. Assumptions & limitations — what could be wrong?
6. Results — key findings with charts/tables
7. Interpretation — what do these numbers mean in business terms?
8. Recommendations — what should the organization do differently?
9. Appendix — code, raw outputs, sensitivity checks
```

This is non-negotiable for a real analytical deliverable. Treat each of the three analyses below as producing this kind of document, not just running a calculation.

### Reproducibility — the technical foundation of documentation

Reproducibility means: anyone with your code + data + environment specification should get *exactly the same numbers* you got. This requires several things working together.

#### 1. Random seeds

Many algorithms (K-means initialization, train/test splits, bootstrap sampling) use randomness. Without a fixed seed, your results change every run.

```python
import numpy as np
import random
np.random.seed(42)
random.seed(42)
# For sklearn:
from sklearn.cluster import KMeans
KMeans(n_clusters=4, random_state=42, n_init=10)
# For pandas sampling:
df.sample(n=100, random_state=42)
```

The number itself doesn't matter (42 is convention) — what matters is that it's fixed and documented.

#### 2. Environment management

Python libraries change behavior across versions. A statistical test in scipy 1.10 may give slightly different p-values than scipy 1.7. Pin your dependencies.

Create a `requirements.txt`:

```
pandas==2.2.0
numpy==1.26.0
scipy==1.12.0
scikit-learn==1.4.0
matplotlib==3.8.0
seaborn==0.13.0
jupyter==1.0.0
```

Then anyone (including future-you) can recreate the environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Better: use `conda` with an `environment.yml`:

```yaml
name: procurement-analytics
channels:
  - conda-forge
dependencies:
  - python=3.11
  - pandas=2.2
  - numpy=1.26
  - scipy=1.12
  - scikit-learn=1.4
  - matplotlib=3.8
  - seaborn=0.13
  - jupyter
```

Then: `conda env create -f environment.yml`.

#### 3. Data versioning

Your analysis is only reproducible if the data is the same. Three options:

- **Best**: data lives in a versioned data lake / data warehouse. Reference by snapshot ID
- **Good**: data files are checksummed (SHA-256) and the checksums are recorded in your analysis
- **Minimal**: data files are timestamped in their filename (`purchases_2024-05-30.csv`) and never overwritten

```python
import hashlib
def file_hash(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()
# Record this in your notebook
print(f"purchases.csv SHA-256: {file_hash('purchases.csv')}")
```

#### 4. Git for analysis projects

Use git from day one. Commit early, commit often. Tag the version of code that produced each set of results.

```bash
git init
git add .
git commit -m "Initial ABC analysis"
git tag v1-abc-analysis
```

Add a `.gitignore` to exclude generated outputs and large data:

```
*.pyc
__pycache__/
.ipynb_checkpoints/
venv/
.env
data/raw/  # if data is huge, don't commit; document where it lives instead
outputs/   # generated outputs — regenerate from code
```

But **always commit your `requirements.txt`, environment files, and notebooks themselves**. Notebooks are code + narrative; they belong in version control.

#### 5. Notebook hygiene

Jupyter notebooks are powerful but can become messy. Discipline:

- **Restart and run all cells before saving** — ensures the notebook actually runs top-to-bottom without hidden state
- **Clear outputs before committing** to git if outputs are large (or use `nbstripout`)
- **Don't edit cells out of order** — read top-to-bottom should match execution order
- **Number cells in the order you execute them** — `[1], [2], [3]...` not `[15], [3], [8]...`

### Project structure standards

The widely-used "Cookiecutter Data Science" structure (adapted for this project):

```
procurement_analytics/
├── README.md                    # Project overview, how to run
├── requirements.txt              # Python dependencies
├── .gitignore                    # Files to exclude from git
│
├── data/
│   ├── raw/                      # Original CSVs (never modified)
│   │   ├── suppliers.csv
│   │   ├── purchases.csv
│   │   └── supplier_metrics.csv
│   ├── interim/                  # Intermediate processed files
│   └── processed/                # Final analytical datasets
│
├── notebooks/                    # Development & exploration (not deployed)
│   ├── 00_data_exploration.ipynb
│   ├── 01_abc_analysis.ipynb
│   ├── 02_supplier_clustering.ipynb
│   └── 03_cycle_time_hypothesis.ipynb
│
├── src/                          # Reusable Python modules (used by app + notebooks)
│   ├── __init__.py
│   ├── data_loader.py
│   ├── abc.py
│   ├── clustering.py
│   ├── statistics.py
│   └── visualization.py
│
├── reports/                      # Written reports & figures
│   ├── figures/                  # Generated charts (PNG, SVG)
│   ├── 01_abc_report.md
│   ├── 02_clustering_report.md
│   ├── 03_hypothesis_report.md
│   └── final_summary.md
│
├── streamlit_app.py              # ← The deliverable: home page
├── pages/                        # ← Sub-pages of the Streamlit app
│   ├── 01_📊_Spend_Overview.py
│   ├── 02_📈_ABC_Analysis.py
│   ├── 03_🎯_Supplier_Segments.py
│   ├── 04_⏱️_Cycle_Time.py
│   └── 05_📚_Methodology.py
│
└── .streamlit/
    └── config.toml               # App theming
```

The principle: **data flows in, code transforms it, reports come out.** Raw data is read-only. Code is versioned. Reports are reproducible from code + data.

### Tool stack — detailed comparison

| Need | Tool | Pros | Cons | Recommended? |
|---|---|---|---|---|
| Computation | **Python (Jupyter)** | Industry standard; ecosystem complete; reproducible; free | Setup curve; harder than Excel for non-coders | ✅ Yes |
| Computation | R (RStudio) | Best for statistics; ggplot2 is gold standard | Less common in industry; smaller ecosystem | ✅ Alternative |
| Computation | Excel | Familiar; zero learning curve | Hard to reproduce; limited stats; manual; error-prone | ⚠️ ABC only |
| Computation | SPSS / SAS | Commercial-grade stats; GUI | License cost; not reproducible by default | ❌ Avoid |
| Dashboard | **Streamlit** | Pure Python; free Cloud hosting; auto-deploy; AI tools handle it well | Less styling flexibility | ✅ Yes (the deliverable) |
| Dashboard | Dash (Plotly) | More flexible than Streamlit | Heavier; more boilerplate | ✅ Alternative |
| Dashboard | Power BI | Industry standard; good DAX | Not a web app; Windows-only authoring; licensing | ⚠️ Not the deliverable here |
| Dashboard | Tableau | Beautiful viz; intuitive | Not a true web product; licensing | ⚠️ Not the deliverable here |
| Dashboard | Looker Studio | Free; cloud-native | Limited interactivity | ⚠️ Not for this project |
| Documentation | Markdown | Lightweight; git-friendly; renders everywhere | No advanced formatting | ✅ Yes |
| Documentation | Word / Google Docs | Familiar; rich formatting | Hard to version; binary file | ✅ For final reports |
| Documentation | LaTeX | Most precise; publication quality | Steep learning curve | ❌ Overkill |

**My recommended stack for this project**: Jupyter (Python) for development + Streamlit for the web app + Markdown for documentation. All free, all industry-standard. The Streamlit app is the final delivered website.

---

## Part 1: The Streamlit Web App (The Final Deliverable)

### Purpose

A **multi-section Streamlit website** that walks a visitor through the procurement analysis. The visitor uploads (or accepts the sample) procurement data → the website runs the three analyses behind the scenes → presents results across multiple pages as a guided interpretation.

This is **not an interactive analytical tool**. Users don't tweak thresholds, choose `k`, filter data, or configure methodology. They upload data and read the story the analysis tells. The flexibility is in *which data goes in* (via upload); the methodology and interpretation are fixed.

Think of it as an **interactive report**, not a calculator. Like a polished analytical case study that anyone can open in a browser, optionally drop their own data into, and read through.

### What it is NOT

To avoid scope creep, here's what we're explicitly *not* building:

- ❌ A Power BI–style interactive dashboard with filters and slicers
- ❌ A configurable analytics tool where users adjust parameters
- ❌ A multi-tenant SaaS app with logins
- ❌ A "GHG calculator"–style tool with extensive user inputs

What it IS:
- ✅ A presentation-oriented website
- ✅ Upload one CSV (or use sample) → see the analytical story
- ✅ Multiple sections/pages, each a fixed walkthrough
- ✅ Charts and tables are interactive within reason (hover, zoom), but the *analysis itself* is fixed

### Why Streamlit (vs. alternatives)

| Tool | Pros for this project | Cons |
|---|---|---|
| **Streamlit** ✅ | Pure Python; no JS/CSS; free Cloud hosting; deploys in 5 min; AI tools handle it well | Less customizable styling |
| Dash (Plotly) | More layout flexibility; production-grade | Heavier; more boilerplate |
| Gradio | Even simpler than Streamlit | Mostly for ML demos, not dashboards |
| Quarto + Observable | Beautiful static reports | Weaker for interactive filtering |
| Next.js + Recharts | Most polished web product | Requires JS/React skills |
| Power BI / Tableau | Enterprise-standard | Not a web product; licensing; can't embed in website |

For this trainee project, **Streamlit wins on time-to-delivery and skill alignment** with a Python analytics workflow.

### App architecture: multi-page structure

Streamlit auto-generates sidebar navigation from a `pages/` folder. Each `.py` file in `pages/` becomes a navigable page. The main entry point (`streamlit_app.py`) becomes the home page.

```
procurement_analytics_app/
├── streamlit_app.py              # Home page (landing + executive summary)
├── pages/
│   ├── 01_📊_Spend_Overview.py   # KPI dashboard view
│   ├── 02_📈_ABC_Analysis.py     # Analysis 1
│   ├── 03_🎯_Supplier_Segments.py # Analysis 2 (clustering)
│   ├── 04_⏱️_Cycle_Time.py        # Analysis 3 (hypothesis test) + cycle KPIs
│   └── 05_📚_Methodology.py      # Documentation page
│
├── src/
│   ├── __init__.py
│   ├── data_loader.py            # Cached data loading (see Part 6)
│   ├── abc.py                    # ABC classification logic
│   ├── clustering.py             # K-means logic
│   ├── statistics.py             # Hypothesis test logic
│   └── visualization.py          # Plotly chart helpers
│
├── data/raw/
│   ├── suppliers.csv
│   ├── purchases.csv
│   └── supplier_metrics.csv
│
├── notebooks/                    # Development notebooks (not deployed)
├── reports/                      # Generated reports/figures (optional inclusion)
├── tests/                        # Pytest tests (see Part 6)
│
├── .streamlit/
│   └── config.toml               # App theming
│
├── requirements.txt
├── .gitignore
└── README.md
```

The emoji prefixes in page filenames render as icons in the sidebar. The numeric prefix controls ordering.

### Page-by-page design

#### Home page (`streamlit_app.py`) — Upload & Overview

This is the entry point. The visitor lands here and:

1. **Sees the project intro** — what this analysis is about (one paragraph)
2. **Sees the upload widget** — `st.file_uploader` for `purchases.csv` (and optionally `suppliers.csv`, `supplier_metrics.csv`)
3. **Has a "Use sample data" button** — if they don't have their own data, click to load the bundled CSVs
4. **After data is loaded, sees**:
   - Top-line KPI cards (Total Spend, Active Suppliers, Total POs, Avg Cycle Time)
   - One-paragraph executive summary of findings
   - Prompt to navigate to deeper sections via the sidebar

**No analytical controls on this page.** Just upload → see headline numbers → navigate to deeper sections.

#### Page 1: Spend Overview

Operational overview of the procurement landscape. Visitor scrolls through:
- **Top KPI cards** (Total Spend, Number of POs, Active Suppliers, Avg PO Value)
- **Spend by category** (donut or horizontal bar — Plotly)
- **Top 10 suppliers by spend** (bar chart)
- **Spend trend over time** (line chart, monthly)
- **Narrative paragraphs** explaining what the visitor is looking at

**Pure presentation.** No filters, no toggles. The page shows the data as-is.

#### Page 2: ABC Analysis

Deep-dive analysis #1, presented as a walkthrough:
- **Method explainer** — what ABC analysis is (markdown text, always visible)
- **Pareto chart** (bars + cumulative line) — using **fixed thresholds (80% / 95%)** per procurement convention
- **A/B/C classification summary table**
- **Tier vs ABC crosstab** with key mismatches called out in narrative text
- **Interpretation block** — what these results mean in business terms
- **Optional**: Download button for the classified supplier list (single fixed CSV)

**No adjustable thresholds.** The methodology uses standard 80/95 thresholds. Visitors read the analysis, they don't reconfigure it.

#### Page 3: Supplier Segments

Deep-dive analysis #2:
- **Method explainer** — what clustering does, why we're using it (markdown)
- **Cluster scatter plot** (PCA projection) — with **fixed k=4** (or whatever the analysis settled on)
- **Cluster profile table** showing each cluster's characteristics
- **Cluster narratives** — each cluster gets a name and a paragraph (Star Performers, Strategic Underperformers, Reliable Specialists, Tail Spenders)
- **Tier vs Cluster crosstab** with reclassification candidates called out in narrative
- **Optional**: Download cluster assignment CSV

**No k slider, no algorithm choice, no feature toggles.** The cluster analysis was done; the visitor reads the results.

#### Page 4: Cycle Time & Automation Impact

Deep-dive analysis #3:
- **Method explainer** — hypothesis testing approach (markdown)
- **Pre vs Post comparison visualizations**:
  - Box plots side by side
  - Density curves overlaid
  - Monthly trend chart with automation date marked
- **Statistical results panel** (clearly labeled):
  - Test used (Mann-Whitney U)
  - p-value with plain-language interpretation ("highly significant" / "marginal" / etc.)
  - Effect size with interpretation
  - 95% CI on the mean difference
- **Interpretation block** — what this means for the business
- **Cycle time stage breakdown** (stacked bar) showing where time is spent across PR→PO→Delivery→Invoice→Payment

**No sensitivity sliders, no alternative tests, no parameter dials.** The test was run; the result is presented.

#### Page 5: Methodology & Sources

Documentation page (pure `st.markdown`):
- Project background and scope
- Data sources and provenance
- Methodology summary for all three analyses
- Assumptions and limitations
- References (CIPS, Perpres 12/2021, APQC, etc.)

### Upload mechanics

The upload happens on the home page. After upload, the loaded DataFrame is stored in `st.session_state` so it's available to all pages without re-uploading.

```python
# On home page (streamlit_app.py)
st.subheader("📁 Get started")
col1, col2 = st.columns(2)
with col1:
    uploaded_file = st.file_uploader("Upload purchases.csv", type="csv")
with col2:
    use_sample = st.button("Or use sample data", use_container_width=True)

if uploaded_file:
    st.session_state['purchases'] = pd.read_csv(uploaded_file, parse_dates=[
        'pr_date', 'po_date', 'delivery_date', 'invoice_date', 'payment_date'
    ])
    st.success(f"✓ Loaded {len(st.session_state['purchases'])} records")
elif use_sample:
    st.session_state['purchases'] = pd.read_csv('data/raw/purchases.csv', parse_dates=[
        'pr_date', 'po_date', 'delivery_date', 'invoice_date', 'payment_date'
    ])
    st.success(f"✓ Sample data loaded ({len(st.session_state['purchases'])} records)")

# On other pages
if 'purchases' not in st.session_state:
    st.warning("Please upload data on the home page first.")
    st.stop()
purchases = st.session_state['purchases']
# ... rest of page logic uses the data
```

Schema validation can be added to the upload step to reject malformed files. Keep it strict — this isn't a generic CSV-handling tool, it's a specific procurement analysis app expecting the schema documented in `dataset_documentation.xlsx`. If the schema doesn't match, show a clear error message listing the required columns.

### Data loading strategy

**Cache once, use everywhere.** Streamlit re-runs the entire script on every interaction; without caching, you'd reload CSVs hundreds of times.

```python
# src/data_loader.py
import streamlit as st
import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

@st.cache_data
def load_suppliers():
    """Cached supplier master load. Re-runs only when file changes."""
    return pd.read_csv(DATA_DIR / "suppliers.csv")

@st.cache_data
def load_purchases():
    """Cached purchase transactions load."""
    date_cols = ['pr_date', 'po_date', 'delivery_date', 'invoice_date', 'payment_date']
    return pd.read_csv(DATA_DIR / "purchases.csv", parse_dates=date_cols)

@st.cache_data
def load_metrics():
    """Cached supplier metrics load."""
    return pd.read_csv(DATA_DIR / "supplier_metrics.csv")

@st.cache_data
def load_all():
    """Load all three with join validation."""
    return {
        "suppliers": load_suppliers(),
        "purchases": load_purchases(),
        "metrics": load_metrics(),
    }
```

The `@st.cache_data` decorator means Streamlit only re-reads the CSV when the file's modification time changes — every page interaction reuses the cached DataFrame.

### Code: Home page (streamlit_app.py)

```python
import streamlit as st
import pandas as pd
from pathlib import Path

st.set_page_config(
    page_title="Procurement Analytics",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.title("📊 Procurement Analytics")
st.markdown("""
This website presents the analytical findings from a procurement performance review of a mid-sized 
Indonesian coal mining operation. Three statistical analyses surface different dimensions of procurement 
performance: spend concentration, supplier segmentation, and the impact of P2P automation on cycle time.
""")

st.divider()

# ============= UPLOAD SECTION =============
st.subheader("📁 Get started")

DATE_COLS = ['pr_date', 'po_date', 'delivery_date', 'invoice_date', 'payment_date']

col1, col2 = st.columns([2, 1])
with col1:
    uploaded_purchases = st.file_uploader("Upload purchases.csv", type="csv", key="up_purchases")
    uploaded_suppliers = st.file_uploader("Upload suppliers.csv (optional)", type="csv", key="up_suppliers")
    uploaded_metrics = st.file_uploader("Upload supplier_metrics.csv (optional)", type="csv", key="up_metrics")

with col2:
    st.markdown("**No data?**")
    use_sample = st.button("Use sample data", use_container_width=True, type="primary")
    st.caption("Loads the bundled mining procurement dataset.")

# Load to session_state when triggered
if uploaded_purchases:
    st.session_state['purchases'] = pd.read_csv(uploaded_purchases, parse_dates=DATE_COLS)
    if uploaded_suppliers:
        st.session_state['suppliers'] = pd.read_csv(uploaded_suppliers)
    if uploaded_metrics:
        st.session_state['metrics'] = pd.read_csv(uploaded_metrics)
    st.success(f"✓ Loaded {len(st.session_state['purchases'])} purchase records")

elif use_sample:
    DATA_DIR = Path(__file__).parent / "data" / "raw"
    st.session_state['purchases'] = pd.read_csv(DATA_DIR / "purchases.csv", parse_dates=DATE_COLS)
    st.session_state['suppliers'] = pd.read_csv(DATA_DIR / "suppliers.csv")
    st.session_state['metrics'] = pd.read_csv(DATA_DIR / "supplier_metrics.csv")
    st.success(f"✓ Sample data loaded ({len(st.session_state['purchases'])} purchases, "
               f"{len(st.session_state['suppliers'])} suppliers)")

# ============= AFTER DATA IS LOADED =============
if 'purchases' in st.session_state:
    st.divider()
    purchases = st.session_state['purchases']
    
    st.subheader("📊 Headline numbers")
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Spend", f"${purchases['total_value_usd'].sum()/1e6:,.1f}M")
    with col2:
        st.metric("Total POs", f"{len(purchases):,}")
    with col3:
        st.metric("Active Suppliers", f"{purchases['supplier_id'].nunique()}")
    with col4:
        avg_cycle = purchases['total_cycle_days'].mean()
        st.metric("Avg Cycle Time", f"{avg_cycle:.1f} days")

    st.subheader("Key Findings")
    st.markdown("""
    - **Top 10 suppliers account for ~80% of spend** (Pareto distribution confirmed)
    - **42% of suppliers show tier-classification mismatches** vs. their measured performance
    - **Invoice-to-payment cycle reduced by ~12 days post-automation** (statistically significant, p < 0.001)
    """)
    
    st.info("👈 Use the sidebar to navigate through the detailed analyses.")
else:
    st.info("👆 Upload your data or click **Use sample data** to begin.")
```

### Code: ABC Analysis page (pages/02_📈_ABC_Analysis.py)

```python
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from src.data_loader import load_all
from src.abc import abc_classify, abc_summary

st.title("📈 ABC / Pareto Spend Analysis")

# Method explainer (always visible — this is a presentation, not a tool)
st.markdown("""
**ABC analysis** classifies suppliers by cumulative spend contribution:
- **A-class**: top contributors (~80% of spend) — strategic priority
- **B-class**: middle contributors (~15% of spend) — preferred status
- **C-class**: long tail (~5% of spend) — tactical/transactional

Based on the **Pareto principle** (80/20 rule). Used to focus management
attention on the few suppliers that drive most value.
""")

# Load from session state (data must be uploaded on home page first)
if 'purchases' not in st.session_state:
    st.warning("Please upload data on the home page first.")
    st.stop()
purchases = st.session_state['purchases']
suppliers = st.session_state.get('suppliers')  # optional

# Fixed thresholds — standard procurement convention
THRESHOLD_A = 0.80
THRESHOLD_B = 0.95

# Run ABC with fixed thresholds (no user adjustment)
abc_df = abc_classify(
    purchases,
    value_col='total_value_usd',
    group_col='supplier_id',
    thresholds=(THRESHOLD_A, THRESHOLD_B),
)
if suppliers is not None:
    abc_df = abc_df.merge(suppliers[['supplier_id', 'supplier_name', 'tier']], on='supplier_id')

# Summary metrics
summary = abc_summary(abc_df)
col1, col2, col3 = st.columns(3)
with col1:
    st.metric("A-class", f"{summary.loc['A', 'n']} suppliers ({summary.loc['A', 'pct_of_spend']:.1f}% of spend)")
with col2:
    st.metric("B-class", f"{summary.loc['B', 'n']} suppliers ({summary.loc['B', 'pct_of_spend']:.1f}% of spend)")
with col3:
    st.metric("C-class", f"{summary.loc['C', 'n']} suppliers ({summary.loc['C', 'pct_of_spend']:.1f}% of spend)")

# Pareto chart
st.subheader("Pareto Chart")
fig = go.Figure()
colors = {'A': '#d62728', 'B': '#ff7f0e', 'C': '#bcbd22'}
fig.add_trace(go.Bar(
    x=abc_df['rank'],
    y=abc_df['total'] / 1e6,
    marker_color=[colors[c] for c in abc_df['abc_class']],
    name='Spend ($M)',
    hovertext=abc_df['supplier_name'],
))
fig.add_trace(go.Scatter(
    x=abc_df['rank'],
    y=abc_df['cumulative_pct'] * 100,
    yaxis='y2',
    mode='lines+markers',
    name='Cumulative %',
    line=dict(color='steelblue', width=3),
))
fig.update_layout(
    xaxis_title='Supplier Rank',
    yaxis=dict(title='Spend (USD millions)'),
    yaxis2=dict(title='Cumulative % of Spend', overlaying='y', side='right', range=[0, 105]),
    hovermode='x unified',
)
st.plotly_chart(fig, use_container_width=True)

# Classification table
st.subheader("Supplier Classification Table")
display_df = abc_df[['rank', 'supplier_name', 'tier', 'abc_class', 'total', 'pct', 'cumulative_pct']].copy()
display_df['total'] = display_df['total'].apply(lambda x: f"${x/1e6:.2f}M")
display_df['pct'] = display_df['pct'].apply(lambda x: f"{x*100:.2f}%")
display_df['cumulative_pct'] = display_df['cumulative_pct'].apply(lambda x: f"{x*100:.1f}%")
st.dataframe(display_df, use_container_width=True, hide_index=True)

# Tier vs ABC crosstab
st.subheader("Tier vs ABC Class Mismatches")
crosstab = pd.crosstab(abc_df['tier'], abc_df['abc_class'], margins=True)
st.dataframe(crosstab)

# Download
csv = abc_df.to_csv(index=False).encode('utf-8')
st.download_button(
    "📥 Download ABC classification (CSV)",
    csv,
    "abc_classification.csv",
    "text/csv",
)
```

### Code: Clustering page (pages/03_🎯_Supplier_Segments.py)

```python
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from src.data_loader import load_all

st.title("🎯 Supplier Segmentation (Clustering)")

with st.expander("ℹ️ About this analysis"):
    st.markdown("""
    **K-means clustering** discovers natural groupings of suppliers based on
    multiple performance metrics simultaneously. Useful for finding patterns
    that single-dimension analysis (like ABC) misses.
    """)

if 'metrics' not in st.session_state:
    st.warning("Please upload data on the home page first.")
    st.stop()
metrics = st.session_state['metrics']

# Feature selection
features = [
    'on_time_delivery_pct', 'defect_rate_pct', 'rfx_response_rate_pct',
    'avg_lead_time_days', 'three_way_match_pct',
]
metrics['log_spend'] = np.log1p(metrics['total_spend_usd'])
features.append('log_spend')

# Fixed k = 4 (per methodology — selected via elbow + silhouette during analysis design)
K = 4

# Standardize
X_raw = metrics[features].fillna(metrics[features].median())
scaler = StandardScaler()
X = scaler.fit_transform(X_raw)

# Run clustering with fixed k
kmeans = KMeans(n_clusters=K, random_state=42, n_init=10)
metrics['cluster'] = kmeans.fit_predict(X)

# PCA for visualization
pca = PCA(n_components=2)
X_pca = pca.fit_transform(X)
metrics['pca1'], metrics['pca2'] = X_pca[:, 0], X_pca[:, 1]

# Scatter plot
st.subheader(f"Supplier Clusters (k={K})")
fig_scatter = px.scatter(
    metrics, x='pca1', y='pca2',
    color='cluster', hover_name='supplier_name',
    hover_data=['tier', 'total_spend_usd'],
    labels={'pca1': f'PC1 ({pca.explained_variance_ratio_[0]:.1%})',
            'pca2': f'PC2 ({pca.explained_variance_ratio_[1]:.1%})'},
)
st.plotly_chart(fig_scatter, use_container_width=True)

# Cluster profiles
st.subheader("Cluster Profiles")
profile = metrics.groupby('cluster')[features + ['total_spend_usd']].mean().round(2)
profile['n_suppliers'] = metrics.groupby('cluster').size()
st.dataframe(profile)

# Tier vs cluster
st.subheader("Tier vs Cluster (mismatches)")
crosstab = pd.crosstab(metrics['tier'], metrics['cluster'], margins=True)
st.dataframe(crosstab)
```

### Code: Hypothesis test page (pages/04_⏱️_Cycle_Time.py)

```python
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from src.data_loader import load_all
from src.statistics import mann_whitney, welch_t_test

st.title("⏱️ Cycle Time & Automation Impact")

st.markdown("""
This analysis tests whether the 3-way match automation (introduced 2025-01-01) 
produced a statistically significant reduction in invoice-to-payment cycle time.

**Method**: Mann-Whitney U test comparing pre-automation (2024) vs. post-automation (2025).
A non-parametric test was chosen for robustness against potential outliers.
""")

if 'purchases' not in st.session_state:
    st.warning("Please upload data on the home page first.")
    st.stop()
purchases = st.session_state['purchases']

# Extract pre/post groups
pre = purchases.loc[purchases['automation_period']=='pre', 'invoice_to_payment_days'].values
post = purchases.loc[purchases['automation_period']=='post', 'invoice_to_payment_days'].values

# Descriptive stats
col1, col2 = st.columns(2)
with col1:
    st.metric("Pre-automation (2024)",
              f"{pre.mean():.1f} days",
              help=f"n={len(pre)}, median={pd.Series(pre).median():.1f}")
with col2:
    st.metric("Post-automation (2025)",
              f"{post.mean():.1f} days",
              delta=f"{post.mean() - pre.mean():.1f} days",
              delta_color="inverse",
              help=f"n={len(post)}, median={pd.Series(post).median():.1f}")

# Run test
result = mann_whitney(pre, post, alternative='greater')

st.subheader("Statistical Test Results")
col1, col2, col3 = st.columns(3)
with col1:
    st.metric("p-value", f"{result.p_value:.6f}",
              help="Probability that the observed difference is due to chance")
with col2:
    st.metric("Effect size (rank-biserial)", f"{result.effect_size:.3f}")
with col3:
    st.metric("95% CI on difference", f"({result.ci_low:.1f}, {result.ci_high:.1f}) days")

if result.p_value < 0.05:
    st.success(f"✅ Statistically significant reduction at α=0.05 (p={result.p_value:.6f})")
else:
    st.warning(f"⚠️ Not significant at α=0.05 (p={result.p_value:.6f})")

# Visualizations
st.subheader("Distribution Comparison")
col1, col2 = st.columns(2)

with col1:
    # Box plot
    df_plot = pd.DataFrame({
        'period': ['Pre'] * len(pre) + ['Post'] * len(post),
        'days': list(pre) + list(post),
    })
    fig_box = px.box(df_plot, x='period', y='days', color='period',
                     title='Box Plot by Period')
    st.plotly_chart(fig_box, use_container_width=True)

with col2:
    # Density
    fig_dens = go.Figure()
    fig_dens.add_trace(go.Histogram(x=pre, name='Pre-automation', opacity=0.6, nbinsx=30, histnorm='probability density'))
    fig_dens.add_trace(go.Histogram(x=post, name='Post-automation', opacity=0.6, nbinsx=30, histnorm='probability density'))
    fig_dens.update_layout(title='Density Distribution', barmode='overlay',
                            xaxis_title='Invoice-to-Payment Days')
    st.plotly_chart(fig_dens, use_container_width=True)

# Monthly trend
st.subheader("Cycle Time Trend Over Time")
monthly = (
    purchases
    .assign(month=pd.to_datetime(purchases['pr_date']).dt.to_period('M').dt.to_timestamp())
    .groupby('month')['invoice_to_payment_days'].mean()
    .reset_index()
)
fig_trend = px.line(monthly, x='month', y='invoice_to_payment_days', markers=True,
                    title='Monthly Mean Invoice-to-Payment Time')
fig_trend.add_vline(x=pd.Timestamp('2025-01-01').timestamp() * 1000,
                    line_dash="dash", line_color="red",
                    annotation_text="Automation introduced")
st.plotly_chart(fig_trend, use_container_width=True)
```

### Visualization libraries

For Streamlit, the recommended stack:

| Library | When to use |
|---|---|
| **Plotly** (`plotly.express` and `plotly.graph_objects`) | Default. Interactive, professional, well-integrated. Use for almost everything. |
| **Streamlit native** (`st.bar_chart`, `st.line_chart`) | Quick prototypes, minimal-styling charts |
| **Altair** | Declarative grammar-of-graphics; good for statistical visualizations |
| Matplotlib / Seaborn | If you already have static figures from notebooks; less interactive |

Stick with **Plotly** for the bulk of your charts. It gives you interactivity (hover tooltips, zoom, pan) without extra code.

### Theming and styling

Customize the app's look via `.streamlit/config.toml`:

```toml
[theme]
primaryColor = "#1f77b4"
backgroundColor = "#FFFFFF"
secondaryBackgroundColor = "#F0F2F6"
textColor = "#262730"
font = "sans serif"

[server]
maxUploadSize = 200  # MB

[browser]
gatherUsageStats = false
```

Color choices align with corporate branding if needed. For a procurement/mining company, slightly darker blues and grays read more professional than the default theme.

### Deployment to Streamlit Cloud

1. **Create GitHub repo** with the project
2. **Sign up** at [streamlit.io/cloud](https://streamlit.io/cloud) (free tier)
3. **Connect GitHub** and authorize Streamlit
4. **New app** → select repo → set main file to `streamlit_app.py` → Deploy
5. Wait 2-3 minutes for first build
6. App is now live at `https://<your-app-name>.streamlit.app`

The free tier allows unlimited public apps. Private apps require Streamlit Cloud Teams plan.

### Performance considerations

- **`@st.cache_data`** for data loading and expensive computations
- **`@st.cache_resource`** for ML models or database connections
- **Use `st.session_state`** to persist user selections across page navigations
- **Lazy-load heavy charts** — only render when a relevant tab is active
- **Pre-aggregate** monthly/quarterly data if drill-down isn't needed at daily level

### Common pitfalls

| Issue | Solution |
|---|---|
| App re-runs entire script on every interaction | Use `@st.cache_data` for expensive operations |
| State lost between pages | Use `st.session_state` to persist values |
| Charts feel slow with large data | Pre-aggregate; sample for visualization |
| File path errors after deployment | Use `Path(__file__).resolve().parent` for relative paths |
| Secrets leaked in code | Use `st.secrets` for credentials, never hardcode |
| Pages load in wrong order | Use numeric prefixes (`01_`, `02_`) in filenames |

### What goes where: notebooks vs. Streamlit app

| Artifact | Lives in | Purpose |
|---|---|---|
| Exploratory analysis | `notebooks/` | Development; not deployed |
| Reusable logic | `src/` modules | Imported by both notebooks AND Streamlit |
| Final visualizations | Streamlit pages | What users see |
| Written reports | `reports/*.md` | Reference documentation |
| Statistical methods | `src/statistics.py` | Used by Streamlit pages |

The Jupyter notebooks are your **development** workspace. The Streamlit app is your **delivery** workspace. They share code via `src/`.


---
---

## Part 2: ABC / Pareto Spend Analysis (Descriptive)

### Objective

**Identify which suppliers and categories account for the bulk of procurement spend, so attention and resources can be prioritized accordingly.**

ABC categorization assigns each supplier (or item, or category) to one of three groups:
- **A-class**: top suppliers contributing ~80% of spend — strategic, high-touch management
- **B-class**: middle suppliers contributing the next ~15% — preferred status, periodic reviews
- **C-class**: tail suppliers contributing ~5% — minimal management, consolidation opportunity

### Mathematical foundation

The Pareto principle (named after Vilfredo Pareto, 1896) observes that in many natural and social systems, ~80% of effects come from ~20% of causes. Mathematically, this is captured by the **power law distribution**:

$$P(X \geq x) = \left(\frac{x_{min}}{x}\right)^{\alpha}$$

where α (alpha) is the shape parameter. When α ≈ 1.16, the distribution exactly produces the classic 80/20 split.

For procurement spend, this manifests because:
1. Critical items (heavy equipment, fuel) cost orders of magnitude more than commodity items
2. Strategic suppliers serve multiple needs; tail suppliers serve narrow needs
3. Contract concentration accumulates over time (incumbent advantage)

**Why this matters**: ABC isn't arbitrary; it reflects an underlying statistical property of the spend distribution. If your data *doesn't* show a Pareto pattern, that itself is a finding worth investigating (likely indicates either a very flat supplier base or data issues).

### Data source

`purchases.csv` — aggregated by `supplier_id`. Optionally cross-tabulated by `category`.

### Method — step-by-step with full code

#### Step 1: Setup and data loading

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

# Reproducibility
np.random.seed(42)

# Plot styling
sns.set_style("whitegrid")
plt.rcParams['figure.dpi'] = 100

# Load data
suppliers = pd.read_csv('data/raw/suppliers.csv')
purchases = pd.read_csv('data/raw/purchases.csv', parse_dates=['pr_date', 'po_date', 'delivery_date', 'invoice_date', 'payment_date'])

# Sanity checks
print(f"Suppliers: {len(suppliers)} rows")
print(f"Purchases: {len(purchases)} rows")
print(f"Date range: {purchases['pr_date'].min()} to {purchases['pr_date'].max()}")
print(f"Total spend: ${purchases['total_value_usd'].sum():,.2f}")

# Validate join integrity
missing = set(purchases['supplier_id']) - set(suppliers['supplier_id'])
assert not missing, f"Orphan supplier_ids in purchases: {missing}"
```

Always run sanity checks. If the assertions fail, your downstream analysis is meaningless.

#### Step 2: Aggregate spend by supplier

```python
spend = (
    purchases
    .groupby('supplier_id', as_index=False)
    .agg(
        total_spend_usd=('total_value_usd', 'sum'),
        num_pos=('po_id', 'count'),
        avg_po_value=('total_value_usd', 'mean'),
    )
    .merge(suppliers[['supplier_id', 'supplier_name', 'category', 'tier', 'country']], on='supplier_id')
    .sort_values('total_spend_usd', ascending=False)
    .reset_index(drop=True)
)
spend['rank'] = spend.index + 1
spend['pct_of_total'] = spend['total_spend_usd'] / spend['total_spend_usd'].sum()
spend['cumulative_pct'] = spend['pct_of_total'].cumsum()
```

#### Step 3: ABC classification

```python
def classify(cum_pct, thresholds=(0.80, 0.95)):
    """Classify based on cumulative percentage thresholds."""
    if cum_pct <= thresholds[0]:
        return 'A'
    elif cum_pct <= thresholds[1]:
        return 'B'
    else:
        return 'C'

spend['abc_class'] = spend['cumulative_pct'].apply(classify)

# Summary table
summary = spend.groupby('abc_class').agg(
    supplier_count=('supplier_id', 'count'),
    total_spend=('total_spend_usd', 'sum'),
).assign(
    pct_of_suppliers=lambda x: x['supplier_count'] / x['supplier_count'].sum() * 100,
    pct_of_spend=lambda x: x['total_spend'] / x['total_spend'].sum() * 100,
)
print(summary)
```

#### Step 4: Pareto chart visualization

```python
fig, ax1 = plt.subplots(figsize=(14, 6))

# Bars: spend per supplier
ax1.bar(range(len(spend)), spend['total_spend_usd'] / 1e6, 
        color=[{'A': '#d62728', 'B': '#ff7f0e', 'C': '#bcbd22'}[c] for c in spend['abc_class']],
        alpha=0.8)
ax1.set_xlabel('Supplier Rank')
ax1.set_ylabel('Spend (USD millions)', color='#444')
ax1.set_title('Pareto Analysis: Procurement Spend by Supplier (2024-2025)')

# Line: cumulative percentage
ax2 = ax1.twinx()
ax2.plot(range(len(spend)), spend['cumulative_pct'] * 100, color='#1f77b4', linewidth=2, marker='o', markersize=3)
ax2.axhline(y=80, color='gray', linestyle='--', linewidth=0.8, label='80% threshold (A/B boundary)')
ax2.axhline(y=95, color='gray', linestyle=':', linewidth=0.8, label='95% threshold (B/C boundary)')
ax2.set_ylabel('Cumulative % of Spend', color='#1f77b4')
ax2.set_ylim(0, 105)
ax2.legend(loc='lower right')

# Legend for ABC colors
import matplotlib.patches as mpatches
abc_legend = [mpatches.Patch(color=c, label=f'{label} ({(spend.abc_class==label).sum()} suppliers)') 
              for label, c in [('A', '#d62728'), ('B', '#ff7f0e'), ('C', '#bcbd22')]]
ax1.legend(handles=abc_legend, loc='upper right')

plt.tight_layout()
plt.savefig('reports/figures/abc_pareto.png', dpi=150, bbox_inches='tight')
plt.show()
```

#### Step 5: Category-level Pareto

```python
cat_spend = (
    purchases
    .groupby('category', as_index=False)['total_value_usd']
    .sum()
    .sort_values('total_value_usd', ascending=False)
    .reset_index(drop=True)
)
cat_spend['pct_of_total'] = cat_spend['total_value_usd'] / cat_spend['total_value_usd'].sum()
cat_spend['cumulative_pct'] = cat_spend['pct_of_total'].cumsum()
cat_spend['abc_class'] = cat_spend['cumulative_pct'].apply(classify)
print(cat_spend.to_string())
```

#### Step 6: Cross-validation against existing tier classification

```python
crosstab = pd.crosstab(spend['tier'], spend['abc_class'], margins=True)
print("Tier vs ABC class:")
print(crosstab)

# Identify mismatches
strategic_in_c = spend.loc[(spend['tier']=='Strategic') & (spend['abc_class']=='C'),
                            ['supplier_name', 'total_spend_usd', 'num_pos']]
approved_in_a = spend.loc[(spend['tier']=='Approved') & (spend['abc_class']=='A'),
                           ['supplier_name', 'total_spend_usd', 'num_pos']]
print("\nStrategic suppliers landing in C-class (potential underutilization):")
print(strategic_in_c)
print("\nApproved suppliers landing in A-class (potential maverick spend):")
print(approved_in_a)
```

### Expected outputs

- A sorted DataFrame: supplier_id, supplier_name, spend, % of total, cumulative %, ABC class
- A Pareto chart (bars + cumulative line, with A/B/C colors)
- A summary table: supplier count and spend share per class
- A tier-vs-ABC crosstab
- A category-level Pareto

### Multi-dimensional ABC: ABC-XYZ analysis

Standard ABC looks at spend (volume). For better procurement management, also classify by **demand variability** — the XYZ axis:

- **X**: stable/predictable demand (coefficient of variation < 0.5)
- **Y**: moderately variable demand (CoV 0.5–1.0)
- **Z**: erratic/unpredictable demand (CoV > 1.0)

```python
from numpy import std, mean
# Calculate monthly spend per supplier
monthly_spend = (
    purchases
    .assign(month=lambda x: x['pr_date'].dt.to_period('M'))
    .groupby(['supplier_id', 'month'])['total_value_usd']
    .sum()
    .reset_index()
)
variability = monthly_spend.groupby('supplier_id').agg(
    monthly_mean=('total_value_usd', 'mean'),
    monthly_std=('total_value_usd', 'std'),
).assign(coefficient_of_variation=lambda x: x['monthly_std'] / x['monthly_mean'])

def classify_xyz(cv):
    if cv < 0.5: return 'X'
    elif cv < 1.0: return 'Y'
    else: return 'Z'
variability['xyz_class'] = variability['coefficient_of_variation'].apply(classify_xyz)

# Combine ABC and XYZ
abc_xyz = spend.merge(variability[['xyz_class']], left_on='supplier_id', right_index=True, how='left')
abc_xyz['combined_class'] = abc_xyz['abc_class'] + abc_xyz['xyz_class']

# The 9-cell matrix tells you what management approach each supplier needs
print(abc_xyz.groupby('combined_class').size())
```

Interpretation of the 9-cell matrix:

| | X (stable) | Y (moderate) | Z (erratic) |
|---|---|---|---|
| **A (high spend)** | Strategic partner, long-term contracts | Forecast carefully, frequent reviews | Risk! Volatile big spend; investigate |
| **B (medium)** | Preferred, automate ordering | Standard process | Watch closely |
| **C (low spend)** | Catalog buy, automate | Bundle purchases | Consider eliminating |

### Robustness / sensitivity checks

Run the analysis with different thresholds and inputs to see if conclusions hold:

```python
# Sensitivity: try alternative thresholds
for low, high in [(0.70, 0.90), (0.80, 0.95), (0.85, 0.97)]:
    counts = spend['cumulative_pct'].apply(lambda x: classify(x, (low, high))).value_counts()
    print(f"Thresholds ({low}, {high}): A={counts.get('A',0)}, B={counts.get('B',0)}, C={counts.get('C',0)}")

# Sensitivity: restrict to one year
for year in [2024, 2025]:
    sub = purchases[purchases['pr_date'].dt.year == year]
    sub_spend = sub.groupby('supplier_id')['total_value_usd'].sum().sort_values(ascending=False)
    cum = sub_spend.cumsum() / sub_spend.sum()
    a_class_count = (cum <= 0.80).sum()
    print(f"{year}: A-class suppliers = {a_class_count}")

# Sensitivity: exclude top one-off purchases (potential outliers)
threshold = purchases['total_value_usd'].quantile(0.99)
sub_no_outliers = purchases[purchases['total_value_usd'] < threshold]
# ... rerun analysis
```

### Edge cases and pitfalls

| Issue | Detection | Handling |
|---|---|---|
| Single supplier dominance (one supplier >50% of spend) | Inspect top row | Investigate concentration risk |
| Very flat distribution (no Pareto) | Cumulative % rises linearly | May indicate data issues or unusual industry |
| Long tail with many tiny suppliers | C-class has >70% of count | Tail spend consolidation opportunity |
| New suppliers with partial year | Compare days in dataset to period length | Annualize their spend before classification |
| Currency mix | Different unit_prices in different currencies | Normalize to single currency at appropriate FX rate |
| Negative spend (returns/credits) | Filter check `total_value_usd < 0` | Decide: include net spend or treat as separate |
| Duplicate POs | Check for identical po_id | Deduplicate before aggregation |

### Interpretation framework

When writing up the findings, answer:

- **Concentration**: How concentrated is spend? Top 5 = ?% of total. Healthy or risky?
- **A-class identification**: Who's in A? Why? Does the tier classification match?
- **Mismatches**: Any suppliers classified "Approved" but landing in A-class? Or "Strategic" suppliers in B/C?
- **Tail spend**: How many suppliers in C? Are they manageable or should some be consolidated?
- **Category Pareto**: Which categories dominate spend? Are they the expected categories for a coalmine?
- **Variability**: Combined with XYZ, which suppliers have high spend AND erratic demand? Those are operational risks.

### Recommendations that typically emerge

- Establish strategic supplier relationships with the A-class (regular business reviews, SLAs, joint planning)
- Consolidate C-class through procurement card programs or P-card thresholds
- Investigate any "Approved-tier-but-A-class-spend" suppliers — potential maverick spending or under-leveraged relationship
- Investigate any "Strategic-tier-but-low-spend" — may indicate underperformance or unused contracts
- For AZ suppliers (high spend, erratic demand): forecast more carefully, hold safety stock, set up demand planning meetings

### Documentation template for ABC

```markdown
# ABC Spend Analysis — [Coalmine Operation]
**Date**: [date]
**Analyst**: [your name]
**Data period**: 2024-2025 (24 months)

## 1. Objective
Identify the strategic-priority suppliers based on spend concentration to guide
relationship management and category strategy.

## 2. Data sources
- `purchases.csv` (640 records, $695M total spend)
- `suppliers.csv` (55 suppliers, classified by tier)

## 3. Method
Standard Pareto/ABC classification:
- A-class = cumulative spend up to 80%
- B-class = next 15%
- C-class = bottom 5%

Calculated at supplier level and cross-tabulated by category.
Also performed ABC-XYZ analysis combining spend with monthly demand variability.

## 4. Assumptions and limitations
- Spend in USD; multi-currency normalization not required for this dataset
- All POs treated equally regardless of strategic importance
- One-off capital purchases not separated from operational spend
- 24-month period; potential seasonality not addressed

## 5. Results
[Pareto chart]
[Classification table]

Key numbers:
- A-class: [N] suppliers ([N%] of count) account for [N%] of spend
- B-class: ...
- C-class: ...

## 6. Interpretation
[Discussion of concentration, mismatches, category patterns]

## 7. Recommendations
1. ...
2. ...
3. ...

## 8. Appendix
[Code, sensitivity tables, ABC-XYZ matrix]
```

---

## Part 3: Supplier Segmentation via Cluster Analysis (Exploratory)

### Objective

**Group suppliers by behavior patterns to identify distinct supplier archetypes that may warrant different management approaches — beyond what the existing tier classification suggests.**

This builds empirically on the Kraljic matrix concept but uses multiple performance dimensions, not just risk × spend.

### Mathematical foundation: K-means algorithm

K-means partitions n observations into k clusters by minimizing **within-cluster sum of squares (WCSS)**:

$$\text{WCSS} = \sum_{i=1}^{k} \sum_{x \in C_i} \|x - \mu_i\|^2$$

where:
- $C_i$ is cluster i
- $\mu_i$ is the centroid (mean) of cluster i
- $\|x - \mu_i\|$ is the Euclidean distance from point x to centroid $\mu_i$

**The algorithm iterates**:
1. Initialize k centroids (k-means++ initialization spreads them out for better convergence)
2. Assign each point to its nearest centroid (E-step)
3. Update each centroid to be the mean of its assigned points (M-step)
4. Repeat 2-3 until centroids stop moving (convergence)

**Why standardize features first**: Euclidean distance is sensitive to scale. If spend is in millions and defect rate is 0.01–5, spend will dominate the distance calculation. StandardScaler transforms each feature to mean=0, std=1, putting all on equal footing.

**Limitations of K-means**:
- Assumes spherical clusters (equal variance in all directions)
- Requires pre-specifying k
- Sensitive to outliers
- Not great for non-convex clusters

### Data source

`supplier_metrics.csv` — one row per supplier with aggregated performance.

### Method — step-by-step with full code

#### Step 1: Setup, load, explore

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering, DBSCAN
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score, silhouette_samples, davies_bouldin_score, calinski_harabasz_score

np.random.seed(42)
sns.set_style("whitegrid")

metrics = pd.read_csv('data/raw/supplier_metrics.csv')
print(metrics.describe())

# Visualize feature distributions before standardizing
features_to_explore = [
    'total_spend_usd', 'on_time_delivery_pct', 'defect_rate_pct',
    'rfx_response_rate_pct', 'avg_lead_time_days', 'three_way_match_pct',
    'complaint_count_annual'
]
fig, axes = plt.subplots(2, 4, figsize=(16, 8))
for ax, feat in zip(axes.flat, features_to_explore):
    metrics[feat].hist(bins=20, ax=ax)
    ax.set_title(feat)
plt.tight_layout()
plt.savefig('reports/figures/feature_distributions.png', dpi=150)
```

Look at the distributions. If a feature is highly skewed (like spend, which usually follows a power law), consider a **log transform** before clustering:

```python
metrics['log_spend'] = np.log1p(metrics['total_spend_usd'])
```

Log-transformed spend has a much more usable distribution for distance-based clustering.

#### Step 2: Feature engineering and selection

```python
features = [
    'log_spend',                    # log-transformed for normality
    'on_time_delivery_pct',
    'defect_rate_pct',
    'rfx_response_rate_pct',
    'avg_lead_time_days',
    'three_way_match_pct',
]
# Optional: handle missing data
X_raw = metrics[features].copy()
print("Missing values per feature:")
print(X_raw.isnull().sum())

# Impute with median (robust to outliers)
for col in X_raw.columns:
    if X_raw[col].isnull().any():
        X_raw[col].fillna(X_raw[col].median(), inplace=True)
```

#### Step 3: Standardize

```python
scaler = StandardScaler()
X = scaler.fit_transform(X_raw)
X_df = pd.DataFrame(X, columns=features, index=metrics['supplier_id'])

# Verify standardization
print(X_df.describe())  # mean should be ~0, std ~1 for each column
```

#### Step 4: Determine optimal k

Three methods, used together:

**A. Elbow method** (look for the "elbow" in inertia):

```python
inertias = []
k_range = range(2, 11)
for k in k_range:
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    km.fit(X)
    inertias.append(km.inertia_)

plt.figure(figsize=(10, 5))
plt.plot(k_range, inertias, 'bo-')
plt.xlabel('Number of clusters (k)')
plt.ylabel('Within-cluster sum of squares (Inertia)')
plt.title('Elbow Method for Optimal k')
plt.grid(True)
plt.savefig('reports/figures/elbow_method.png', dpi=150)
plt.show()
```

The "elbow" is where adding more clusters stops reducing WCSS substantially. Often subjective.

**B. Silhouette analysis** (higher is better, range -1 to 1):

```python
silhouette_scores = []
for k in k_range:
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = km.fit_predict(X)
    score = silhouette_score(X, labels)
    silhouette_scores.append(score)
    print(f"k={k}: silhouette={score:.3f}")

plt.figure(figsize=(10, 5))
plt.plot(list(k_range), silhouette_scores, 'go-')
plt.xlabel('Number of clusters (k)')
plt.ylabel('Silhouette Score')
plt.title('Silhouette Analysis')
plt.grid(True)
plt.savefig('reports/figures/silhouette_analysis.png', dpi=150)
plt.show()
```

Silhouette score interpretation:
- 0.7+: strong cluster structure
- 0.5-0.7: reasonable structure
- 0.25-0.5: weak structure
- <0.25: no substantial structure

**C. Domain logic**: 3-5 clusters for supplier segmentation usually maps well to business reality (you can't manage 20 different supplier types differently).

```python
# Other validation metrics
for k in k_range:
    km = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = km.fit_predict(X)
    db = davies_bouldin_score(X, labels)  # lower is better
    ch = calinski_harabasz_score(X, labels)  # higher is better
    print(f"k={k}: Davies-Bouldin={db:.3f}, Calinski-Harabasz={ch:.1f}")
```

#### Step 5: Run K-means with chosen k

```python
optimal_k = 4  # based on elbow + silhouette
kmeans = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
metrics['cluster'] = kmeans.fit_predict(X)
```

#### Step 6: Profile each cluster

```python
cluster_profile = metrics.groupby('cluster').agg(
    n_suppliers=('supplier_id', 'count'),
    avg_spend=('total_spend_usd', 'mean'),
    avg_otd=('on_time_delivery_pct', 'mean'),
    avg_defect=('defect_rate_pct', 'mean'),
    avg_response=('rfx_response_rate_pct', 'mean'),
    avg_lead_time=('avg_lead_time_days', 'mean'),
    avg_match=('three_way_match_pct', 'mean'),
    avg_complaints=('complaint_count_annual', 'mean'),
).round(2)
print(cluster_profile)
```

Use this to *name* each cluster. For example:

```python
cluster_names = {
    0: 'Star Performers',
    1: 'Strategic Underperformers',
    2: 'Reliable Specialists',
    3: 'Tail Spenders',
}
metrics['cluster_name'] = metrics['cluster'].map(cluster_names)
```

#### Step 7: Visualize clusters

**PCA scatter plot** (reduces dimensions for visualization):

```python
pca = PCA(n_components=2)
X_pca = pca.fit_transform(X)
metrics['pca1'] = X_pca[:, 0]
metrics['pca2'] = X_pca[:, 1]

plt.figure(figsize=(12, 8))
for cluster_id in range(optimal_k):
    sub = metrics[metrics['cluster'] == cluster_id]
    plt.scatter(sub['pca1'], sub['pca2'], label=cluster_names[cluster_id], alpha=0.7, s=80)
plt.xlabel(f'PC1 ({pca.explained_variance_ratio_[0]:.1%} variance)')
plt.ylabel(f'PC2 ({pca.explained_variance_ratio_[1]:.1%} variance)')
plt.title('Supplier Segments (PCA projection)')
plt.legend()
plt.savefig('reports/figures/cluster_pca.png', dpi=150)
```

**Radar chart per cluster** (show mean feature values):

```python
from math import pi

# Normalize cluster centers back to original scale for radar
cluster_means = metrics.groupby('cluster')[features].mean()
# Min-max normalize each feature for radar comparability
cluster_means_norm = (cluster_means - cluster_means.min()) / (cluster_means.max() - cluster_means.min())

categories = features
N = len(categories)
angles = [n / float(N) * 2 * pi for n in range(N)]
angles += angles[:1]

fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(polar=True))
for cluster_id, row in cluster_means_norm.iterrows():
    values = row.tolist()
    values += values[:1]
    ax.plot(angles, values, linewidth=2, label=cluster_names[cluster_id])
    ax.fill(angles, values, alpha=0.15)
ax.set_xticks(angles[:-1])
ax.set_xticklabels(categories, fontsize=10)
plt.title('Cluster Profiles (Radar)')
plt.legend(loc='upper right', bbox_to_anchor=(1.2, 1.1))
plt.savefig('reports/figures/cluster_radar.png', dpi=150)
```

**Compare assigned tier vs discovered cluster**:

```python
crosstab = pd.crosstab(metrics['tier'], metrics['cluster_name'])
print(crosstab)

# Sankey or stacked bar for the mismatches
import matplotlib.pyplot as plt
crosstab.plot(kind='bar', stacked=True, figsize=(10, 6))
plt.title('Existing Tier vs Discovered Cluster')
plt.ylabel('Number of suppliers')
plt.xticks(rotation=0)
plt.legend(title='Cluster', bbox_to_anchor=(1.05, 1))
plt.tight_layout()
plt.savefig('reports/figures/tier_vs_cluster.png', dpi=150)
```

### Alternative algorithms (when K-means doesn't fit)

| Algorithm | When to use | Pros | Cons |
|---|---|---|---|
| **K-means** | Default; spherical clusters expected | Fast, interpretable | Requires k; spherical assumption |
| **Hierarchical (agglomerative)** | Want to explore cluster tree | No k needed; dendrogram | Slower; can't handle very large datasets |
| **DBSCAN** | Density-based clusters; noise expected | Finds arbitrary shapes; identifies outliers | Sensitive to parameters |
| **Gaussian Mixture Model** | Probabilistic cluster assignments | Soft clustering; statistical foundation | More complex |

```python
# Hierarchical clustering alternative
from scipy.cluster.hierarchy import linkage, dendrogram
import matplotlib.pyplot as plt

linkage_matrix = linkage(X, method='ward')  # Ward method minimizes variance
plt.figure(figsize=(16, 6))
dendrogram(linkage_matrix, labels=metrics['supplier_id'].tolist(), leaf_rotation=90)
plt.title('Hierarchical Clustering Dendrogram')
plt.xlabel('Supplier ID')
plt.ylabel('Distance')
plt.savefig('reports/figures/dendrogram.png', dpi=150)
```

The dendrogram lets you visually choose the cut point. Drawing a horizontal line at distance X gives you a specific cluster count.

```python
# DBSCAN alternative
from sklearn.cluster import DBSCAN
dbscan = DBSCAN(eps=1.5, min_samples=3)
metrics['dbscan_cluster'] = dbscan.fit_predict(X)
# Note: DBSCAN returns -1 for noise/outliers
print(f"DBSCAN found {(metrics['dbscan_cluster'] != -1).sum()} clustered suppliers, "
      f"{(metrics['dbscan_cluster'] == -1).sum()} marked as outliers")
```

### Stability check

K-means is sensitive to initialization. Run it multiple times with different seeds and check if cluster assignments are stable:

```python
from sklearn.metrics import adjusted_rand_score

# Run K-means with multiple seeds, compare assignments
reference_labels = KMeans(n_clusters=4, random_state=42, n_init=10).fit_predict(X)
for seed in [0, 1, 7, 100, 999]:
    labels = KMeans(n_clusters=4, random_state=seed, n_init=10).fit_predict(X)
    ari = adjusted_rand_score(reference_labels, labels)
    print(f"Seed {seed}: ARI vs reference = {ari:.3f}")
```

Adjusted Rand Index (ARI):
- 1.0: identical clustering
- ~0: random clustering
- <0.5: unstable; reconsider the analysis

### Expected outputs

- Cluster assignment for each supplier
- Cluster profile table (mean values per cluster)
- Visualizations (PCA scatter, radar, dendrogram)
- Tier-vs-cluster crosstab
- Stability assessment

### Interpretation framework

For each cluster, name it based on its profile. Typical patterns:

| Cluster name | Profile | Strategic response |
|---|---|---|
| **Star Performers** | High spend + high OTD + low defects + fast response | Lock in long-term contracts, joint innovation |
| **Strategic Underperformers** | High spend + poor OTD or quality | Performance improvement plan or replacement search |
| **Reliable Specialists** | Lower spend but excellent quality and reliability | Expand relationship to more categories |
| **Tail Spenders** | Low everything | Consolidate, automate, or phase out |
| **Volatile Suppliers** | Mixed signals (high response but high defects) | Closer scrutiny, smaller orders |

The interesting findings come from **mismatches between assigned tier and discovered cluster**:
- "Approved" supplier in "Star Performers" cluster → promotion candidate
- "Strategic" supplier in "Underperformers" cluster → red flag
- Sub-clusters within the assigned Strategic tier → maybe split into Strategic A and Strategic B

### Edge cases and pitfalls

| Issue | Detection | Handling |
|---|---|---|
| Small dataset (n < 30) | Look at n suppliers | Use hierarchical instead; K-means unreliable |
| Highly correlated features | Calculate correlation matrix | Drop redundant features or use PCA first |
| Skewed features | Histogram inspection | Log transform |
| Outliers | Box plots | Robust scaling (`RobustScaler`) or remove outliers |
| Cluster sizes very unequal | Check counts | DBSCAN may be more appropriate |
| K too high (overclustering) | Many clusters with 1-2 members | Reduce k |
| K too low (underclustering) | High within-cluster variance | Increase k |

### Documentation template for clustering

```markdown
# Supplier Segmentation Analysis — [Coalmine Operation]

## 1. Objective
Discover natural groupings of suppliers based on multi-dimensional performance,
and identify candidates for tier reclassification or strategic review.

## 2. Data sources
`supplier_metrics.csv` — 55 suppliers with 11 performance metrics.

## 3. Method
K-means clustering after feature standardization.
- Features: log_spend, OTD%, defect rate, RFx response, lead time, match rate
- Log transformation applied to spend due to heavy-tailed distribution
- k chosen via elbow + silhouette + domain logic (selected k=4)
- 10 random initializations with seed=42 for reproducibility
- Stability validated across multiple random seeds (ARI > 0.85)

## 4. Assumptions and limitations
- K-means assumes spherical, equal-sized clusters — may miss elongated patterns
- Features given equal weight after standardization
- Snapshot of two years; long-term suppliers may show different patterns
- 55 suppliers is a small dataset for clustering — results sensitive to outliers

## 5. Results
[Elbow plot, silhouette scores, validation metrics]
[Cluster profile table]
[PCA scatter visualization]
[Radar chart per cluster]

## 6. Interpretation
Cluster 1 (n=X): "Star performers"
  - Average spend $XM, OTD 92%, defects 0.7%
  - Includes: Sandvik, Epiroc, ...
Cluster 2 (n=X): "..."
  ...

Notable findings:
- [Supplier A] is currently Approved but clusters with Strategic — consider promotion
- [Supplier B] is Strategic but clusters with Underperformers — performance review needed

## 7. Recommendations
1. Reclassify [supplier A] to Strategic tier
2. Initiate performance review for [supplier B]
3. Consolidate the tail-spender cluster (N=X suppliers, combined $Y spend)

## 8. Appendix
[Cluster centers, full cluster membership, sensitivity to k, stability ARI scores]
```

---

## Part 4: Cycle-Time Hypothesis Testing (Inferential)

### Objective

**Determine whether the introduction of 3-way match automation produced a statistically significant reduction in cycle time, and quantify the effect.**

This is the inferential analysis — it answers "did our intervention work?" with statistical rigor, not just visual inspection.

### Statistical theory: errors, power, and significance

When you test a hypothesis, four outcomes are possible:

| | H₀ is true | H₀ is false |
|---|---|---|
| **Reject H₀** | Type I error (false positive, prob = α) | Correct (power = 1 - β) |
| **Fail to reject H₀** | Correct | Type II error (false negative, prob = β) |

- **α (alpha)**: probability of falsely rejecting H₀ when it's true. Convention: 0.05
- **β (beta)**: probability of failing to detect a real effect. Convention: ≤ 0.20
- **Power = 1 - β**: probability of correctly detecting a real effect. Convention: ≥ 0.80

**Power analysis** lets you determine the sample size needed to detect an effect of a given size:

```python
from statsmodels.stats.power import TTestIndPower

analysis = TTestIndPower()
# To detect a "large" effect (Cohen's d = 0.8) with 80% power and α=0.05:
n_required = analysis.solve_power(effect_size=0.8, alpha=0.05, power=0.80)
print(f"Sample size needed per group: {n_required:.0f}")
# For medium effect (d=0.5):
n_required = analysis.solve_power(effect_size=0.5, alpha=0.05, power=0.80)
print(f"Sample size needed for medium effect: {n_required:.0f}")
```

For your dataset with n ≈ 320 per group, you have ample power to detect even small effects (d=0.2 needs ~400 per group).

### Data source

`purchases.csv`, filtered by `automation_period` (pre vs post).

### Hypothesis formulation

- **H₀ (null hypothesis)**: There is no difference in invoice-to-payment cycle time between pre- and post-automation periods. (μ_pre = μ_post)
- **H₁ (alternative hypothesis)**: Post-automation invoice-to-payment is shorter than pre-automation. (μ_post < μ_pre — one-tailed)

State the **significance level** in advance: α = 0.05.

**Why one-tailed**: you have a directional hypothesis. You're not just asking "is there a difference?" but "is post smaller?" One-tailed tests have more power to detect the specific direction.

### Test selection decision tree

```
Are both groups continuous numeric?
├── No → Use chi-square or other categorical test
└── Yes:
    Are samples independent (different observations in each group)?
    ├── No → Paired t-test or Wilcoxon signed-rank
    └── Yes:
        Are both groups approximately normal?
        ├── Both normal AND equal variances → Independent t-test (Student's)
        ├── Both normal, unequal variances → Welch's t-test
        └── Non-normal → Mann-Whitney U
```

### Method — step-by-step with full code

#### Step 1: Setup and data loading

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
from scipy.stats import (
    shapiro, normaltest, anderson, kstest,
    ttest_ind, mannwhitneyu, levene,
    bootstrap
)

np.random.seed(42)
sns.set_style("whitegrid")

purchases = pd.read_csv('data/raw/purchases.csv', parse_dates=['pr_date'])

# Extract the two groups
pre = purchases.loc[purchases['automation_period']=='pre', 'invoice_to_payment_days'].values
post = purchases.loc[purchases['automation_period']=='post', 'invoice_to_payment_days'].values

print(f"Pre-automation: n={len(pre)}")
print(f"Post-automation: n={len(post)}")
```

#### Step 2: Descriptive statistics

ALWAYS look at the data before testing.

```python
def descriptive_summary(data, name):
    return {
        'group': name,
        'n': len(data),
        'mean': np.mean(data),
        'median': np.median(data),
        'std': np.std(data, ddof=1),
        'min': np.min(data),
        'max': np.max(data),
        'q1': np.percentile(data, 25),
        'q3': np.percentile(data, 75),
        'iqr': np.percentile(data, 75) - np.percentile(data, 25),
    }

summary = pd.DataFrame([
    descriptive_summary(pre, 'Pre-automation'),
    descriptive_summary(post, 'Post-automation'),
])
print(summary.to_string(index=False))
```

#### Step 3: Visualize the data

Distribution plots and box plots reveal patterns that summary stats hide.

```python
fig, axes = plt.subplots(1, 3, figsize=(18, 5))

# Box plot
axes[0].boxplot([pre, post], labels=['Pre', 'Post'])
axes[0].set_ylabel('Invoice-to-Payment Days')
axes[0].set_title('Box Plot: Cycle Time by Period')
axes[0].grid(True, alpha=0.3)

# Distribution (kernel density)
sns.kdeplot(pre, label='Pre-automation', ax=axes[1], fill=True, alpha=0.5)
sns.kdeplot(post, label='Post-automation', ax=axes[1], fill=True, alpha=0.5)
axes[1].set_xlabel('Invoice-to-Payment Days')
axes[1].set_title('Density Distribution')
axes[1].legend()

# Time series — does the drop happen at the intervention point?
monthly = (
    purchases
    .assign(month=lambda x: pd.to_datetime(x['pr_date']).dt.to_period('M').dt.to_timestamp())
    .groupby('month')['invoice_to_payment_days']
    .mean()
)
axes[2].plot(monthly.index, monthly.values, marker='o')
axes[2].axvline(x=pd.Timestamp('2025-01-01'), color='red', linestyle='--', label='Automation introduced')
axes[2].set_xlabel('Month')
axes[2].set_ylabel('Mean Invoice-to-Payment Days')
axes[2].set_title('Cycle Time Trend')
axes[2].legend()

plt.tight_layout()
plt.savefig('reports/figures/cycle_time_distributions.png', dpi=150)
plt.show()
```

#### Step 4: Normality assessment

Multiple methods because each has weaknesses:

```python
def normality_check(data, name):
    """Run multiple normality tests and return results."""
    results = {'group': name, 'n': len(data)}
    
    # Shapiro-Wilk (best for small samples, n < 5000)
    if len(data) < 5000:
        stat, p = shapiro(data)
        results['shapiro_stat'] = stat
        results['shapiro_p'] = p
    
    # D'Agostino-Pearson (good for n > 20)
    stat, p = normaltest(data)
    results['dagostino_stat'] = stat
    results['dagostino_p'] = p
    
    # Anderson-Darling (more sensitive in tails)
    result = anderson(data, dist='norm')
    results['anderson_stat'] = result.statistic
    # critical value for 5% significance: result.critical_values[2]
    results['anderson_critical_5%'] = result.critical_values[2]
    
    # Kolmogorov-Smirnov against fitted normal
    stat, p = kstest(data, 'norm', args=(np.mean(data), np.std(data, ddof=1)))
    results['ks_stat'] = stat
    results['ks_p'] = p
    
    return results

normality_results = pd.DataFrame([
    normality_check(pre, 'Pre'),
    normality_check(post, 'Post'),
])
print(normality_results.T)
```

**Important caveat**: with large samples (n > 300), normality tests become hypersensitive — they reject even mildly non-normal data. The **Central Limit Theorem** makes the t-test robust regardless of underlying distribution when n > 30 per group.

**Q-Q plot** for visual normality check:

```python
fig, axes = plt.subplots(1, 2, figsize=(12, 5))
stats.probplot(pre, dist="norm", plot=axes[0])
axes[0].set_title('Q-Q Plot: Pre-automation')
stats.probplot(post, dist="norm", plot=axes[1])
axes[1].set_title('Q-Q Plot: Post-automation')
plt.tight_layout()
plt.savefig('reports/figures/qq_plots.png', dpi=150)
```

Points on the diagonal = normally distributed. Curves indicate skew or heavy tails.

#### Step 5: Equality of variance (for parametric test choice)

```python
# Levene's test (more robust than F-test)
stat, p_levene = levene(pre, post)
print(f"Levene's test: stat={stat:.3f}, p={p_levene:.4f}")
# If p < 0.05: variances are unequal → use Welch's t-test
```

#### Step 6: Run the appropriate test

```python
# Recommended: Mann-Whitney U (non-parametric, safe choice with large samples and possibly non-normal data)
u_stat, p_mw = mannwhitneyu(pre, post, alternative='greater')
print(f"Mann-Whitney U: stat={u_stat:.1f}, one-tailed p={p_mw:.6f}")

# Also run t-test (Welch's) for comparison
t_stat, p_t = ttest_ind(pre, post, alternative='greater', equal_var=False)
print(f"Welch's t-test: t={t_stat:.3f}, one-tailed p={p_t:.6f}")
```

Both should give very small p-values for this data given the strong difference.

#### Step 7: Effect size

Effect size measures *magnitude*, separate from statistical significance.

```python
# Cohen's d (for parametric)
def cohens_d(a, b):
    pooled_std = np.sqrt(((len(a)-1)*np.var(a, ddof=1) + (len(b)-1)*np.var(b, ddof=1)) / (len(a)+len(b)-2))
    return (np.mean(a) - np.mean(b)) / pooled_std

d = cohens_d(pre, post)
print(f"Cohen's d = {d:.3f}")
# Interpretation: 0.2 = small, 0.5 = medium, 0.8 = large, >1.0 = very large

# Hedges' g (corrected for small samples)
def hedges_g(a, b):
    d_value = cohens_d(a, b)
    correction = 1 - (3 / (4*(len(a) + len(b)) - 9))
    return d_value * correction

g = hedges_g(pre, post)
print(f"Hedges' g = {g:.3f}")

# Rank-biserial correlation (for Mann-Whitney)
def rank_biserial(a, b, u_statistic):
    return 1 - (2 * u_statistic) / (len(a) * len(b))

r_rb = rank_biserial(pre, post, u_stat)
print(f"Rank-biserial correlation = {r_rb:.3f}")
# Interpretation: 0.1 = small, 0.3 = medium, 0.5 = large effect
```

#### Step 8: Confidence interval on the difference

```python
# Parametric CI (Welch's method)
diff = np.mean(pre) - np.mean(post)
se = np.sqrt(np.var(pre, ddof=1)/len(pre) + np.var(post, ddof=1)/len(post))
df = (np.var(pre, ddof=1)/len(pre) + np.var(post, ddof=1)/len(post))**2 / (
    (np.var(pre, ddof=1)/len(pre))**2 / (len(pre)-1) +
    (np.var(post, ddof=1)/len(post))**2 / (len(post)-1)
)
t_critical = stats.t.ppf(0.975, df)
ci_low = diff - t_critical * se
ci_high = diff + t_critical * se
print(f"Mean difference: {diff:.2f} days, 95% CI: ({ci_low:.2f}, {ci_high:.2f})")

# Bootstrap CI (non-parametric, more robust)
def mean_diff(a, b):
    return np.mean(a) - np.mean(b)

# scipy.stats.bootstrap requires sample as tuple
data = (pre, post)
bootstrap_result = bootstrap(
    data,
    statistic=lambda a, b: np.mean(a) - np.mean(b),
    n_resamples=10000,
    confidence_level=0.95,
    random_state=42,
    paired=False,
    vectorized=False,
)
print(f"Bootstrap 95% CI: ({bootstrap_result.confidence_interval.low:.2f}, "
      f"{bootstrap_result.confidence_interval.high:.2f})")
```

#### Step 9: Sensitivity analysis

What if outliers drove the result?

```python
# Trim top 5% from each group (winsorize)
def trim(arr, pct=0.05):
    lower = np.percentile(arr, pct*100)
    upper = np.percentile(arr, (1-pct)*100)
    return arr[(arr >= lower) & (arr <= upper)]

pre_trim = trim(pre)
post_trim = trim(post)
u_trim, p_trim = mannwhitneyu(pre_trim, post_trim, alternative='greater')
print(f"After trimming outliers: Mann-Whitney p={p_trim:.6f}, n_pre={len(pre_trim)}, n_post={len(post_trim)}")
```

If the result holds after trimming, it's robust. If it collapses, outliers were driving the conclusion.

### Multiple testing corrections

If you test many things (e.g., cycle time AND match rate AND defect rate AND...), the probability of at least one false positive grows. With 20 tests at α=0.05, you'd expect ~1 false positive by chance.

Corrections:

```python
from statsmodels.stats.multitest import multipletests

# Example: testing 5 different metrics
p_values = [0.001, 0.04, 0.08, 0.12, 0.30]

# Bonferroni (conservative): multiply each p by number of tests
reject_bonf, p_bonf, _, _ = multipletests(p_values, alpha=0.05, method='bonferroni')
print("Bonferroni:", list(zip(p_values, p_bonf, reject_bonf)))

# Benjamini-Hochberg (FDR control, less conservative)
reject_bh, p_bh, _, _ = multipletests(p_values, alpha=0.05, method='fdr_bh')
print("Benjamini-Hochberg:", list(zip(p_values, p_bh, reject_bh)))
```

Use Bonferroni when false positives are very costly; Benjamini-Hochberg for exploratory work.

### Bayesian alternative

A Bayesian approach gives you posterior probability distributions instead of p-values. More intuitive ("there's a 99.8% probability that the post-automation period is faster") but more setup.

```python
# Requires PyMC or similar
# Outline (not full code):
# 1. Define prior beliefs about mean cycle times
# 2. Observe data
# 3. Calculate posterior distribution of difference
# 4. Report posterior probability that difference > 0
```

For most procurement work, frequentist (p-value + CI) is sufficient. Bayesian is overkill unless you have strong prior information.

### Common pitfalls to avoid

| Pitfall | Why it's wrong | Better approach |
|---|---|---|
| Reporting only p-value | Significance ≠ magnitude | Always include effect size and CI |
| "p > 0.05 means no effect" | It only means we failed to detect | Report power; "consistent with no effect of size X or larger" |
| Significance = importance | Large n makes tiny effects significant | Report effect size and business significance |
| Multiple testing without correction | False positives accumulate | Use Bonferroni or BH |
| Cherry-picking the test | "Tried 5 tests, used the significant one" | Pre-register your method choice |
| Causal conclusions from observational data | Correlation ≠ causation | Note potential confounders; acknowledge limitations |

### Documentation template for hypothesis test

```markdown
# Cycle Time Reduction Analysis — Pre vs Post Automation

## 1. Objective
Test whether the 3-way match automation introduced 2025-01-01 produced a
statistically significant reduction in invoice-to-payment cycle time.

## 2. Data sources
`purchases.csv`, n=640 POs across 2024-2025.
- Pre-automation (2024): n=319
- Post-automation (2025): n=321

## 3. Hypotheses
H₀: μ_pre = μ_post (no difference)
H₁: μ_pre > μ_post (post-automation shorter)
α = 0.05, one-tailed

Power analysis: with n=320 per group, power = 0.99+ to detect effects ≥ Cohen's d = 0.3

## 4. Method
- Descriptive statistics calculated for each group
- Normality assessed via Shapiro-Wilk, D'Agostino-Pearson, Q-Q plots
- Equality of variance via Levene's test
- Mann-Whitney U test selected (large samples robust to non-normality; safer than t-test if distributions differ)
- Also ran Welch's t-test for comparison
- Effect size: Cohen's d (parametric) and rank-biserial r (non-parametric)
- 95% CI on mean difference: parametric and bootstrap (10,000 resamples)
- Sensitivity analysis: trimmed 5% extreme values

## 5. Assumptions and limitations
- Observational data (no randomization); causal interpretation requires care
- Other process improvements may have coincided with automation
- Trimmed analysis confirms robustness to outliers
- Single intervention point; can't separate effect of automation from broader operational changes

## 6. Results
| Group | n | Mean | Median | Std |
|---|---|---|---|---|
| Pre  | 319 | 18.3 | 18 | 6.2 |
| Post | 321 | 5.8 | 4 | 3.9 |

Mann-Whitney U statistic = [value], one-tailed p-value < 0.0001
Welch's t-test: t = [value], one-tailed p < 0.0001
Cohen's d = [value] (large/very large effect)
Hedges' g = [value]
Rank-biserial r = [value]
95% CI on mean difference: parametric [X to Y] days, bootstrap [X to Y] days

[Box plot, density plot, time series with intervention marker]

After trimming top 5% outliers: p still < 0.0001 — result is robust.

## 7. Interpretation
Statistical: We reject H₀ at α=0.05 with overwhelming evidence (p < 0.0001).
Post-automation invoice-to-payment cycle is significantly shorter than pre-automation.

Practical magnitude: Mean cycle time dropped from 18.3 to 5.8 days, a 12.5-day reduction
(95% CI: 11.7 to 13.3 days). Cohen's d > 1.5 indicates very large practical effect.

Causal interpretation: This is observational data. While the timing of the reduction aligns
precisely with the automation introduction date, we cannot rule out coinciding factors.
The magnitude and immediacy of the effect, combined with the mechanism (automated matching
removes manual reconciliation steps), provide reasonable evidence that automation was the
primary driver.

Business impact: 12.5-day reduction in payment cycle translates to:
- Working capital improvement (faster payments enable early-payment discounts)
- Reduced AP team workload
- Improved supplier relationships (faster payment)

## 8. Recommendations
1. The automation investment shows measurable, large-effect cycle time reduction.
2. Recommend expanding automation scope to additional process areas (PO approval, GRN posting).
3. Investigate the residual variability in the post-automation period — what drives slow cases?
4. Monitor cycle time monthly going forward as a KPI in the dashboard.

## 9. Appendix
[Full code, sensitivity analyses, additional plots, multiple test corrections if applicable]
```

---

## Part 5: Putting It All Together

### Recommended execution sequence

1. **Set up the Jupyter notebook environment** with pandas, scipy, sklearn, matplotlib, seaborn
2. **Build the project structure** (folders, requirements.txt, git init)
3. **Run ABC analysis first** — easiest, gives a high-level view of where the spend lives
4. **Use ABC output to scope clustering** — focus clustering features on what matters
5. **Run clustering** — discover the supplier archetypes
6. **Run hypothesis testing** — validate the automation impact with rigor
7. **Build the Streamlit web app** — wire up pages drawing on findings from all three analyses
8. **Deploy to Streamlit Cloud** — push to GitHub, connect, live in minutes
9. **Write the consolidated executive report** — bring it all together (lives as Streamlit Methodology page)

### Estimated time investment

- Setup + project structure + ABC: 6-10 hours (longer if new to Python/Jupyter)
- Clustering: 8-14 hours (more if exploring multiple algorithms)
- Hypothesis test: 4-7 hours
- Streamlit app (development + deployment): 10-20 hours (Cursor/AI-assisted can reduce significantly)
- Documentation write-up: 6-12 hours

Total: a 3-5 week project for one person working part-time, or a focused 2-week sprint.

### Initial project setup script

Save this as `setup.sh` and run it to scaffold the project:

```bash
#!/bin/bash
# Project scaffolding script

mkdir -p procurement_analytics/{data/{raw,interim,processed},notebooks,src,reports/figures,pages,.streamlit}
cd procurement_analytics

# Create requirements.txt
cat > requirements.txt <<EOF
pandas==2.2.0
numpy==1.26.0
scipy==1.12.0
scikit-learn==1.4.0
statsmodels==0.14.0
matplotlib==3.8.0
seaborn==0.13.0
plotly==5.18.0
jupyter==1.0.0
streamlit==1.31.0
EOF

# Create .gitignore
cat > .gitignore <<EOF
*.pyc
__pycache__/
.ipynb_checkpoints/
venv/
.env
data/raw/
outputs/
.streamlit/secrets.toml
EOF

# Create README
cat > README.md <<EOF
# Procurement Analytics Project

## Setup
\`\`\`bash
python -m venv venv
source venv/bin/activate  # or: venv\\Scripts\\activate on Windows
pip install -r requirements.txt

# To develop in notebooks:
jupyter notebook

# To run the web app:
streamlit run streamlit_app.py
\`\`\`

## Project structure
- data/raw/: original CSVs (read-only)
- notebooks/: development analysis notebooks (run in order 00, 01, 02, 03)
- src/: reusable Python modules (shared between notebooks and Streamlit app)
- reports/: written reports and figures
- streamlit_app.py + pages/: the deployed web app (the final deliverable)

## Analyses
1. ABC/Pareto spend analysis
2. Supplier clustering
3. Cycle time hypothesis testing

## Deployment
Deployed to Streamlit Community Cloud. Push to main → auto-deploy.
EOF

# Initialize git
git init
echo "Setup complete. Activate venv and start exploring."
```

### Final deliverable structure

```
procurement_analytics/
├── README.md
├── requirements.txt
├── .gitignore
│
├── data/
│   ├── raw/
│   │   ├── suppliers.csv
│   │   ├── purchases.csv
│   │   └── supplier_metrics.csv
│   ├── interim/
│   │   └── dim_date.csv
│   └── processed/
│       └── ...
│
├── notebooks/
│   ├── 00_data_exploration.ipynb
│   ├── 01_abc_analysis.ipynb
│   ├── 02_supplier_clustering.ipynb
│   └── 03_cycle_time_hypothesis.ipynb
│
├── src/
│   ├── __init__.py
│   ├── data_loader.py
│   ├── visualization.py
│   └── statistics.py
│
├── reports/
│   ├── figures/
│   │   ├── abc_pareto.png
│   │   ├── feature_distributions.png
│   │   ├── elbow_method.png
│   │   ├── silhouette_analysis.png
│   │   ├── cluster_pca.png
│   │   ├── cluster_radar.png
│   │   ├── tier_vs_cluster.png
│   │   ├── cycle_time_distributions.png
│   │   └── qq_plots.png
│   ├── 01_abc_report.md
│   ├── 02_clustering_report.md
│   ├── 03_hypothesis_report.md
│   └── executive_summary.md
│
└── streamlit_app.py              # The deliverable: home page
    + pages/                       # App sub-pages
        ├── 01_📊_Spend_Overview.py
        ├── 02_📈_ABC_Analysis.py
        ├── 03_🎯_Supplier_Segments.py
        ├── 04_⏱️_Cycle_Time.py
        └── 05_📚_Methodology.py
    + .streamlit/
        └── config.toml
```

### Executive summary template (the front door)

After running all three analyses, you need ONE document that consolidates findings for leadership. Most senior people will read only this.

```markdown
# Procurement Analytics: Executive Summary

**Period analyzed**: January 2024 — December 2025
**Total transactions**: 640 POs, $695M total spend
**Suppliers in scope**: 55 active suppliers

## Key findings

### Finding 1: Spend is highly concentrated (ABC analysis)
- Top 11 suppliers (20% of supplier count) account for 93% of total spend
- Drilling equipment OEMs alone (Sandvik, Epiroc, Liebherr) represent ~48% of spend
- 60% of suppliers (33 of 55) are C-class tail-spenders contributing <5% combined

**Implication**: Resources should be heavily weighted toward A-class supplier management.
The C-class tail represents administrative overhead with limited financial impact.

### Finding 2: Discovered supplier segments don't fully match tier classification
- 4 natural clusters identified via K-means analysis
- 5 suppliers currently classified "Approved" perform like Strategic suppliers (promotion candidates)
- 2 Strategic suppliers cluster with underperformers (review needed)

**Implication**: Periodic empirical review of tier assignments would improve resource allocation.

### Finding 3: Automation reduced cycle time by 68%
- Invoice-to-payment cycle dropped from mean 18.3 days (pre) to 5.8 days (post)
- Reduction is statistically significant (p < 0.0001) and large (Cohen's d > 1.5)
- Effect is robust to outliers and timing aligns precisely with automation deployment

**Implication**: Automation investment validated. Expanding scope to other P2P stages
could yield similar gains.

## Recommendations

1. **Strengthen strategic supplier management** for the 11 A-class suppliers
   (joint planning, formal SLAs, business reviews)
2. **Promote 5 high-performing "Approved" suppliers** to Preferred or Strategic tier
3. **Initiate performance reviews** for 2 underperforming Strategic suppliers
4. **Consolidate C-class tail** through P-card programs and catalog purchasing
5. **Expand automation** to PO approval and GRN posting stages
6. **Establish monthly cycle time KPI** in the operations dashboard

## Detailed reports

See individual reports:
- `01_abc_report.md`: spend distribution analysis
- `02_clustering_report.md`: supplier segmentation
- `03_hypothesis_report.md`: cycle time statistical test

Methodology, assumptions, and limitations documented in each.
```

### Tips for presenting to your supervisor

- **Lead with the executive summary** — they don't have time for methodology
- **Use one chart per finding**, not three
- **Always pair a stat with a business implication** ("12-day reduction = ~$X working capital saved")
- **Have technical detail in the appendix** for when they ask "how did you get that?"
- **Don't hide limitations** — pre-emptively addressing them shows rigor
- **Use the same terminology consistently** — A/B/C, cluster names, "pre/post-automation"
- **Pre-empt the question "what do we do?"** — every finding paired with a recommendation

### Common review questions to prepare for

- "How confident are you in this number?" → Effect size, confidence interval, sample size
- "What if [other variable] caused it instead?" → Causal caveats, sensitivity analysis
- "Can you do this monthly?" → Reproducibility (this is why documentation matters)
- "What action should we take?" → Recommendations section
- "What did you exclude and why?" → Data prep transparency
- "How does this compare to industry benchmarks?" → Cite APQC/Hackett/etc. where applicable
- "What's the cost of inaction?" → Quantify the gap in dollar terms

### Quality checklist before finalizing

Before declaring an analysis "done", verify each box:

**Reproducibility**:
- [ ] Random seeds set
- [ ] Library versions pinned in requirements.txt
- [ ] Notebook runs top-to-bottom from a clean restart
- [ ] Code committed to git

**Methodology**:
- [ ] Hypothesis/objective clearly stated
- [ ] Method choice justified
- [ ] Assumptions documented
- [ ] Sensitivity checks performed
- [ ] Effect size reported alongside p-values
- [ ] Confidence intervals provided

**Documentation**:
- [ ] Analysis report written using template
- [ ] Charts saved to reports/figures/
- [ ] Executive summary updated
- [ ] Limitations explicitly acknowledged

**Communication**:
- [ ] Findings stated in business terms, not just statistical jargon
- [ ] Recommendations linked to each finding
- [ ] Visual storytelling: one chart per main point
- [ ] Reviewed by at least one other person

---

## Quick reference card

| Analysis | Question answered | Output | Action |
|---|---|---|---|
| ABC/Pareto | Where is the money? | Sorted spend table + Pareto chart | Tier suppliers; consolidate tail |
| ABC-XYZ | Where is money AND demand stable? | 9-cell matrix | Tailored management per cell |
| Clustering | What patterns exist? | Cluster assignments + profiles | Reclassify mismatches; tailor strategies |
| Hypothesis test | Did the change work? | p-value + effect size + CI | Validate investment; expand scope |
| Dashboard | What's happening now? | Live KPIs | Ongoing monitoring; early warning |

## Key formulas reference

| Concept | Formula | Use |
|---|---|---|
| Pareto cumulative % | $\sum_{i=1}^{k} x_i / \sum_{i=1}^{n} x_i$ | ABC classification |
| Coefficient of variation | $\sigma / \mu$ | XYZ demand variability |
| K-means objective | $\sum_{i=1}^{k} \sum_{x \in C_i} \|x - \mu_i\|^2$ | Cluster optimization |
| Silhouette score | $(b - a) / \max(a, b)$ where a=intra-cluster, b=nearest-cluster | Cluster quality |
| Z-score standardization | $(x - \mu) / \sigma$ | Feature scaling |
| Cohen's d | $(\bar{X}_1 - \bar{X}_2) / s_{pooled}$ | Effect size |
| Mann-Whitney U | $n_1 n_2 + n_1(n_1+1)/2 - R_1$ | Non-parametric test |
| 95% CI (parametric) | $\bar{d} \pm t_{0.025, df} \cdot SE$ | Confidence interval |

That's the full technical plan. Treat each analysis as a small project producing a documented artifact, not a one-off calculation. The **Streamlit web app is the delivery layer** — where all the analytical work converges into an interactive experience stakeholders can actually navigate. The analyses are the deep dives that power it. Everything in this document — the math, the code, the templates, the deployment guide — is designed to be lifted directly into your project.

---

# Part 6: Advanced Topics & Production Patterns

This section adds depth for analysts who want to take the work beyond the basics: SQL equivalents for analysts working in databases, production-quality Python code organized into reusable modules, more rigorous causal inference methods, Bayesian alternatives, advanced visualizations, additional clustering algorithms, testing patterns, data quality frameworks, and reproducibility through containerization.

## 6.1 SQL implementations for all three analyses

Many real procurement systems live in databases (SAP HANA, Oracle, Microsoft SQL Server, Snowflake). If your analyst environment is SQL-first, here are the equivalent queries for each analysis.

### 6.1.1 ABC analysis in SQL

```sql
-- Assumes tables: purchases (with supplier_id, total_value_usd) 
--                 suppliers (with supplier_id, supplier_name, tier)

WITH supplier_spend AS (
    SELECT 
        p.supplier_id,
        s.supplier_name,
        s.tier,
        SUM(p.total_value_usd) AS total_spend,
        COUNT(*) AS num_pos
    FROM purchases p
    INNER JOIN suppliers s ON p.supplier_id = s.supplier_id
    GROUP BY p.supplier_id, s.supplier_name, s.tier
),
ranked AS (
    SELECT
        supplier_id,
        supplier_name,
        tier,
        total_spend,
        num_pos,
        ROW_NUMBER() OVER (ORDER BY total_spend DESC) AS rank,
        SUM(total_spend) OVER (ORDER BY total_spend DESC ROWS UNBOUNDED PRECEDING) 
            / SUM(total_spend) OVER () AS cumulative_pct
    FROM supplier_spend
)
SELECT
    rank,
    supplier_id,
    supplier_name,
    tier,
    total_spend,
    num_pos,
    cumulative_pct,
    CASE
        WHEN cumulative_pct <= 0.80 THEN 'A'
        WHEN cumulative_pct <= 0.95 THEN 'B'
        ELSE 'C'
    END AS abc_class
FROM ranked
ORDER BY rank;
```

The key SQL pattern here is the **window function** `SUM(...) OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)` which calculates a running total. Combined with division by `SUM(...) OVER ()` (which sums across all rows), it produces the cumulative percentage.

For tier vs ABC crosstab:

```sql
SELECT
    tier,
    abc_class,
    COUNT(*) AS supplier_count,
    SUM(total_spend) AS total_spend
FROM (
    -- ... insert the abc_class query above as a subquery ...
) abc_data
GROUP BY tier, abc_class
ORDER BY tier, abc_class;
```

### 6.1.2 Cycle time hypothesis test data prep in SQL

The actual statistical test must happen in Python/R, but SQL can pre-aggregate:

```sql
-- Descriptive statistics by period
SELECT
    automation_period,
    COUNT(*) AS n,
    AVG(invoice_to_payment_days) AS mean_days,
    STDDEV(invoice_to_payment_days) AS std_days,
    -- Approximation of median:
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY invoice_to_payment_days) AS median_days,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY invoice_to_payment_days) AS q1_days,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY invoice_to_payment_days) AS q3_days,
    MIN(invoice_to_payment_days) AS min_days,
    MAX(invoice_to_payment_days) AS max_days
FROM purchases
GROUP BY automation_period;
```

For PostgreSQL/Snowflake/BigQuery, `PERCENTILE_CONT` works directly. For older SQL Server, use `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...) OVER ()`.

To extract data for export to Python:

```sql
-- Export to CSV for Python analysis
COPY (
    SELECT 
        po_id,
        automation_period,
        invoice_to_payment_days,
        po_to_delivery_days,
        total_cycle_days
    FROM purchases
    ORDER BY pr_date
) TO '/tmp/cycle_times_export.csv' WITH (FORMAT CSV, HEADER true);
```

### 6.1.3 Supplier metrics for clustering in SQL

```sql
-- Aggregate supplier metrics in SQL, then export for clustering in Python
SELECT
    s.supplier_id,
    s.supplier_name,
    s.category,
    s.tier,
    
    SUM(p.total_value_usd) AS total_spend_usd,
    COUNT(*) AS num_pos,
    AVG(p.total_value_usd) AS avg_po_value_usd,
    AVG(p.po_to_delivery_days) AS avg_lead_time_days,
    AVG(p.total_cycle_days) AS avg_cycle_time_days,
    
    100.0 * SUM(CASE WHEN p.on_time_delivery THEN 1 ELSE 0 END) / COUNT(*) AS on_time_delivery_pct,
    100.0 * SUM(CASE WHEN p.three_way_match_pass THEN 1 ELSE 0 END) / COUNT(*) AS three_way_match_pct
FROM suppliers s
LEFT JOIN purchases p ON s.supplier_id = p.supplier_id
GROUP BY s.supplier_id, s.supplier_name, s.category, s.tier;
```

The clustering algorithm itself (K-means, hierarchical, etc.) requires Python/R — SQL doesn't have built-in clustering. But aggregating the input data efficiently in SQL is a common pattern when data lives in a warehouse.

## 6.2 Production-quality Python: reusable modules

Putting all your code inline in notebooks is fine for exploration but doesn't scale. As your analysis matures, extract reusable logic into Python modules under `src/`.

### 6.2.1 `src/data_loader.py` — centralized data loading with validation

```python
"""Data loading and validation for procurement analytics."""
from pathlib import Path
import hashlib
import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

REQUIRED_COLUMNS = {
    "suppliers": {"supplier_id", "supplier_name", "country", "category", "tier"},
    "purchases": {
        "po_id", "supplier_id", "category", "total_value_usd",
        "pr_date", "po_date", "delivery_date", "invoice_date", "payment_date",
        "automation_period", "on_time_delivery", "three_way_match_pass",
    },
    "supplier_metrics": {"supplier_id", "total_spend_usd", "on_time_delivery_pct"},
}


def _file_hash(path: Path) -> str:
    """Return SHA-256 hex digest of a file's contents."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_schema(df: pd.DataFrame, name: str) -> None:
    """Raise ValueError if required columns are missing."""
    required = REQUIRED_COLUMNS.get(name, set())
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{name}: missing required columns {missing}")


def load_suppliers(data_dir: Optional[Path] = None) -> pd.DataFrame:
    """Load the suppliers master file and validate schema."""
    path = (data_dir or DATA_DIR) / "suppliers.csv"
    logger.info(f"Loading suppliers from {path}")
    logger.info(f"  SHA-256: {_file_hash(path)}")
    df = pd.read_csv(path)
    _validate_schema(df, "suppliers")
    if df["supplier_id"].duplicated().any():
        raise ValueError("Duplicate supplier_ids in suppliers.csv")
    return df


def load_purchases(data_dir: Optional[Path] = None) -> pd.DataFrame:
    """Load purchase transactions with proper date parsing and validation."""
    path = (data_dir or DATA_DIR) / "purchases.csv"
    logger.info(f"Loading purchases from {path}")
    logger.info(f"  SHA-256: {_file_hash(path)}")
    date_cols = ["pr_date", "po_date", "delivery_date", "invoice_date", "payment_date"]
    df = pd.read_csv(path, parse_dates=date_cols)
    _validate_schema(df, "purchases")
    
    # Sanity checks
    if df["po_id"].duplicated().any():
        n_dupes = df["po_id"].duplicated().sum()
        raise ValueError(f"Found {n_dupes} duplicate po_ids")
    if (df["total_value_usd"] < 0).any():
        n_neg = (df["total_value_usd"] < 0).sum()
        logger.warning(f"Found {n_neg} records with negative spend (returns/credits?)")
    if (df["po_date"] < df["pr_date"]).any():
        raise ValueError("po_date before pr_date in some records — data integrity issue")
    
    return df


def load_all(data_dir: Optional[Path] = None) -> dict:
    """Load all three datasets and validate join integrity."""
    suppliers = load_suppliers(data_dir)
    purchases = load_purchases(data_dir)
    
    # Join integrity check
    orphans = set(purchases["supplier_id"]) - set(suppliers["supplier_id"])
    if orphans:
        raise ValueError(f"Orphan supplier_ids in purchases: {orphans}")
    
    logger.info(
        f"Loaded {len(suppliers)} suppliers, {len(purchases)} purchases "
        f"({purchases['pr_date'].min().date()} to {purchases['pr_date'].max().date()})"
    )
    return {"suppliers": suppliers, "purchases": purchases}
```

Now in your notebook:

```python
from src.data_loader import load_all
data = load_all()
suppliers, purchases = data["suppliers"], data["purchases"]
```

One line, with validation built in.

### 6.2.2 `src/abc.py` — encapsulated ABC analysis

```python
"""ABC / Pareto classification."""
from typing import Tuple
import pandas as pd


def abc_classify(
    df: pd.DataFrame,
    value_col: str = "total_value_usd",
    group_col: str = "supplier_id",
    thresholds: Tuple[float, float] = (0.80, 0.95),
) -> pd.DataFrame:
    """
    Compute ABC classification on aggregated spend.
    
    Args:
        df: input DataFrame with at least group_col and value_col
        value_col: column to aggregate
        group_col: column to group by
        thresholds: (a_threshold, b_threshold) cumulative percentage cutoffs
    
    Returns:
        DataFrame with columns [group_col, total, pct, cumulative_pct, abc_class]
        sorted by total descending
    """
    if not (0 < thresholds[0] < thresholds[1] < 1):
        raise ValueError(f"Invalid thresholds {thresholds}; must satisfy 0 < a < b < 1")
    
    agg = (
        df.groupby(group_col, as_index=False)[value_col]
        .sum()
        .rename(columns={value_col: "total"})
        .sort_values("total", ascending=False)
        .reset_index(drop=True)
    )
    grand_total = agg["total"].sum()
    if grand_total == 0:
        raise ValueError("Total spend is zero — cannot classify")
    
    agg["pct"] = agg["total"] / grand_total
    agg["cumulative_pct"] = agg["pct"].cumsum()
    
    def _classify(cum):
        if cum <= thresholds[0]: return "A"
        if cum <= thresholds[1]: return "B"
        return "C"
    
    agg["abc_class"] = agg["cumulative_pct"].apply(_classify)
    agg["rank"] = agg.index + 1
    return agg


def abc_summary(abc_df: pd.DataFrame) -> pd.DataFrame:
    """Summarize ABC results: counts and shares per class."""
    summary = abc_df.groupby("abc_class").agg(
        n=("total", "count"),
        total=("total", "sum"),
    )
    summary["pct_of_count"] = summary["n"] / summary["n"].sum() * 100
    summary["pct_of_spend"] = summary["total"] / summary["total"].sum() * 100
    return summary
```

### 6.2.3 `src/statistics.py` — encapsulated hypothesis testing

```python
"""Statistical tests with effect sizes."""
from dataclasses import dataclass
from typing import Tuple
import numpy as np
from scipy import stats


@dataclass
class TestResult:
    """Standardized result format for two-sample tests."""
    test_name: str
    statistic: float
    p_value: float
    effect_size_name: str
    effect_size: float
    mean_diff: float
    ci_low: float
    ci_high: float
    n1: int
    n2: int
    
    def __str__(self) -> str:
        return (
            f"{self.test_name}: stat={self.statistic:.3f}, p={self.p_value:.6f}\n"
            f"  Mean difference: {self.mean_diff:.3f}, 95% CI: ({self.ci_low:.3f}, {self.ci_high:.3f})\n"
            f"  {self.effect_size_name}: {self.effect_size:.3f}\n"
            f"  n1={self.n1}, n2={self.n2}"
        )


def cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    """Cohen's d effect size for independent samples (pooled SD)."""
    n1, n2 = len(a), len(b)
    var_a, var_b = np.var(a, ddof=1), np.var(b, ddof=1)
    pooled_std = np.sqrt(((n1-1)*var_a + (n2-1)*var_b) / (n1+n2-2))
    if pooled_std == 0:
        return 0.0
    return (np.mean(a) - np.mean(b)) / pooled_std


def welch_t_test(a: np.ndarray, b: np.ndarray, alternative: str = "two-sided") -> TestResult:
    """Welch's t-test (unequal variances) with effect size and CI."""
    t_stat, p = stats.ttest_ind(a, b, alternative=alternative, equal_var=False)
    diff = np.mean(a) - np.mean(b)
    se = np.sqrt(np.var(a, ddof=1)/len(a) + np.var(b, ddof=1)/len(b))
    # Welch–Satterthwaite degrees of freedom
    df = (np.var(a, ddof=1)/len(a) + np.var(b, ddof=1)/len(b))**2 / (
        (np.var(a, ddof=1)/len(a))**2 / (len(a)-1) +
        (np.var(b, ddof=1)/len(b))**2 / (len(b)-1)
    )
    t_critical = stats.t.ppf(0.975, df)
    return TestResult(
        test_name="Welch's t-test",
        statistic=float(t_stat),
        p_value=float(p),
        effect_size_name="Cohen's d",
        effect_size=cohens_d(a, b),
        mean_diff=float(diff),
        ci_low=float(diff - t_critical * se),
        ci_high=float(diff + t_critical * se),
        n1=len(a), n2=len(b),
    )


def mann_whitney(a: np.ndarray, b: np.ndarray, alternative: str = "two-sided") -> TestResult:
    """Mann-Whitney U test with rank-biserial effect size and bootstrap CI."""
    u_stat, p = stats.mannwhitneyu(a, b, alternative=alternative)
    # Rank-biserial correlation: signed effect size, range [-1, 1]
    r_rb = 1 - (2 * u_stat) / (len(a) * len(b))
    diff = np.mean(a) - np.mean(b)
    
    # Bootstrap CI on median difference (more appropriate for non-parametric)
    rng = np.random.default_rng(42)
    boot_diffs = np.empty(10000)
    for i in range(10000):
        a_boot = rng.choice(a, size=len(a), replace=True)
        b_boot = rng.choice(b, size=len(b), replace=True)
        boot_diffs[i] = np.mean(a_boot) - np.mean(b_boot)
    ci_low, ci_high = np.percentile(boot_diffs, [2.5, 97.5])
    
    return TestResult(
        test_name="Mann-Whitney U",
        statistic=float(u_stat),
        p_value=float(p),
        effect_size_name="Rank-biserial r",
        effect_size=float(r_rb),
        mean_diff=float(diff),
        ci_low=float(ci_low),
        ci_high=float(ci_high),
        n1=len(a), n2=len(b),
    )
```

Now in your notebook:

```python
from src.statistics import mann_whitney, welch_t_test

pre = purchases.loc[purchases['automation_period']=='pre', 'invoice_to_payment_days'].values
post = purchases.loc[purchases['automation_period']=='post', 'invoice_to_payment_days'].values

result = mann_whitney(pre, post, alternative='greater')
print(result)
```

The result is reproducible, well-documented, type-checked, and includes everything you need (statistic, p-value, effect size, CI, sample sizes) in one consistent format.

## 6.3 Time series intervention analysis — going deeper than t-test

The Mann-Whitney / t-test approach treats pre and post as independent groups, ignoring that procurement is a continuous process and many factors may change over time. More rigorous causal methods:

### 6.3.1 Interrupted time series (ITS) analysis

ITS models the trend before and after an intervention, allowing both an immediate level change and a slope change.

The standard ITS regression:

$$Y_t = \beta_0 + \beta_1 T_t + \beta_2 X_t + \beta_3 (X_t \cdot T_t) + \epsilon_t$$

where:
- $Y_t$ = outcome at time t (e.g., monthly mean cycle time)
- $T_t$ = time index (1, 2, 3, ...)
- $X_t$ = intervention indicator (0 before, 1 after)
- $\beta_0$ = baseline level
- $\beta_1$ = pre-intervention slope
- $\beta_2$ = immediate level change at intervention
- $\beta_3$ = change in slope after intervention

```python
import pandas as pd
import numpy as np
import statsmodels.api as sm

# Monthly aggregation
monthly = (
    purchases
    .assign(month=pd.to_datetime(purchases['pr_date']).dt.to_period('M').dt.to_timestamp())
    .groupby('month', as_index=False)['invoice_to_payment_days']
    .mean()
    .rename(columns={'invoice_to_payment_days': 'mean_days'})
)

# Set up regression variables
intervention_date = pd.Timestamp('2025-01-01')
monthly['T'] = range(1, len(monthly) + 1)
monthly['X'] = (monthly['month'] >= intervention_date).astype(int)
# Time since intervention (0 before, then counts up)
monthly['XT'] = monthly['X'] * (monthly['T'] - monthly.loc[monthly['X']==1, 'T'].min() + 1)

# Fit the ITS model
X_mat = sm.add_constant(monthly[['T', 'X', 'XT']])
model = sm.OLS(monthly['mean_days'], X_mat).fit()
print(model.summary())

# Interpretation of coefficients
print(f"\nBaseline level (β₀): {model.params['const']:.2f} days")
print(f"Pre-intervention slope (β₁): {model.params['T']:.3f} days/month")
print(f"Immediate level change at intervention (β₂): {model.params['X']:.2f} days")
print(f"Change in slope post-intervention (β₃): {model.params['XT']:.3f} days/month")
```

A significant negative β₂ confirms the immediate drop. β₃ tells you if the slope also changed (sustained improvement vs one-time reset).

### 6.3.2 Plotting the ITS result

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(12, 6))
ax.scatter(monthly['month'], monthly['mean_days'], color='black', label='Observed')

# Counterfactual: what would have happened without intervention?
counterfactual = (
    model.params['const'] + 
    model.params['T'] * monthly['T']
)
# Actual fitted model:
fitted = model.predict(X_mat)

ax.plot(monthly['month'], fitted, color='blue', label='ITS model fit')
ax.plot(
    monthly.loc[monthly['X']==1, 'month'],
    counterfactual[monthly['X']==1],
    color='red', linestyle='--', label='Counterfactual (no intervention)'
)
ax.axvline(intervention_date, color='gray', linestyle=':', label='Intervention')
ax.set_xlabel('Month')
ax.set_ylabel('Mean Invoice-to-Payment Days')
ax.set_title('Interrupted Time Series Analysis')
ax.legend()
plt.savefig('reports/figures/its_analysis.png', dpi=150)
```

The dashed red counterfactual line shows what would have continued without the intervention. The gap between observed (blue) and counterfactual (red) after the intervention is the estimated effect.

### 6.3.3 Difference-in-differences (DiD)

If you have a comparison group that *didn't* receive the automation (e.g., another mine in the same company group), DiD can estimate causal effect more rigorously.

The DiD estimator:

$$\hat{\delta} = (\bar{Y}_{post}^{treated} - \bar{Y}_{pre}^{treated}) - (\bar{Y}_{post}^{control} - \bar{Y}_{pre}^{control})$$

```python
# Hypothetical setup: 'mine' column with 'treated' (got automation) and 'control'
# Both observed pre and post
import statsmodels.formula.api as smf

# DiD regression: 
# Y = β₀ + β₁ * post + β₂ * treated + β₃ * (post * treated) + ε
# β₃ is the DiD estimator (causal effect)
model = smf.ols(
    'invoice_to_payment_days ~ post + treated + post:treated',
    data=combined_df
).fit()
print(model.summary())
```

The interaction term `post:treated` (β₃) is the difference-in-differences estimate: the effect of the intervention beyond what would be expected from time trends affecting both groups.

For your dataset (only one mine), DiD isn't applicable — but it's worth knowing the technique exists for future projects.

### 6.3.4 Causal inference summary

| Method | Requires | Strength |
|---|---|---|
| Before/after t-test | Just two groups in time | Weak; assumes no other time-varying factors |
| Interrupted time series | Time series before and after | Moderate; controls for pre-existing trend |
| Difference-in-differences | Treated AND control group | Strong; controls for time-varying common factors |
| Synthetic control | Multiple control units | Strong; constructs counterfactual from weighted combinations |
| Randomized controlled trial | Random assignment | Gold standard; rarely available in business contexts |

For procurement automation analysis, **interrupted time series is the practical sweet spot** — it adds rigor over a basic t-test without requiring a control group.

## 6.4 Bayesian alternative to hypothesis testing

Frequentist tests give p-values: "the probability of seeing data this extreme if the null hypothesis were true." This is widely misunderstood. Bayesian methods give directly interpretable posterior probabilities: "given the data, the probability that post-automation is faster is X%."

### 6.4.1 Why Bayesian for procurement

- Stakeholders intuitively understand "98% probability the automation works" better than "p < 0.05"
- Bayesian estimates always provide uncertainty (full posterior distribution), not just a binary reject/fail-to-reject
- Easier to incorporate prior information (e.g., results from similar mines)
- Sequential analysis is natural (update beliefs as new data arrives)

### 6.4.2 Bayesian estimation with PyMC

```python
# pip install pymc==5.10.0
import pymc as pm
import numpy as np
import arviz as az
import matplotlib.pyplot as plt

with pm.Model() as model:
    # Priors — beliefs about parameters before seeing data
    mu_pre = pm.Normal('mu_pre', mu=20, sigma=10)
    mu_post = pm.Normal('mu_post', mu=10, sigma=10)
    sigma_pre = pm.HalfNormal('sigma_pre', sigma=10)
    sigma_post = pm.HalfNormal('sigma_post', sigma=10)
    
    # Likelihood — how data depends on parameters
    obs_pre = pm.Normal('obs_pre', mu=mu_pre, sigma=sigma_pre, observed=pre)
    obs_post = pm.Normal('obs_post', mu=mu_post, sigma=sigma_post, observed=post)
    
    # Derived quantity: difference
    diff = pm.Deterministic('diff', mu_pre - mu_post)
    
    # Sample posterior
    trace = pm.sample(2000, tune=1000, random_seed=42, return_inferencedata=True)

# Posterior summaries
print(az.summary(trace, var_names=['mu_pre', 'mu_post', 'diff']))

# Probability post < pre
diff_samples = trace.posterior['diff'].values.flatten()
prob_post_faster = (diff_samples > 0).mean()
print(f"\nP(post < pre | data) = {prob_post_faster:.4f}")

# 95% credible interval
ci_low, ci_high = np.percentile(diff_samples, [2.5, 97.5])
print(f"95% credible interval on difference: ({ci_low:.2f}, {ci_high:.2f})")

# Plot posterior
az.plot_posterior(trace, var_names=['diff'], ref_val=0)
plt.savefig('reports/figures/bayesian_posterior.png', dpi=150)
```

The output gives you a *full distribution* of plausible differences, not just a point estimate. The 95% **credible interval** has the intuitive interpretation people often (incorrectly) attribute to frequentist confidence intervals: "given the data, there's a 95% probability the true difference is in this range."

### 6.4.3 When to use Bayesian vs Frequentist

| Use Bayesian if... | Use Frequentist if... |
|---|---|
| Stakeholders want intuitive probability statements | Following established methodology |
| You have prior information to incorporate | Communicating to statistical reviewers |
| Small samples (Bayesian regularizes better) | Large samples (CLT makes results similar anyway) |
| Sequential decision-making | One-shot decision |
| Complex models (hierarchical, non-standard) | Standard two-sample comparison |

For procurement, I'd recommend **leading with frequentist for the formal report** (it's the lingua franca), then **adding a Bayesian "translation" for stakeholders**: "this corresponds to a 99.7% probability that the automation reduced cycle time, given the data."

## 6.5 Advanced visualizations

Beyond the standard bar/line/scatter, several chart types are particularly useful for procurement analytics.

### 6.5.1 Treemap for spend hierarchy

A treemap shows hierarchical data with nested rectangles — each rectangle's size proportional to its share of the total.

```python
import plotly.express as px

# Two-level treemap: category → supplier
treemap_data = purchases.groupby(['category', 'supplier_name'])['total_value_usd'].sum().reset_index()
fig = px.treemap(
    treemap_data,
    path=['category', 'supplier_name'],
    values='total_value_usd',
    title='Spend Hierarchy: Category → Supplier',
)
fig.update_traces(textinfo='label+percent parent')
fig.write_html('reports/figures/spend_treemap.html')
```

Good for at-a-glance understanding of where spend concentrates. Limitation: hard to compare exact values; eyes are bad at comparing rectangle areas precisely.

### 6.5.2 Sankey diagram for flow analysis

A Sankey shows flows between categories. For procurement, useful to show: which suppliers feed which categories, or how PRs flow through approval paths.

```python
import plotly.graph_objects as go

# Example: country → category flows (by spend)
flow = purchases.merge(
    suppliers[['supplier_id', 'country', 'category']], 
    on='supplier_id'
).groupby(['country', 'category_y'])['total_value_usd'].sum().reset_index()
flow.columns = ['country', 'category', 'spend']

countries = list(flow['country'].unique())
categories = list(flow['category'].unique())
labels = countries + categories
source = [countries.index(c) for c in flow['country']]
target = [len(countries) + categories.index(c) for c in flow['category']]
value = flow['spend'].tolist()

fig = go.Figure(go.Sankey(
    node=dict(label=labels, pad=15, thickness=20),
    link=dict(source=source, target=target, value=value),
))
fig.update_layout(title='Spend Flow: Country of Origin → Category', font_size=10)
fig.write_html('reports/figures/spend_sankey.html')
```

### 6.5.3 Waterfall chart for cycle time decomposition

Shows how a starting value is broken down by sequential additions/subtractions.

```python
# Waterfall: stages contributing to total cycle time (post-automation)
stages_post = purchases[purchases['automation_period']=='post'][[
    'pr_to_po_days', 'po_to_delivery_days', 
    'delivery_to_invoice_days', 'invoice_to_payment_days'
]].mean()

fig = go.Figure(go.Waterfall(
    x=['PR→PO', 'PO→Delivery', 'Delivery→Invoice', 'Invoice→Payment', 'Total'],
    y=list(stages_post.values) + [None],
    measure=['relative', 'relative', 'relative', 'relative', 'total'],
    text=[f'{v:.1f}d' for v in stages_post.values] + [f'{stages_post.sum():.1f}d'],
    textposition='outside',
))
fig.update_layout(title='Cycle Time Waterfall (Post-Automation)', yaxis_title='Days')
fig.write_html('reports/figures/cycle_waterfall.html')
```

### 6.5.4 Parallel coordinates for multivariate supplier comparison

Each supplier becomes a line crossing parallel axes (one per metric). Patterns and outliers jump out.

```python
import plotly.express as px

# Top 20 suppliers by spend
top_n = metrics.nlargest(20, 'total_spend_usd')
fig = px.parallel_coordinates(
    top_n,
    color='total_spend_usd',
    dimensions=[
        'on_time_delivery_pct',
        'defect_rate_pct',
        'rfx_response_rate_pct',
        'avg_lead_time_days',
        'three_way_match_pct',
    ],
    color_continuous_scale='Viridis',
    title='Top 20 Suppliers — Multivariate Performance Profile',
)
fig.write_html('reports/figures/supplier_parallel_coords.html')
```

### 6.5.5 Lollipop chart for clean ranked comparison

Stylish alternative to bar charts for ranked data — less visual clutter:

```python
import matplotlib.pyplot as plt

top10 = (
    purchases.groupby('supplier_name')['total_value_usd']
    .sum().nlargest(10).sort_values()
)

fig, ax = plt.subplots(figsize=(10, 6))
ax.hlines(y=top10.index, xmin=0, xmax=top10.values/1e6, color='steelblue', linewidth=2)
ax.plot(top10.values/1e6, top10.index, 'o', markersize=10, color='steelblue')
ax.set_xlabel('Spend (USD millions)')
ax.set_title('Top 10 Suppliers by Spend (Lollipop)')
for x, y in zip(top10.values/1e6, top10.index):
    ax.text(x + 5, y, f'${x:.0f}M', va='center')
plt.tight_layout()
plt.savefig('reports/figures/top_suppliers_lollipop.png', dpi=150)
```

### 6.5.6 Heatmap for cycle time by category × month

```python
import seaborn as sns

heatmap_data = (
    purchases
    .assign(month=pd.to_datetime(purchases['pr_date']).dt.to_period('M').astype(str))
    .groupby(['category', 'month'])['total_cycle_days']
    .mean()
    .unstack(fill_value=np.nan)
)

fig, ax = plt.subplots(figsize=(16, 8))
sns.heatmap(
    heatmap_data, 
    cmap='RdYlGn_r',  # red = bad (long cycle), green = good
    annot=True, fmt='.0f',
    cbar_kws={'label': 'Mean Cycle Days'},
    ax=ax
)
ax.set_title('Cycle Time Heatmap: Category × Month')
plt.tight_layout()
plt.savefig('reports/figures/cycle_heatmap.png', dpi=150)
```

## 6.6 Advanced clustering: HDBSCAN, UMAP, ensemble approaches

K-means has well-known limitations. Three advanced techniques to know:

### 6.6.1 HDBSCAN — hierarchical density-based clustering

HDBSCAN is DBSCAN's modern cousin. It:
- Automatically identifies the number of clusters
- Handles clusters of different densities
- Marks outliers explicitly
- Doesn't require pre-specifying k

```python
# pip install hdbscan
import hdbscan

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=3,  # minimum suppliers per cluster
    min_samples=2,       # density requirement
    metric='euclidean',
)
labels = clusterer.fit_predict(X)
print(f"HDBSCAN found {len(set(labels)) - (1 if -1 in labels else 0)} clusters, "
      f"{(labels == -1).sum()} outliers")

# Outliers (label = -1) are interesting on their own — they're suppliers that 
# don't fit any natural group. Worth individual review.
outliers = metrics[labels == -1][['supplier_name', 'tier', 'total_spend_usd']]
print("\nOutlier suppliers (no natural cluster):")
print(outliers)
```

### 6.6.2 UMAP for visualization

PCA preserves global structure but distorts local distances. **UMAP** (Uniform Manifold Approximation and Projection) preserves local neighborhoods, making clusters more visually distinct.

```python
# pip install umap-learn
import umap

reducer = umap.UMAP(n_neighbors=5, min_dist=0.3, random_state=42)
X_umap = reducer.fit_transform(X)

plt.figure(figsize=(10, 8))
for cluster_id in set(labels):
    mask = labels == cluster_id
    label_name = f'Cluster {cluster_id}' if cluster_id != -1 else 'Outliers'
    plt.scatter(X_umap[mask, 0], X_umap[mask, 1], label=label_name, s=80, alpha=0.7)
plt.xlabel('UMAP 1')
plt.ylabel('UMAP 2')
plt.title('Supplier Clusters via HDBSCAN + UMAP')
plt.legend()
plt.savefig('reports/figures/cluster_umap.png', dpi=150)
```

### 6.6.3 Ensemble clustering for stability

Run multiple algorithms and combine results to find robust groupings:

```python
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import adjusted_rand_score

# Run 3 different algorithms
labels_kmeans = KMeans(n_clusters=4, random_state=42, n_init=10).fit_predict(X)
labels_hier = AgglomerativeClustering(n_clusters=4).fit_predict(X)
labels_hdbscan = hdbscan.HDBSCAN(min_cluster_size=3).fit_predict(X)

# Agreement between methods
print(f"K-means vs Hierarchical ARI: {adjusted_rand_score(labels_kmeans, labels_hier):.3f}")
print(f"K-means vs HDBSCAN ARI: {adjusted_rand_score(labels_kmeans, labels_hdbscan):.3f}")

# A supplier is "robustly clustered" if all three methods place it with similar peers
# This is a sophisticated technique — beyond the scope of an initial analysis but 
# powerful for validating findings
```

## 6.7 Testing analytical code with pytest

Analytical code that goes into production (or even repeated quarterly reports) needs tests. Tests catch regressions, document expected behavior, and let you refactor with confidence.

### 6.7.1 Setup

```bash
pip install pytest pytest-cov
```

Create `tests/` directory parallel to `src/`:

```
procurement_analytics/
├── src/
│   ├── data_loader.py
│   ├── abc.py
│   └── statistics.py
└── tests/
    ├── __init__.py
    ├── test_abc.py
    ├── test_statistics.py
    └── test_data_loader.py
```

### 6.7.2 Test the ABC classification

```python
# tests/test_abc.py
import pandas as pd
import pytest
from src.abc import abc_classify, abc_summary


@pytest.fixture
def sample_data():
    """Create a small DataFrame with known structure."""
    return pd.DataFrame({
        'supplier_id': ['S1', 'S2', 'S3', 'S4', 'S5'],
        'total_value_usd': [100, 50, 30, 15, 5],  # totals to 200
    })


def test_abc_classify_basic(sample_data):
    """Verify ABC classification on known data."""
    result = abc_classify(sample_data)
    
    # S1 alone is 50% → A
    # S1+S2 is 75% → still A
    # S1+S2+S3 is 90% → B
    # S1+S2+S3+S4 is 97.5% → C
    # S1+S2+S3+S4+S5 is 100% → C
    expected_classes = ['A', 'A', 'B', 'C', 'C']
    assert list(result['abc_class']) == expected_classes


def test_abc_classify_invalid_thresholds():
    """Invalid thresholds should raise ValueError."""
    df = pd.DataFrame({'supplier_id': ['S1'], 'total_value_usd': [100]})
    with pytest.raises(ValueError, match="Invalid thresholds"):
        abc_classify(df, thresholds=(0.95, 0.80))  # wrong order
    with pytest.raises(ValueError, match="Invalid thresholds"):
        abc_classify(df, thresholds=(1.5, 2.0))  # > 1


def test_abc_classify_zero_total():
    """All-zero spend should raise."""
    df = pd.DataFrame({'supplier_id': ['S1', 'S2'], 'total_value_usd': [0, 0]})
    with pytest.raises(ValueError, match="zero"):
        abc_classify(df)


def test_abc_summary_counts(sample_data):
    """Summary should add up to total."""
    result = abc_classify(sample_data)
    summary = abc_summary(result)
    assert summary['n'].sum() == len(sample_data)
    assert abs(summary['pct_of_count'].sum() - 100.0) < 1e-6
    assert abs(summary['pct_of_spend'].sum() - 100.0) < 1e-6
```

Run tests:

```bash
pytest tests/ -v
pytest tests/ --cov=src --cov-report=html  # with coverage report
```

### 6.7.3 Test the statistical functions

```python
# tests/test_statistics.py
import numpy as np
import pytest
from src.statistics import cohens_d, welch_t_test, mann_whitney


def test_cohens_d_identical_samples():
    """Effect size between identical samples should be ~0."""
    rng = np.random.default_rng(42)
    a = rng.normal(0, 1, 100)
    b = rng.normal(0, 1, 100)
    # Won't be exactly 0 due to sampling variability
    assert abs(cohens_d(a, b)) < 0.3


def test_cohens_d_large_difference():
    """Large mean difference should produce large d."""
    rng = np.random.default_rng(42)
    a = rng.normal(0, 1, 100)
    b = rng.normal(2, 1, 100)
    d = cohens_d(a, b)
    # Mean diff = -2, pooled SD ≈ 1, so d ≈ -2
    assert -2.5 < d < -1.5


def test_welch_t_test_detects_difference():
    """Welch's t should detect a real difference."""
    rng = np.random.default_rng(42)
    a = rng.normal(10, 2, 100)
    b = rng.normal(5, 2, 100)
    result = welch_t_test(a, b)
    assert result.p_value < 0.001
    assert result.effect_size > 0
    assert result.mean_diff > 0


def test_welch_t_test_no_difference():
    """Welch's t should fail to detect a difference where none exists."""
    rng = np.random.default_rng(42)
    a = rng.normal(0, 1, 100)
    b = rng.normal(0, 1, 100)
    result = welch_t_test(a, b)
    # 95% of the time, this won't reject at α=0.05
    # Use a higher threshold for the test
    assert result.p_value > 0.01


def test_mann_whitney_robust_to_outliers():
    """Mann-Whitney should be robust to extreme outliers."""
    a = np.array([1, 2, 3, 4, 5])
    b = np.array([1, 2, 3, 4, 5, 1000000])  # extreme outlier in b
    # Despite the outlier, the underlying distributions overlap
    result_mw = mann_whitney(a, b)
    # t-test would be heavily biased by the outlier
    # Mann-Whitney shouldn't be — p-value won't be tiny
    assert result_mw.p_value > 0.05
```

### 6.7.4 Continuous integration

If you put this in a git repository, add a GitHub Actions workflow to run tests automatically:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt
      - run: pip install pytest pytest-cov
      - run: pytest tests/ --cov=src
```

Every push runs the tests automatically — if you break something, you know immediately.

## 6.8 Data quality framework

Before any analysis, validate the data. A documented data quality check protects you from publishing wrong findings.

### 6.8.1 Validation dimensions

| Dimension | What it checks | Example |
|---|---|---|
| **Completeness** | Required fields populated | No null po_id |
| **Uniqueness** | No duplicates where expected | po_id is unique |
| **Validity** | Values in expected ranges | total_value_usd > 0 |
| **Consistency** | Internal logic holds | po_date >= pr_date |
| **Referential integrity** | Foreign keys resolve | supplier_id exists in suppliers table |
| **Timeliness** | Data is current enough | latest pr_date within last 30 days |
| **Accuracy** | Spot checks against source | Sample 10 POs, verify against ERP |

### 6.8.2 Implementation

```python
# src/data_quality.py
"""Data quality checks."""
from dataclasses import dataclass
from typing import List
import pandas as pd


@dataclass
class DataQualityCheck:
    """Result of a single data quality check."""
    check_name: str
    passed: bool
    severity: str  # 'error', 'warning', 'info'
    details: str
    n_records_affected: int = 0


def check_purchases(df: pd.DataFrame) -> List[DataQualityCheck]:
    """Run quality checks on purchases DataFrame."""
    checks = []
    
    # Completeness
    n_null_supplier = df['supplier_id'].isnull().sum()
    checks.append(DataQualityCheck(
        check_name='supplier_id completeness',
        passed=n_null_supplier == 0,
        severity='error',
        details=f"{n_null_supplier} rows have null supplier_id" if n_null_supplier else "All rows have supplier_id",
        n_records_affected=int(n_null_supplier),
    ))
    
    # Uniqueness
    n_dupes = df['po_id'].duplicated().sum()
    checks.append(DataQualityCheck(
        check_name='po_id uniqueness',
        passed=n_dupes == 0,
        severity='error',
        details=f"{n_dupes} duplicate po_ids found" if n_dupes else "All po_ids unique",
        n_records_affected=int(n_dupes),
    ))
    
    # Validity
    n_negative = (df['total_value_usd'] < 0).sum()
    checks.append(DataQualityCheck(
        check_name='total_value_usd validity',
        passed=n_negative == 0,
        severity='warning',
        details=f"{n_negative} rows have negative spend (returns?)" if n_negative else "No negative values",
        n_records_affected=int(n_negative),
    ))
    
    # Consistency: po_date >= pr_date
    inconsistent = (df['po_date'] < df['pr_date']).sum()
    checks.append(DataQualityCheck(
        check_name='po_date >= pr_date',
        passed=inconsistent == 0,
        severity='error',
        details=f"{inconsistent} rows have po_date before pr_date" if inconsistent else "All dates consistent",
        n_records_affected=int(inconsistent),
    ))
    
    # Consistency: delivery >= po
    inconsistent2 = (df['delivery_date'] < df['po_date']).sum()
    checks.append(DataQualityCheck(
        check_name='delivery_date >= po_date',
        passed=inconsistent2 == 0,
        severity='error',
        details=f"{inconsistent2} inconsistent delivery dates" if inconsistent2 else "Consistent",
        n_records_affected=int(inconsistent2),
    ))
    
    # Outlier detection (>3 IQR from median)
    Q1 = df['total_value_usd'].quantile(0.25)
    Q3 = df['total_value_usd'].quantile(0.75)
    IQR = Q3 - Q1
    outliers = ((df['total_value_usd'] < Q1 - 3*IQR) | (df['total_value_usd'] > Q3 + 3*IQR)).sum()
    checks.append(DataQualityCheck(
        check_name='total_value_usd outliers',
        passed=True,  # outliers aren't necessarily errors
        severity='info',
        details=f"{outliers} potential outliers (>3 IQR from median)",
        n_records_affected=int(outliers),
    ))
    
    return checks


def render_quality_report(checks: List[DataQualityCheck]) -> str:
    """Format checks as a readable report."""
    lines = ["Data Quality Report", "=" * 80]
    n_errors = sum(1 for c in checks if c.severity == 'error' and not c.passed)
    n_warnings = sum(1 for c in checks if c.severity == 'warning' and not c.passed)
    lines.append(f"Errors: {n_errors} | Warnings: {n_warnings} | Total checks: {len(checks)}")
    lines.append("-" * 80)
    for c in checks:
        status = "✓ PASS" if c.passed else f"✗ {c.severity.upper()}"
        lines.append(f"{status:10s} {c.check_name}")
        lines.append(f"           {c.details}")
    return "\n".join(lines)
```

Run before any analysis:

```python
from src.data_quality import check_purchases, render_quality_report
checks = check_purchases(purchases)
report = render_quality_report(checks)
print(report)

# Fail the analysis if any errors found
errors = [c for c in checks if c.severity == 'error' and not c.passed]
if errors:
    raise RuntimeError(f"Data quality errors detected: {[c.check_name for c in errors]}")
```

## 6.9 Docker for full reproducibility

`requirements.txt` pins Python libraries but not the Python version, system libraries, or OS. **Docker** captures the entire environment.

### 6.9.1 Dockerfile

```dockerfile
FROM python:3.11-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install jupyter

EXPOSE 8888
CMD ["jupyter", "notebook", "--ip=0.0.0.0", "--no-browser", "--allow-root"]
```

### 6.9.2 Build and run

```bash
docker build -t procurement-analytics .
docker run -p 8888:8888 -v $(pwd):/work procurement-analytics
```

Now the analysis runs identically on any machine that has Docker — Linux, Mac, Windows. Three years from now, that same Docker image still produces the same results.

### 6.9.3 docker-compose for multi-service setups

If you also want a PostgreSQL database for the data:

```yaml
# docker-compose.yml
version: '3.8'
services:
  jupyter:
    build: .
    ports: ["8888:8888"]
    volumes: [".:/work"]
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: procurement
    ports: ["5432:5432"]
    volumes: ["./data/raw:/data:ro"]
```

Run with: `docker-compose up`.

## 6.10 Performance optimization for larger datasets

Your current dataset is small (640 records). Real procurement systems may have 100K+ POs/year. Optimizations to know:

### 6.10.1 Vectorize, don't iterate

```python
# Slow:
results = []
for idx, row in purchases.iterrows():
    if row['total_value_usd'] > 10000:
        results.append(row['supplier_id'])

# Fast (vectorized):
mask = purchases['total_value_usd'] > 10000
results = purchases.loc[mask, 'supplier_id'].tolist()
```

The vectorized version is typically 10-100x faster.

### 6.10.2 Use categorical dtype for repeated strings

```python
purchases['supplier_id'] = purchases['supplier_id'].astype('category')
purchases['category'] = purchases['category'].astype('category')
# Memory usage drops dramatically; groupbys become faster
```

### 6.10.3 Profile before optimizing

```python
import cProfile
import pstats

profile = cProfile.Profile()
profile.enable()

# Run your analysis here
abc_classify(purchases)

profile.disable()
stats = pstats.Stats(profile)
stats.sort_stats('cumulative').print_stats(20)  # top 20 time-consuming functions
```

Optimize the bottleneck, not the convenient.

### 6.10.4 For really large data: switch tools

- **Pandas**: works well up to ~10M rows on modern hardware
- **Polars**: 10-100x faster than pandas; similar API; good for 10M-1B rows
- **DuckDB**: SQL on Parquet/CSV files; embedded; excellent for analytical queries
- **PySpark**: distributed; for >1B rows or when you need cluster computing

Migration paths are straightforward — Polars syntax is close to pandas.

```python
# Polars equivalent of pandas groupby
import polars as pl
purchases_pl = pl.read_csv('data/raw/purchases.csv')
spend = (
    purchases_pl
    .group_by('supplier_id')
    .agg([
        pl.col('total_value_usd').sum().alias('total'),
        pl.col('po_id').count().alias('n_pos'),
    ])
    .sort('total', descending=True)
)
```

## 6.11 Reproducible notebooks with papermill

Papermill lets you parameterize notebooks and execute them programmatically. Useful for repeated monthly analyses.

```bash
pip install papermill
```

In your notebook, add a "parameters" cell (tagged `parameters` in Jupyter):

```python
# This cell tagged 'parameters'
start_date = '2025-01-01'
end_date = '2025-12-31'
output_dir = 'reports/'
```

Execute from command line:

```bash
papermill notebooks/01_abc_analysis.ipynb \
    output/01_abc_analysis_2025Q4.ipynb \
    -p start_date '2025-10-01' \
    -p end_date '2025-12-31' \
    -p output_dir 'reports/2025Q4/'
```

This produces a new executed notebook for each quarter with the parameters baked in. Excellent for monthly/quarterly report automation.

## 6.12 Logging in analytical code

Stop using `print()`. Use Python's logging module for proper observability.

```python
# At the top of your module
import logging
logger = logging.getLogger(__name__)

# Configuration (set once in your application entry point or notebook)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)8s | %(name)s | %(message)s',
    handlers=[
        logging.FileHandler('logs/analysis.log'),
        logging.StreamHandler(),  # also print to console
    ]
)

# Throughout your code:
logger.info(f"Starting ABC analysis on {len(df)} records")
logger.warning(f"Found {n_neg} negative spend records")
logger.debug(f"Cumulative threshold: {threshold}")
logger.error(f"Validation failed: {error_msg}")
```

Benefits over `print()`:
- Levels (DEBUG, INFO, WARNING, ERROR) let you control verbosity
- Timestamps automatically included
- Can route to file, console, or external systems
- Survives in production logs for post-hoc debugging

## 6.13 Final principles for production-quality analytics

After all the technical detail above, the principles boil down to:

1. **Make it reproducible**: random seeds, pinned versions, version control, Docker if possible
2. **Make it inspectable**: log everything, validate inputs, sanity-check outputs
3. **Make it testable**: extract logic into functions/modules with unit tests
4. **Make it documented**: every analysis has a written report, not just code
5. **Make it modular**: small pieces composed together, not monolithic notebooks
6. **Make it efficient**: vectorize, profile, use appropriate tools for data size
7. **Make it honest**: report effect sizes and confidence intervals, not just p-values
8. **Make it useful**: every finding paired with a business implication and a recommendation

The fancy techniques (Bayesian, ITS, HDBSCAN, UMAP, Docker, parametrized notebooks) are valuable but not always necessary. Apply them when the problem genuinely calls for the additional rigor, not because they're impressive.

For a procurement trainee project: the core path (ABC + clustering + hypothesis test, with proper documentation) gets you to a solid deliverable. The advanced techniques are how you'd take that work to senior-analyst level.

