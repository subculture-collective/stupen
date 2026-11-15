import { constants } from "node:fs";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PracticeResult, PracticeRun } from "../shared/practiceRun.ts";
import { supportsPractice, PRACTICE_RESULT_BYTES } from "../shared/practiceRun.ts";
import { jsonBytes } from "../shared/cases.ts";
import { parsePracticeJson, validatePracticeValue } from "../shared/practiceValues.ts";
import { config } from "./config.ts";
import { HARNESS, jsHarness, practiceEqual, validatePracticePackage, validatePracticeRun } from "./practice-run.ts";
import { practiceCapability, practiceProcess, type PracticeProcess } from "./sandbox.ts";
import { HttpError } from "./util.ts";

export async function runPractice(input: unknown, signal?: AbortSignal): Promise<PracticeRun> {
  const i = validatePracticePackage(input);
  if (!supportsPractice(await practiceCapability(), i.runtime)) throw new HttpError(503, "Practice needs Node 24 and a working bubblewrap sandbox.");
  const started = Date.now(), deadline = started + 60_000;
  const base = await mkdtemp(join(tmpdir(), "stupen-practice-"));
  const results: PracticeResult[] = [];
  let logBudget = 196_608, resultBudget = 262_144;
  const populate = async (dir: string) => {
    await mkdir(dir);
    for (const [path, data] of Object.entries(i.files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), Buffer.from(data, "base64"));
    }
  };
  const result = (id: string, status: PracticeResult["status"], proc?: PracticeProcess): PracticeResult => ({ id, status, stdout: proc?.stdout ?? "", stderr: proc?.stderr ?? "", durationMs: proc?.durationMs ?? 0, outputTruncated: proc?.outputTruncated ?? false });
  try {
    const compileDir = join(base, "compile");
    await populate(compileDir);
    const sources = Object.keys(i.files).filter((f) => /\.(ts|mts|js|mjs)$/.test(f)).map((f) => `./${f}`);
    const compileDeadline = Math.min(deadline, Date.now() + 20_000);
    let build: PracticeProcess | undefined;
    if (i.runtime === "typescript") {
      build = await practiceProcess(compileDir, [join(config.appDir, "node_modules/.bin/tsc"), "--noEmit", "--strict", "--target", "ES2023", "--module", "nodenext", "--moduleResolution", "nodenext", "--allowImportingTsExtensions", "--erasableSyntaxOnly", "--noUncheckedIndexedAccess", "--skipLibCheck", "--types", "node", "--typeRoots", join(config.appDir, "node_modules/@types"), ...sources.filter((f) => /\.(ts|mts)$/.test(f))], compileDeadline - Date.now(), 16_384, signal);
    } else {
      for (const source of sources) {
        build = await practiceProcess(compileDir, ["node", "--check", source], compileDeadline - Date.now(), 16_384, signal);
        if (build.exitCode !== 0 || build.timedOut || Date.now() >= compileDeadline) break;
      }
    }
    if (!build || build.exitCode !== 0 || build.timedOut) {
      const cap = Math.floor(196_608 / i.request.cases.length / 12);
      const clip = (text: string) => Buffer.from(text).subarray(0, cap).toString("utf8").replace(/\uFFFD/g, "");
      if (build) build = { ...build, stdout: clip(build.stdout), stderr: clip(build.stderr), outputTruncated: build.outputTruncated || Buffer.byteLength(build.stdout + build.stderr) > cap };
      for (const c of i.request.cases) results.push(result(c.id, "compile_error", build));
    } else {
      // Compilation cannot change the files subsequently executed in each fresh case.
      for (const [n, c] of i.request.cases.entries()) {
        signal?.throwIfAborted();
        if (Date.now() >= deadline || logBudget <= 0 || resultBudget <= 0) { results.push(result(c.id, "skipped")); continue; }
        const work = join(base, `case-${n}`);
        await populate(work);
        try {
          await writeFile(join(work, `${HARNESS}.mjs`), jsHarness);
          await writeFile(join(work, `${HARNESS}_input.json`), JSON.stringify({ entry: i.practice.entry, args: i.practice.inputs.map((f) => c.inputs[f.name]) }));
          const proc = await practiceProcess(work, ["node", `${HARNESS}.mjs`], Math.min(2000, deadline - Date.now()), Math.min(16_384, Math.floor(logBudget / 6)), signal);
          logBudget -= jsonBytes(proc.stdout) + jsonBytes(proc.stderr);
          const r = result(c.id, proc.timedOut ? "timeout" : proc.exitCode !== 0 ? "runtime_error" : "invalid_output", proc);
          if (!proc.timedOut && proc.exitCode === 0) {
            try {
              const fd = await open(join(work, `${HARNESS}_result.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              let text: string;
              try {
                const info = await fd.stat();
                if (!info.isFile() || info.size > PRACTICE_RESULT_BYTES || info.size > resultBudget) throw new Error("Invalid output file");
                const buffer = Buffer.alloc(Math.min(PRACTICE_RESULT_BYTES, resultBudget) + 1);
                const { bytesRead } = await fd.read(buffer);
                if (bytesRead > PRACTICE_RESULT_BYTES || bytesRead > resultBudget) throw new Error("Oversized output");
                text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
              } finally { await fd.close(); }
              const envelope = parsePracticeJson(text, PRACTICE_RESULT_BYTES) as { actual?: unknown };
              if (!envelope || Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, "actual")) throw new Error("Missing output");
              validatePracticeValue(envelope.actual, i.practice.output);
              r.actual = envelope.actual as import("../shared/practice.ts").PracticeValue;
              resultBudget -= jsonBytes(r.actual);
              r.status = Object.hasOwn(c, "expected") ? (practiceEqual(r.actual, c.expected) ? "passed" : "failed") : "completed";
            } catch { /* Invalid or missing output is a case result, never a pass. */ }
          }
          results.push(r);
        } finally { await rm(work, { recursive: true, force: true }); }
      }
    }
    return validatePracticeRun({ version: 1, sandboxed: true, durationMs: Date.now() - started, results }, i.practice, i.request);
  } finally { await rm(base, { recursive: true, force: true }); }
}
