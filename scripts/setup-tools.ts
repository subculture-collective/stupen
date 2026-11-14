/**
 * One-time setup for sandboxed checks: a Python virtual environment with
 * pytest, built on the system Python so it works with the home folder hidden.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { config } from "../server/config.ts";

const venv = join(config.toolsDir, "py");
const python = ["/usr/bin/python3", "/usr/local/bin/python3"].find((p) => existsSync(p));
if (!python) throw new Error("no system python3 in /usr/bin or /usr/local/bin");
// uv when it is installed; otherwise the standard venv and pip (the runner VM).
let uv = true;
try {
  execFileSync("uv", ["--version"], { stdio: "ignore" });
} catch {
  uv = false;
}
if (!existsSync(join(venv, "bin/python"))) execFileSync(uv ? "uv" : python, uv ? ["venv", "--python", python, venv] : ["-m", "venv", venv], { stdio: "inherit" });
execFileSync(uv ? "uv" : join(venv, "bin/python"), uv ? ["pip", "install", "--python", join(venv, "bin/python"), "pytest"] : ["-m", "pip", "install", "-q", "pytest"], { stdio: "inherit" });
console.log(`pytest ready in ${venv}`);
