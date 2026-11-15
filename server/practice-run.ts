import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { Practice } from "../shared/practice.ts";
import { jsonBytes } from "../shared/cases.ts";
import { validatePracticeValue } from "../shared/practiceValues.ts";
import { PRACTICE_LOG_BYTES, PRACTICE_REQUEST_BYTES, PRACTICE_RESPONSE_BYTES, PRACTICE_RESULT_BYTES, type PracticeRequest, type PracticeRun } from "../shared/practiceRun.ts";
import { validatePractice } from "./practice.ts";
import { safeRel, HttpError } from "./util.ts";

export const HARNESS = "__stupen_practice";
const FILE_BYTES = 5_000_000;
const PACKAGE_BYTES = 40_000_000;
const fields = (v: unknown, required: string[], optional: string[] = []): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const require = (ok: unknown, message: string): void => { if (!ok) throw new HttpError(400, message); };

export function validatePracticeRequest(input: unknown, p: Practice): PracticeRequest {
  if (jsonBytes(input) > PRACTICE_REQUEST_BYTES) throw new HttpError(413, "Practice request exceeds 256 KiB.");
  require(fields(input, ["version", "cases"]), "Unexpected practice request fields.");
  const r = input as PracticeRequest;
  require(r.version === 1 && Array.isArray(r.cases) && r.cases.length >= 1 && r.cases.length <= 20, "Request 1–20 cases using version 1.");
  const ids = new Set<string>();
  for (const c of r.cases) {
    require(fields(c, ["id", "name", "inputs"], ["expected"]), "Unexpected case fields.");
    require(typeof c.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(c.id) && !ids.has(c.id), "Invalid or duplicate case ID.");
    ids.add(c.id);
    if (jsonBytes(c) > 32_768) throw new HttpError(413, "Practice case exceeds 32 KiB.");
    require(typeof c.name === "string" && c.name.trim() && c.name.length <= 80, "Invalid case name.");
    require(fields(c.inputs, p.inputs.map((i) => i.name)), "Inputs must match the lesson signature.");
    try {
      for (const i of p.inputs) validatePracticeValue(c.inputs[i.name], i.schema);
      if (Object.hasOwn(c, "expected")) validatePracticeValue(c.expected, p.output);
    } catch (e) { throw new HttpError(400, (e as Error).message); }
  }
  return r;
}

export function practiceFile(path: string): boolean {
  return safeRel(path) && !path.split("/").some((s) => s.startsWith(HARNESS) || ["node_modules", "vendor", "dist", "target", "tests", "test", "spec"].includes(s)) && !/(^|[./_-])(test|tests|spec)([./_-]|$)/i.test(path) && !/(^|\/)conftest\.py$/.test(path) && (/\.(ts|mts|js|mjs|json|py)$/.test(path));
}

/** The same explicit source allowlist is used before local execution and transport. */
export async function packPractice(dir: string, files: { path: string; role: string }[]): Promise<Record<string, string>> {
  const packed: Record<string, string> = {};
  let total = 0;
  for (const f of files) {
    if (f.path.split("/").some((s) => s.startsWith(HARNESS))) throw new HttpError(400, "Reserved practice harness file name.");
    if (!["starter", "support"].includes(f.role) || !practiceFile(f.path)) continue;
    let full = dir;
    for (const part of f.path.split("/")) {
      full = join(full, part);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new HttpError(400, "Practice source must not contain symlinks.");
    }
    const fd = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await fd.stat();
      if (!info.isFile()) throw new HttpError(400, "Practice source must be regular files.");
      if (info.size > FILE_BYTES) throw new HttpError(413, "Practice source file exceeds 5 MB.");
      const data = await fd.readFile();
      total += data.length;
      if (data.length > FILE_BYTES || total > PACKAGE_BYTES) throw new HttpError(413, "Practice source exceeds size limits.");
      packed[f.path] = data.toString("base64");
    } finally { await fd.close(); }
  }
  return packed;
}

/** Validate before base64 decoding or writing any runner scratch files. */
export function validatePracticePackage(input: unknown): { runtime: string; practice: Practice; request: PracticeRequest; files: Record<string, string> } {
  require(fields(input, ["runtime", "practice", "request", "files"]), "Unexpected runner practice fields.");
  const i = input as { runtime: string; practice: Practice; request: PracticeRequest; files: Record<string, string> };
  if (!["typescript", "javascript", "python"].includes(i.runtime)) throw new HttpError(422, "This practice runtime is not implemented.");
  require(fields(i.files, [], Object.keys(i.files ?? {})) && Object.keys(i.files).length <= 1000, "Invalid practice source package.");
  let total = 0;
  for (const [path, data] of Object.entries(i.files)) {
    require(practiceFile(path) && typeof data === "string" && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data), "Invalid practice source file.");
    const size = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    total += size;
    if (size > FILE_BYTES || total > PACKAGE_BYTES) throw new HttpError(413, "Practice source exceeds size limits.");
  }
  try { validatePractice(i.practice, i.runtime, Object.keys(i.files).map((path) => ({ path, role: "starter" }))); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
  validatePracticeRequest(i.request, i.practice);
  return i;
}

// JSON equality uses numeric equality, including -0, and ignores object key order.
export function practiceEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, n) => practiceEqual(v, b[n]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => Object.hasOwn(y, k) && practiceEqual(x[k], y[k]));
  }
  return a === b;
}

/** A remote response is untrusted too. Recompute comparisons at the app boundary. */
export function validatePracticeRun(input: unknown, p: Practice, request: PracticeRequest): PracticeRun {
  try {
    if (!fields(input, ["version", "sandboxed", "durationMs", "results"]) || input.version !== 1 || input.sandboxed !== true || !Number.isFinite(input.durationMs) || input.durationMs < 0 || !Array.isArray(input.results) || input.results.length !== request.cases.length || jsonBytes(input) > PRACTICE_RESPONSE_BYTES) throw new Error();
    let actualBytes = 0;
    for (const [n, r] of input.results.entries()) {
      const c = request.cases[n]!;
      if (!fields(r, ["id", "status", "stdout", "stderr", "durationMs", "outputTruncated"], ["actual"]) || r.id !== c.id || !["passed", "failed", "completed", "compile_error", "runtime_error", "timeout", "invalid_output", "skipped"].includes(r.status) || typeof r.stdout !== "string" || typeof r.stderr !== "string" || Buffer.byteLength(r.stdout + r.stderr) > PRACTICE_LOG_BYTES || typeof r.outputTruncated !== "boolean" || !Number.isFinite(r.durationMs) || r.durationMs < 0) throw new Error();
      if (["passed", "failed", "completed"].includes(r.status)) {
        validatePracticeValue(r.actual, p.output);
        actualBytes += jsonBytes(r.actual);
        if (jsonBytes(r.actual) > PRACTICE_RESULT_BYTES || actualBytes > 262_144) throw new Error();
        r.status = Object.hasOwn(c, "expected") ? (practiceEqual(r.actual, c.expected) ? "passed" : "failed") : "completed";
      } else if (Object.hasOwn(r, "actual")) throw new Error();
    }
    return input as PracticeRun;
  } catch { throw new HttpError(502, "The runner returned a malformed practice response."); }
}

/** Maintained harness: inputs travel as JSON data, never as source or shell text. */
export const jsHarness = `
import { readFileSync, writeFileSync } from 'node:fs';
const input = JSON.parse(readFileSync('./${HARNESS}_input.json', 'utf8'));
const result = './${HARNESS}_result.json';
const write = (value) => writeFileSync(result, JSON.stringify(value));
function plain(v, depth = 1) {
  if (depth > 8) throw Error('Output nesting exceeds 8');
  if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))) return v;
  if (Array.isArray(v) && v.length <= 1000) return Array.from(v, x => plain(x, depth + 1));
  if (v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).length <= 64) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, depth + 1)]));
  throw Error('Return a JSON-compatible value');
}
try {
  const module = await import(new URL('./' + input.entry.file, import.meta.url));
  const fn = module[input.entry.symbol];
  if (typeof fn !== 'function' || fn.constructor.name !== 'Function') throw Error('Entry must export a synchronous function');
  const actual = fn(...input.args);
  try {
    const data = JSON.stringify({ actual: plain(actual) });
    if (Buffer.byteLength(data) > ${PRACTICE_RESULT_BYTES}) throw Error('Output exceeds 64 KiB');
    writeFileSync(result, data);
  } catch { write({ invalid: true }); }
} catch (e) {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
}
`;
