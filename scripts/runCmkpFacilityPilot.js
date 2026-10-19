import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.join("scripts", "parse_cmkp_facility_pilot.py");
const bundledPython = process.env.USERPROFILE
  ? path.join(
      process.env.USERPROFILE,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "python.exe",
    )
  : null;
const candidates = [
  process.env.PYTHON ? [process.env.PYTHON, []] : null,
  ["python", []],
  ["python3", []],
  ["py", ["-3"]],
  bundledPython ? [bundledPython, []] : null,
].filter(Boolean);

for (const [command, prefixArgs] of candidates) {
  const result = spawnSync(command, [...prefixArgs, script], { stdio: "inherit" });
  if (["ENOENT", "EPERM"].includes(result.error?.code)) {
    continue;
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

throw new Error("Nie znaleziono interpretera Python. Ustaw zmienną PYTHON lub dodaj python do PATH.");
