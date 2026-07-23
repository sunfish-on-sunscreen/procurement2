"""Post-seed compute step — the DB-sourced replacement for what the (now disabled)
upload route used to do: regenerate the SupplierMetric rows + all AnalysisResult
rows from the seeded normalized data.

Pipeline:
  1. Read the Supplier master + the derived EnrichedPurchase view.
  2. For each ORDER-YEAR period, score per-supplier metrics via the proven-exact
     scores.build_window_metrics (period dimension = the view's `period` column) and
     write SupplierMetric rows (delete-then-insert per period).
  3. Run compute_analyses.py --period-id for every period (Mode A → AnalysisResult).
  4. Clear the range cache (AnalysisResult rows with periodId IS NULL).

Idempotent; safe to re-run after any reseed. Order-year bucketing (per the migration
decision) — NOT payment-year — so SupplierMetric membership converges with the
PurchaseOrder.period column and compute_analyses' poDate filter.

Run:  python/.venv/Scripts/python seed_compute.py
      python/.venv/Scripts/python seed_compute.py --json   (machine-readable)

With --json the human progress lines go to STDERR and a single summary JSON object
is the ONLY thing on stdout, so the app (lib/recompute.ts) can spawn this and parse
the result. Without it, behaviour is unchanged (progress on stdout, no JSON).
"""
import argparse
import json
import os
import subprocess
import sys

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scores  # noqa: E402

# When True, progress output is redirected to stderr so stdout carries only JSON.
_JSON_MODE = False


def log(*args) -> None:
    """Progress output. Goes to stderr in --json mode so stdout stays parseable."""
    print(*args, file=sys.stderr if _JSON_MODE else sys.stdout, flush=True)


def get_database_url() -> str:
    """DATABASE_URL from the project .env (carries a UTF-8 BOM → utf-8-sig). Also
    exported to os.environ so the compute_analyses subprocess inherits it."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = os.path.join(HERE, "..", ".env")
    with open(env_path, encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("DATABASE_URL"):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                os.environ["DATABASE_URL"] = url
                return url
    raise RuntimeError("DATABASE_URL not found in environment or ../.env")


def _df(conn, query):
    with conn.cursor() as cur:
        cur.execute(query)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


# SupplierMetric columns written here. (The old kraljic denormalization columns —
# supplyRiskScore / kraljicQuadrant / categoryCompetition — were dropped: they were
# rewritten on every recompute and read by nothing. Kraljic values live in the
# `kraljic` AnalysisResult payload, which every consumer already reads.)
_METRIC_INSERT_COLS = [
    "id", "supplierExternalId", "supplierName", "category",
    "qualityScore", "deliveryScore", "processScore", "riskScore",
    "compositeScore", "periodId",
]


def write_supplier_metrics(conn):
    """Score + write per-order-year SupplierMetric rows from the normalized data."""
    suppliers = _df(conn, 'SELECT id AS supplier_id, "supplierName" AS supplier_name, '
                          'country, category FROM "Supplier" ORDER BY id')
    # ⚠️ ORDER BY is load-bearing, not cosmetic: float addition is not associative, so
    # an unordered read makes per-supplier sums depend on physical row order. That is
    # invisible in `total_spend_usd` (rounded straight to 2dp) but CAN flip
    # `avg_po_value_usd`, which divides the UNROUNDED sum — e.g. S0018/2025 summed to
    # 8250602.14 or 8250602.140000001 depending on order, rounding to .53 vs .54.
    enriched = _df(conn, 'SELECT * FROM "EnrichedPurchase" ORDER BY "poId"')
    if len(enriched) == 0:
        raise RuntimeError("EnrichedPurchase view returned 0 rows — did the seed run?")

    # camelCase view -> snake_case engine columns (period + poId stay as-is).
    pur = scores.rename_purchase_columns(enriched)
    roster = scores.roster_category_counts(suppliers)

    # ORDER BY is load-bearing: without it Postgres returns physical row order, so
    # the period processing sequence could vary between runs on the same data.
    periods = _df(conn, 'SELECT id, name FROM "ReportingPeriod" ORDER BY name')
    pid_by_name = {str(n): pid for pid, n in zip(periods["id"], periods["name"])}

    years_with_data = set(pur["period"].astype(str).unique())

    # A ReportingPeriod can outlive its data — an appended order-year creates one, and a
    # later replace-all may not carry that year. Such a period is AUTO-REMOVED: it would
    # otherwise stay selectable with nothing behind it, and compute_analyses exits
    # non-zero on an empty window, which would fail EVERY subsequent recompute.
    #
    # Safety: only periods with ZERO purchase orders are ever considered, so a period
    # holding data can never be dropped. This runs BEFORE the analysis step, so the
    # removal cannot race a recompute. A stale UI selection is already handled —
    # getCurrentPeriodSelection() validates every id against the live period set and
    # falls back to the latest/oldest.
    #
    # SupplierMetric and AnalysisResult cascade on delete. Import and ExecutiveSummary
    # are RESTRICT: a saved report is user work, so a period carrying one is KEPT
    # (cleared but not dropped); import rows are an upload log whose period tag is
    # arbitrary for a dataset-wide file, so they are re-pointed to a surviving period.
    survivors = sorted(n for n in pid_by_name if n in years_with_data)
    for name, pid in list(pid_by_name.items()):
        if name in years_with_data:
            continue
        with conn.cursor() as cur:
            cur.execute('DELETE FROM "SupplierMetric" WHERE "periodId" = %s', (pid,))
            cur.execute('DELETE FROM "AnalysisResult" WHERE "periodId" = %s', (pid,))
            cur.execute('SELECT COUNT(*) FROM "ExecutiveSummary" WHERE "periodId" = %s', (pid,))
            reports = cur.fetchone()[0]
            if reports:
                conn.commit()
                log(f"  period {name}: no purchase orders, but {reports} saved report(s) — cleared, kept")
                continue
            if not survivors:
                conn.commit()
                log(f"  period {name}: no purchase orders — cleared (no surviving period to re-point to)")
                continue
            cur.execute(
                'UPDATE "Import" SET "periodId" = %s WHERE "periodId" = %s',
                (pid_by_name[survivors[-1]], pid),
            )
            moved = cur.rowcount
            cur.execute('DELETE FROM "ReportingPeriod" WHERE id = %s', (pid,))
        conn.commit()
        pid_by_name.pop(name, None)
        note = f" ({moved} import row(s) re-pointed to {survivors[-1]})" if moved else ""
        log(f"  period {name}: no purchase orders — REMOVED{note}")

    total = 0
    for year in sorted(years_with_data):
        pid = pid_by_name.get(year)
        if pid is None:
            log(f"  WARN: no ReportingPeriod for order-year {year}; skipping")
            continue
        window = pur[pur["period"].astype(str) == year]
        wm = scores.build_window_metrics(suppliers, window, roster)

        records = []
        for _, r in wm.iterrows():
            sid = str(r["supplier_id"])
            records.append((
                f"sm-{pid}-{sid}", sid, str(r["supplier_name"]), str(r["category"]),
                float(r["quality_score"]), float(r["delivery_score"]),
                float(r["process_score"]), float(r["risk_score"]),
                float(r["composite_score"]), pid,
            ))
        with conn.cursor() as cur:
            cur.execute('DELETE FROM "SupplierMetric" WHERE "periodId" = %s', (pid,))
            execute_values(
                cur,
                f'INSERT INTO "SupplierMetric" ({", ".join(chr(34)+c+chr(34) for c in _METRIC_INSERT_COLS)}) VALUES %s',
                records,
            )
        conn.commit()
        total += len(records)
        log(f"  period {year} (pid {pid[:8]}…): {len(records)} SupplierMetric rows")
    log(f"  SupplierMetric total: {total}")
    # Only periods that actually hold purchase orders go on to the analysis step.
    return [(n, p) for n, p in pid_by_name.items() if n in years_with_data]


def run_analyses(period_ids):
    """compute_analyses.py --period-id for each period (Mode A)."""
    compute_py = os.path.join(HERE, "compute_analyses.py")
    for name, pid in period_ids:
        log(f"  compute_analyses period {name} …")
        res = subprocess.run(
            [sys.executable, compute_py, "--period-id", pid],
            env=os.environ, capture_output=True, text=True,
        )
        if res.returncode != 0:
            log(res.stdout)
            print(res.stderr, file=sys.stderr)
            raise RuntimeError(f"compute_analyses failed for period {name} (exit {res.returncode})")
    log(f"  analyses computed for {len(period_ids)} periods")


def clear_range_cache(conn):
    with conn.cursor() as cur:
        cur.execute('DELETE FROM "AnalysisResult" WHERE "periodId" IS NULL')
        n = cur.rowcount
    conn.commit()
    log(f"  cleared {n} range-cache AnalysisResult rows")


def recompute(conn) -> dict:
    """The full recompute, in order. Returns a summary dict. Raises on any failure —
    callers must treat an exception as 'analyses are now stale', since the data
    mutation that triggered this has already committed."""
    log("1) SupplierMetric (order-year):")
    period_ids = write_supplier_metrics(conn)
    log("2) AnalysisResult per period:")
    run_analyses(period_ids)
    log("3) Range cache:")
    clear_range_cache(conn)

    sm = _df(conn, 'SELECT COUNT(*) AS n FROM "SupplierMetric"')["n"][0]
    ar = _df(conn, 'SELECT COUNT(*) AS n FROM "AnalysisResult"')["n"][0]
    ps = _df(conn, 'SELECT MIN("processScore") AS mn, MAX("processScore") AS mx, '
                   'ROUND(AVG("processScore")::numeric,2) AS avg, '
                   'COUNT(DISTINCT "processScore") AS distinct_vals FROM "SupplierMetric"')
    log(f"\nDONE. SupplierMetric={sm}  AnalysisResult={ar}")
    log(f"processScore across suppliers: min={ps['mn'][0]} max={ps['mx'][0]} "
        f"avg={ps['avg'][0]} distinct_values={ps['distinct_vals'][0]} "
        f"(should be >1 distinct — NOT flat 100)")

    return {
        "ok": True,
        "periods": [name for name, _ in period_ids],
        "supplierMetricRows": int(sm),
        "analysisResultRows": int(ar),
        "processScore": {
            "min": float(ps["mn"][0]),
            "max": float(ps["mx"][0]),
            "avg": float(ps["avg"][0]),
            "distinct": int(ps["distinct_vals"][0]),
        },
    }


def main():
    global _JSON_MODE
    parser = argparse.ArgumentParser(description="Regenerate SupplierMetric + AnalysisResult.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit a summary JSON object on stdout (progress goes to stderr)",
    )
    args = parser.parse_args()
    _JSON_MODE = args.json

    conn = None
    try:
        # connect() is inside the try so a bad DSN also reports structurally.
        conn = psycopg2.connect(get_database_url().split("?")[0])
        summary = recompute(conn)
    except Exception as exc:  # surface as a non-zero exit + JSON error for the caller
        if _JSON_MODE:
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
        else:
            print(f"RECOMPUTE FAILED: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        if conn is not None:
            conn.close()

    if _JSON_MODE:
        print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
