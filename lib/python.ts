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

/**
 * Spawn the analysis compute script for a period. Never throws — resolves with
 * the exit code and captured output so callers can decide how to react.
 */
export function runComputeAnalyses(periodId: string): Promise<PythonResult> {
  return new Promise((resolve) => {
    const root = process.cwd();
    const script = path.join(root, "python", "compute_analyses.py");
    const child = spawn(
      resolvePythonExecutable(),
      [script, "--period-id", periodId],
      { cwd: root, detached: false, stdio: "pipe" },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
