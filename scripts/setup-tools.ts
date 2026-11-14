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
if (!existsSync(join(venv, "bin/python"))) execFileSync("uv", ["venv", "--python", python, venv], { stdio: "inherit" });
execFileSync("uv", ["pip", "install", "--python", join(venv, "bin/python"), "pytest"], { stdio: "inherit" });
console.log(`pytest ready in ${venv}`);
