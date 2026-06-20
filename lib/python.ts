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

function runScript(args: string[], timeoutMs?: number): Promise<PythonResult> {
  return new Promise((resolve) => {
    const root = process.cwd();
    const script = path.join(root, "python", "compute_analyses.py");
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

/** Mode A: compute + upsert AnalysisResult rows for a single period. */
export function runComputeAnalyses(periodId: string): Promise<PythonResult> {
  return runScript(["--period-id", periodId]);
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
 * Mode B with a custom cycle-time period comparison. Loads purchases over the
 * union of both windows (so both comparison groups are present) and passes the
 * four --comparison-* overrides. The caller reads cycle_time.period_comparison
 * from the stdout JSON. No DB writes (Mode B); not cached.
 */
export function runCycleCompare(
  bounds: {
    startA: string;
    endA: string;
    startB: string;
    endB: string;
  },
  timeoutMs = 30000,
): Promise<PythonResult> {
  const loadStart = [bounds.startA, bounds.startB].sort()[0];
  const loadEnd = [bounds.endA, bounds.endB].sort()[1];
  return runScript(
    [
      "--start-date",
      loadStart,
      "--end-date",
      loadEnd,
      "--comparison-start-a",
      bounds.startA,
      "--comparison-end-a",
      bounds.endA,
      "--comparison-start-b",
      bounds.startB,
      "--comparison-end-b",
      bounds.endB,
    ],
    timeoutMs,
  );
}
