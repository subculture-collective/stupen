import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { join, relative } from "node:path";

import { config } from "./config.ts";
import * as local from "./containers.ts";
import type { Environment } from "./environments.ts";
import { lessonCommands, runner } from "./runners.ts";
import * as sandbox from "./sandbox.ts";
import type { CheckResult, Checks } from "./sandbox.ts";
import { parsePracticeJson } from "../shared/practiceValues.ts";
import { runPractice } from "./practice-adapter.ts";
import { packPractice, validatePracticeRun } from "./practice-run.ts";
import { supportsPractice, type PracticeCapability, type PracticeRequest, type PracticeRun } from "../shared/practiceRun.ts";
import type { Practice } from "../shared/practice.ts";
import { HttpError } from "./util.ts";

/**
 * Where learner code runs. Without RUNNER_URL it runs on this machine
 * (bubblewrap and Docker). With RUNNER_URL every check, container build,
 * preview, page render and document parse goes to the runner agent
 * (server/agent.ts) in its own VM, which gets the lesson's files and nothing
 * else from this machine.
 */
export const remote = () => Boolean(config.runnerUrl);

const MAX_FILE = 5_000_000;
const MAX_TOTAL = 40_000_000;

/** A lesson folder's files, without .meta, .reference and .cache. */
async function pack(dir: string, overlay?: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let total = 0;
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      const rel = relative(dir, full);
      if (/^\.(reference|meta|cache)(\/|$)/.test(rel)) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const size = (await stat(full)).size;
        if (size > MAX_FILE) continue;
        total += size;
        if (total > MAX_TOTAL) throw new HttpError(413, "the lesson is larger than 40 MB");
        out[rel] = (await readFile(full)).toString("base64");
      }
    }
  };
  await walk(dir);
  for (const [rel, content] of Object.entries(overlay ?? {})) out[rel] = Buffer.from(content).toString("base64");
  return out;
}

/** POST to the runner agent. Calls can take as long as a dependency install, so there is no short timeout. */
function call<T>(op: string, body: unknown, timeoutMs = 2_400_000, maxResponse = Infinity, signal?: AbortSignal): Promise<T> {
  const url = new URL(`/v1/${op}`, config.runnerUrl);
  const data = Buffer.from(JSON.stringify(body));
  const deadline = op === "practice" ? AbortSignal.timeout(timeoutMs) : undefined;
  const requestSignal = deadline && signal ? AbortSignal.any([deadline, signal]) : deadline ?? signal;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { "content-type": "application/json", "content-length": data.length, authorization: `Bearer ${config.runnerToken}` }, timeout: timeoutMs, ...(requestSignal ? { signal: requestSignal } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxResponse) { res.destroy(); req.destroy(); reject(new HttpError(502, "Runner response exceeds size limits.")); }
          else chunks.push(c);
        });
        res.on("error", () => reject(new HttpError(503, "The runner connection ended unexpectedly.")));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: any;
          try {
            parsed = op === "practice" ? parsePracticeJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), maxResponse) : JSON.parse(text);
          } catch {
            return reject(new HttpError(502, `runner returned ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          if (op === "practice" && res.statusCode === 404) return reject(new HttpError(503, "This runner no longer supports practice. Ordinary checks remain available."));
          if ((res.statusCode ?? 500) >= 400) return reject(new HttpError(res.statusCode === 503 ? 503 : 502, `runner: ${parsed.error ?? res.statusCode}`));
          resolve(parsed as T);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("runner timed out")));
    req.on("error", (e) => reject(new HttpError(503, `The code runner is not reachable (${e.message}). Try again in a minute.`)));
    req.end(data);
  });
}

/** A stable cache name for a lesson's installed packages, without revealing the path to the runner. */
const cacheKey = (cacheDir: string) => createHash("sha256").update(cacheDir).digest("hex").slice(0, 32);

export async function quickChecks(dir: string, runnerId: string, customCommand?: string, overlay?: Record<string, string>): Promise<Checks> {
  if (!remote()) {
    const files = Object.keys(await pack(dir, overlay));
    return sandbox.runChecksIn(dir, lessonCommands(runner(runnerId), files, customCommand), overlay ? { overlay } : {});
  }
  return call<Checks>("quick", { files: await pack(dir, overlay), runner: runnerId, ...(customCommand ? { customCommand } : {}) });
}

export async function containerChecks(dir: string, cacheDir: string, env: Environment, opts: { overlay?: Record<string, string>; log?: (m: string) => void } = {}): Promise<Checks> {
  if (!remote()) return local.containerChecks(dir, cacheDir, env, opts);
  const r = await call<Checks & { log?: string[] }>("container", { files: await pack(dir, opts.overlay), cache: cacheKey(cacheDir), env });
  for (const m of r.log ?? []) opts.log?.(m);
  delete r.log;
  return r;
}

export async function containerPreview(dir: string, cacheDir: string, env: Environment): Promise<{ html?: string; result: CheckResult }> {
  if (!remote()) return local.containerPreview(dir, cacheDir, env);
  return call("preview", { files: await pack(dir), cache: cacheKey(cacheDir), env });
}

export async function renderPage(url: string): Promise<string> {
  if (!remote()) return local.renderPage(url);
  return (await call<{ html: string }>("render", { url }, 180_000)).html;
}

export async function sandboxed(files: Record<string, Buffer | string>, argv: string[], maxOutput?: number): Promise<CheckResult> {
  if (!remote()) return sandbox.sandboxed(files, argv, maxOutput);
  const enc = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString("base64")]));
  return call("sandboxed", { files: enc, argv, ...(maxOutput ? { maxOutput } : {}) }, 120_000);
}

type Status = {
  sandbox: { sandboxed: boolean; detail: string };
  runners: Record<string, { ok: boolean; detail?: string }>;
  docker: { ok: boolean; detail?: string };
  practice?: PracticeCapability | undefined;
};
let cached: { key: string; at: number; value: Status } | undefined;

/** What the code runner can do: sandbox, toolchains, Docker. Cached for a minute. */
export async function status(): Promise<Status> {
  const key = `${config.runnerUrl ?? "local"}:${config.runnerToken}`;
  if (cached?.key === key && Date.now() - cached.at < 60_000) return cached.value;
  const value: Status = remote()
    ? await call<Status>("status", {}, 20_000).catch((e) => ({
        sandbox: { sandboxed: false, detail: `The code runner is not reachable: ${(e as Error).message}` },
        runners: {},
        docker: { ok: false, detail: "The code runner is not reachable." },
      }))
    : { sandbox: await sandbox.sandboxStatus(), runners: await sandbox.runnerAvailability(), docker: await local.dockerAvailable(), practice: await sandbox.practiceCapability() };
  cached = { key, at: Date.now(), value };
  return value;
}

export const dockerAvailable = async () => (await status()).docker;


export async function practice(dir: string, runtime: string, metadata: Practice, files: { path: string; role: string }[], request: PracticeRequest, signal?: AbortSignal): Promise<PracticeRun> {
  if (!supportsPractice((await status()).practice, runtime)) throw new HttpError(503, "This runner does not support practice for this runtime. Ordinary checks remain available.");
  const input = { runtime, practice: metadata, request, files: await packPractice(dir, files) };
  const result = remote() ? await call<unknown>("practice", input, 70_000, 524_288, signal) : await runPractice(input, signal);
  return validatePracticeRun(result, metadata, request);
}
