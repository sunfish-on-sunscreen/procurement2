import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export type PythonResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * Resolve the python interpreter: prefer the project venv (python/.venv), then
 * fall back to the platform default ("python" on Windows, "python3" elsewhere).
 */
function resolvePythonExecutable(): string {
  const root = process.cwd();
  const isWindows = process.platform === "win32";
  const venvPython = isWindows
    ? path.join(root, "python", ".venv", "Scripts", "python.exe")
    : path.join(root, "python", ".venv", "bin", "python");
  if (existsSync(venvPython)) {
    return venvPython;
  }
  return isWindows ? "python" : "python3";
}

function runScript(
  args: string[],
  timeoutMs?: number,
  scriptName = "compute_analyses.py",
): Promise<PythonResult> {
  return new Promise((resolve) => {
    const root = process.cwd();
    const script = path.join(root, "python", scriptName);
    const child = spawn(resolvePythonExecutable(), [script, ...args], {
      cwd: root,
      detached: false,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs) {
      timer = setTimeout(() => {
        stderr += `\n[python killed after ${timeoutMs}ms timeout]`;
        child.kill();
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Mode A: compute + upsert AnalysisResult rows for a single period. `timeoutMs`
 * (optional) kills a hung Python after that long — passed by the recompute path so
 * a stuck compute can't hang the admin's request. The bulk-import caller omits it
 * (unchanged behaviour).
 */
export function runComputeAnalyses(periodId: string, timeoutMs?: number): Promise<PythonResult> {
  return runScript(["--period-id", periodId], timeoutMs);
}

/** The summary `seed_compute.py --json` prints on stdout when it succeeds. */
export type SeedComputeSummary = {
  ok: true;
  periods: string[];
  supplierMetricRows: number;
  analysisResultRows: number;
  processScore: { min: number; max: number; avg: number; distinct: number };
};

/**
 * THE recompute: `python/seed_compute.py --json`. Regenerates the per-period
 * SupplierMetric rows (scores.build_window_metrics), runs compute_analyses Mode A
 * for every period, and clears the range cache — the same pipeline the post-seed
 * step runs, so the math is reused rather than reimplemented.
 *
 * Note this does STRICTLY MORE than the old per-period `runComputeAnalyses` loop:
 * that one never rewrote SupplierMetric, which is why stored sub-scores used to lag
 * until a full import. Returns `summary: null` with a non-zero `code` on any failure
 * (Python error, timeout, or unparseable stdout).
 */
export function runSeedCompute(
  timeoutMs = 180_000,
): Promise<{ code: number; summary: SeedComputeSummary | null; stderr: string }> {
  return runScript(["--json"], timeoutMs, "seed_compute.py").then((res) => {
    if (res.code !== 0) {
      return { code: res.code, summary: null, stderr: res.stderr };
    }
    try {
      const parsed = JSON.parse(res.stdout.trim()) as SeedComputeSummary | { ok: false; error: string };
      if (!parsed.ok) {
        return { code: -1, summary: null, stderr: `${res.stderr}\n${parsed.error}` };
      }
      return { code: 0, summary: parsed, stderr: res.stderr };
    } catch (e) {
      return {
        code: -1,
        summary: null,
        stderr: `${res.stderr}\nJSON parse error: ${String(e)}`,
      };
    }
  });
}

/** Mode B: compute over a date range and return the analyses JSON on stdout. */
export function runComputeRange(
  startDate: string,
  endDate: string,
  timeoutMs = 30000,
): Promise<PythonResult> {
  return runScript(["--start-date", startDate, "--end-date", endDate], timeoutMs);
}

/**
 * One computed per-period SupplierMetric row from import_compute.py (raw ->
 * scores). Field names are the raw snake_case the Python engine emits; the import
 * route maps them to Prisma fields.
 */
export type ComputedMetricRow = {
  supplier_id: string;
  supplier_name: string;
  country: string;
  category: string;
  period: number;
  total_spend_usd: number;
  num_pos: number;
  avg_po_value_usd: number;
  avg_lead_time_days: number;
  avg_cycle_time_days: number;
  on_time_delivery_pct: number;
  three_way_match_pct: number;
  quality_score: number;
  delivery_score: number;
  process_score: number;
  risk_score: number;
  composite_score: number;
};

/**
 * Compute-from-raw: spawn python/import_compute.py, pipe the raw Suppliers +
 * Purchases rows in as JSON on stdin, and read the computed per-period
 * SupplierMetric rows back as JSON on stdout. Supplier identity is sourced from
 * the Suppliers rows (the separate SupplierMetrics sheet was dropped). Returns
 * `rows: null` with a non-zero `code` on any failure (Python error, timeout, or
 * unparseable output) so the caller can abort the import BEFORE any DB write.
 */
export function runImportCompute(
  payload: { suppliers: unknown[]; purchases: unknown[] },
  timeoutMs = 60000,
): Promise<{ code: number; rows: ComputedMetricRow[] | null; stderr: string }> {
  return new Promise((resolve) => {
    const root = process.cwd();
    const script = path.join(root, "python", "import_compute.py");
    const child = spawn(resolvePythonExecutable(), [script], {
      cwd: root,
      detached: false,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs) {
      timer = setTimeout(() => {
        stderr += `\n[python killed after ${timeoutMs}ms timeout]`;
        child.kill();
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, rows: null, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        resolve({ code: code ?? -1, rows: null, stderr });
        return;
      }
      try {
        resolve({ code: 0, rows: JSON.parse(stdout) as ComputedMetricRow[], stderr });
      } catch (e) {
        resolve({ code: -1, rows: null, stderr: `${stderr}\nJSON parse error: ${String(e)}` });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
