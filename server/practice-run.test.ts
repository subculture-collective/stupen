import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Practice } from "../shared/practice.ts";
import { supportsPractice } from "../shared/practiceRun.ts";
import { config } from "./config.ts";
import { runPractice } from "./practice-adapter.ts";
import { GO_TYPES, goSchemaTypes } from "./practice-go.ts";
import { packPractice, practiceEqual, validatePracticePackage, validatePracticeRequest, validatePracticeRun } from "./practice-run.ts";
import { practiceLesson } from "./practice-service.ts";
import { goPracticeVersion, practiceCapability } from "./sandbox.ts";
import { createTrack, getLesson, lessonDir, writeLesson, type LessonMeta } from "./store.ts";

const sample = (runtime = "typescript"): Practice => ({ version: 1, entry: { file: runtime === "typescript" ? "solution.ts" : runtime === "python" ? "solution.py" : runtime === "go" ? "solution.go" : "solution.mjs", symbol: runtime === "go" ? "Double" : "double" }, inputs: [{ name: "n", schema: { type: "integer" } }], output: { type: "integer" }, cases: [{ id: "sample-1", name: "Double", inputs: { n: 2 }, expected: 4 }] });
const payload = (code: string, runtime = "javascript") => { const p = sample(runtime); return { runtime, practice: p, request: { version: 1 as const, cases: p.cases }, files: { [p.entry.file]: Buffer.from(code).toString("base64") } }; };

test("practice validates closed inputs and packages before execution", () => {
  const p = sample();
  for (const input of [{ version: 2, cases: p.cases }, { version: 1, cases: [] }, { version: 1, cases: [...p.cases, ...p.cases] }, { version: 1, cases: [{ ...p.cases[0], inputs: { n: "2" } }] }, { version: 1, cases: p.cases, command: "node" }]) assert.throws(() => validatePracticeRequest(input, p), { status: 400 });
  const i = payload("export function double(n) { return n * 2; }");
  for (const path of ["../escape.mjs", ".reference/solution.mjs", ".meta/x.json", "nested/.cache/x.json", "solution.test.mjs", "tests/x.mjs", "__stupen_practice.mjs"]) assert.throws(() => validatePracticePackage({ ...i, files: { ...i.files, [path]: "" } }));
  assert.throws(() => validatePracticePackage({ ...i, files: { "solution.mjs": "a".repeat(6_666_672) } }), { status: 413 });
  assert.throws(() => validatePracticePackage({ ...i, runtime: "rust" }), { status: 422 });
  assert.equal(goPracticeVersion("go version go1.23.9 linux/amd64"), false);
  assert.equal(goPracticeVersion("go version go1.24.13 linux/amd64"), true);
  assert.equal(supportsPractice(undefined, "typescript"), false);
  assert.equal(supportsPractice({ version: 1, runtimes: ["typescript", 2] }, "typescript"), false);
  assert.equal(supportsPractice({ version: 1, runtimes: ["typescript"] }, "typescript"), true);
});

test("source snapshots exclude tests, hidden data and symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stupen-pack-"));
  try {
    await mkdir(join(dir, "src"));
    for (const path of ["src/solution.mjs", "solution.test.mjs", "support.json"]) await writeFile(join(dir, path), "content");
    const packed = await packPractice(dir, [{ path: "src/solution.mjs", role: "starter" }, { path: "solution.test.mjs", role: "test" }, { path: "support.json", role: "support" }, { path: ".reference/solution.mjs", role: "support" }]);
    assert.deepEqual(Object.keys(packed), ["src/solution.mjs", "support.json"]);
    await symlink(join(dir, "src/solution.mjs"), join(dir, "link.mjs"));
    await assert.rejects(packPractice(dir, [{ path: "link.mjs", role: "starter" }]), /symlinks/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("responses recompute comparisons, preserve ungraded completion and reject malformed output", () => {
  assert.equal(practiceEqual({ a: [-0], b: false }, { b: false, a: [0] }), true);
  assert.equal(practiceEqual([1, 2], [2, 1]), false);
  const p = sample(), request = { version: 1 as const, cases: p.cases };
  const r = { version: 1, sandboxed: true, durationMs: 1, results: [{ id: "sample-1", status: "passed", actual: 5, stdout: "", stderr: "", durationMs: 1, outputTruncated: false }] };
  assert.equal(validatePracticeRun(r, p, request).results[0]!.status, "failed");
  delete p.cases[0]!.expected;
  assert.equal(validatePracticeRun(r, p, request).results[0]!.status, "completed");
  assert.throws(() => validatePracticeRun({ ...r, sandboxed: false }, p, request), { status: 502 });
  assert.throws(() => validatePracticeRun({ ...r, results: [{ ...r.results[0], actual: "bad" }] }, p, request), { status: 502 });
});

test("real sandbox: TS/JS success, errors, bounds, isolation and cleanup", { timeout: 90_000 }, async (t) => {
  const cap = await practiceCapability();
  if (!cap) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required real sandbox integration is unavailable");
    t.skip("Real bubblewrap/Node 24 unavailable; run the required disposable fixture integration before release.");
    return;
  }
  const baseline = (await readdir(tmpdir())).filter((n) => n.startsWith("stupen-practice-"));
  const run = async (code: string, runtime = "javascript") => (await runPractice(payload(code, runtime))).results[0]!;
  for (const runtime of ["typescript", "javascript"]) {
    const annotation = runtime === "typescript" ? ": number" : "";
    assert.equal((await run(`export function double(n${annotation}) { return n * 2; }`, runtime)).status, "passed");
  }
  assert.equal((await run("export function double( { broken")).status, "compile_error");
  assert.equal((await run("export function double(n: number): number { return 'bad'; }", "typescript")).status, "compile_error");
  assert.equal((await run("export function double() { throw Error('fixture exception'); }")).status, "runtime_error");
  assert.equal((await run("export function double() { while(true) {} }")).status, "timeout");
  for (const value of ["undefined", "NaN", "Infinity", "BigInt(1)", "'wrong'", "Promise.resolve(4)", "new Date()"] ) assert.equal((await run(`export function double() { return ${value}; }`)).status, "invalid_output");
  const flood = await run("export function double() { while(true) console.log('x'.repeat(65536)); }");
  assert.equal(flood.outputTruncated, true);
  assert.ok(Buffer.byteLength(flood.stdout + flood.stderr) <= 16_384);
  const i = payload(`import { existsSync, writeFileSync } from 'node:fs'; import { networkInterfaces } from 'node:os';
export function double(n) {
 if (existsSync('./sentinel')) throw Error('state leaked');
 if (existsSync('.reference') || existsSync('.meta') || existsSync('.cache') || existsSync('solution.test.mjs') || existsSync('/etc/passwd') || existsSync('/workspace/server') || process.env.FIXTURE_PRIVATE_KEY || Object.keys(networkInterfaces()).some(k => k !== 'lo')) throw Error('isolation failed');
 writeFileSync('./sentinel', 'case write'); return n * 2;
}`);
  i.request.cases = [...i.request.cases, { ...i.request.cases[0]!, id: "sample-2" }];
  process.env.FIXTURE_PRIVATE_KEY = "synthetic-fixture-only";
  try { assert.deepEqual((await runPractice(i)).results.map((r) => r.status), ["passed", "passed"]); }
  finally { delete process.env.FIXTURE_PRIVATE_KEY; }
  for (const statement of [
    "process.exit(0)",
    "writeFileSync('__stupen_practice_result.json', Buffer.from([0x7b,0x22,0x61,0x63,0x74,0x75,0x61,0x6c,0x22,0x3a,0x22,0xff,0x22,0x7d])); process.exit(0)",
    "writeFileSync('__stupen_practice_result.json', 'x'.repeat(65537)); process.exit(0)",
    "symlinkSync('/etc/passwd', '__stupen_practice_result.json'); process.exit(0)",
    `writeFileSync('__stupen_practice_result.json', '{"actual":4,"actual":4}'); process.exit(0)`,
  ]) assert.equal((await run(`import { writeFileSync, symlinkSync } from 'node:fs'; export function double() { ${statement}; }`)).status, "invalid_output");
  const badUtf8 = payload("import { writeFileSync } from 'node:fs'; export function double() { writeFileSync('__stupen_practice_result.json', Buffer.from([123,34,97,99,116,117,97,108,34,58,34,255,34,125])); process.exit(0); }");
  badUtf8.practice.output = { type: "string" };
  badUtf8.practice.cases[0]!.expected = "valid";
  assert.equal((await runPractice(badUtf8)).results[0]!.status, "invalid_output", "invalid UTF-8 cannot become a valid replacement-character string");
  const raw = payload("export function double() { return 4; }");
  delete raw.request.cases[0]!.expected;
  assert.equal((await runPractice(raw)).results[0]!.status, "completed");
  const abort = new AbortController();
  const aborted = runPractice(payload("export function double() { while(true) {} }"), abort.signal);
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(aborted);
  assert.deepEqual((await readdir(tmpdir())).filter((n) => n.startsWith("stupen-practice-")), baseline, "scratch is removed after completion, errors, timeouts and cancellation");
});

async function fixtureLesson(runtime = "javascript") {
  const track = await createTrack("owner", { title: "Practice run", subject: "Functions", runner: runtime });
  const p = sample(runtime);
  const meta: LessonMeta = { id: "01-double", title: "Double", objective: "Double", brief: "", hints: [], sources: [], files: [{ path: p.entry.file, role: "starter" }, { path: "solution.test.mjs", role: "test" }], createdAt: "", status: "passed", attempts: 7, verified: true, practice: p, failStreak: 3, passedAt: "prior", lastChecks: { at: "prior", passed: true, sandboxed: true, results: [] } };
  await writeLesson("owner", track.id, meta, [{ path: p.entry.file, content: runtime === "go" ? "package lesson\nfunc Double(n int64) int64 { return n * 2 }" : runtime === "python" ? "def double(n): return n * 2" : "export function double(n) { return n * 2; }" }, { path: "solution.test.mjs", content: "CANONICAL TEST SENTINEL" }], [{ path: p.entry.file, content: "PROTECTED REFERENCE SENTINEL" }]);
  return { track, meta, p };
}

test("RUNNER_URL transport: auth, capability refusal, malformed responses, concurrency and no progress writes", { timeout: 20_000 }, async () => {
  const prior = { dataDir: config.dataDir, runnerUrl: config.runnerUrl, runnerToken: config.runnerToken };
  const dir = await mkdtemp(join(tmpdir(), "stupen-run-service-"));
  config.dataDir = dir;
  let mode = "old", runs = 0, release: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer fixture-token");
    let text = ""; for await (const c of req) text += c;
    const i = JSON.parse(text);
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/status") return res.end(JSON.stringify({ sandbox: { sandboxed: true }, runners: {}, docker: {}, ...(mode === "old" ? {} : { practice: { version: 1, runtimes: ["javascript"] } }) }));
    runs++;
    assert.equal(req.url, "/v1/practice");
    assert.deepEqual(Object.keys(i.files), ["solution.mjs"]);
    if (mode === "duplicate") return res.end('{"version":1,"version":1,"sandboxed":true,"durationMs":1,"results":[{"id":"sample-1","status":"passed","actual":4,"stdout":"","stderr":"","durationMs":1,"outputTruncated":false}]}');
    if (mode === "oversized") return res.end(" ".repeat(524_289));
    await new Promise<void>((resolve) => { release = resolve; });
    res.end(JSON.stringify({ malformed: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  config.runnerUrl = url; config.runnerToken = "fixture-token";
  try {
    const { track, meta, p } = await fixtureLesson();
    const request = { version: 1, cases: p.cases };
    await assert.rejects(practiceLesson("intruder", track.id, meta.id, request), { status: 404 });
    await assert.rejects(practiceLesson("owner", track.id, meta.id, request), { status: 503 });
    assert.equal(runs, 0, "old agent cannot receive code or trigger a local fallback");
    // A new runner URL must not reuse another runner's cached capability.
    mode = "new";
    config.runnerUrl = `${url}/new-agent`;
    const pending = practiceLesson("owner", track.id, meta.id, request);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(practiceLesson("owner", track.id, meta.id, request), { status: 429 });
    release();
    await assert.rejects(pending, { status: 502 });
    for (const invalid of ["duplicate", "oversized"]) {
      mode = invalid;
      await assert.rejects(practiceLesson("owner", track.id, meta.id, request), { status: 502 });
    }
    assert.deepEqual(await getLesson("owner", track.id, meta.id), meta);
    assert.equal(await readFile(join(lessonDir("owner", track.id, meta.id), "solution.test.mjs"), "utf8"), "CANONICAL TEST SENTINEL");
  } finally { Object.assign(config, prior); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

// An actual child agent proves that RUNNER_URL uses the same sandbox adapter.
test("real RUNNER_URL agent executes authenticated practice with sandbox isolation", { timeout: 60_000 }, async (t) => {
  if (!(await practiceCapability())) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required real agent integration is unavailable");
    t.skip("Real sandbox unavailable; remote integration must pass in disposable fixture."); return;
  }
  const prior = { dataDir: config.dataDir, runnerUrl: config.runnerUrl, runnerToken: config.runnerToken };
  const dir = await mkdtemp(join(tmpdir(), "stupen-agent-fixture-"));
  const portServer = createServer(); await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const token = "synthetic-runner-token-for-fixtures-only";
  const child = spawn(process.execPath, ["server/agent.ts"], { cwd: config.appDir, env: { PATH: process.env.PATH!, HOME: process.env.HOME!, AGENT_HOST: "127.0.0.1", AGENT_PORT: String(port), RUNNER_TOKEN: token, STUDY_DATA_DIR: join(dir, "agent"), STUDY_TOOLS_DIR: config.toolsDir } });
  child.stderr.resume();
  config.dataDir = join(dir, "app"); config.runnerUrl = `http://127.0.0.1:${port}`; config.runnerToken = token;
  try {
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", () => reject(Error("agent exited"))); child.stdout.on("data", (b) => { if (b.toString().includes("runner agent on")) resolve(); }); });
    assert.equal((await fetch(`${config.runnerUrl}/v1/practice`, { method: "POST", body: "{}" })).status, 401);
    const { track, meta, p } = await fixtureLesson();
    const result = await practiceLesson("owner", track.id, meta.id, { version: 1, cases: p.cases });
    assert.equal(result.sandboxed, true); assert.equal(result.results[0]!.status, "passed");
    assert.deepEqual(await getLesson("owner", track.id, meta.id), meta);
    if (supportsPractice(await practiceCapability(), "python")) {
      const py = await fixtureLesson("python");
      assert.equal((await practiceLesson("owner", py.track.id, py.meta.id, { version: 1, cases: py.p.cases })).results[0]!.status, "passed");
      assert.deepEqual(await getLesson("owner", py.track.id, py.meta.id), py.meta);
    } else assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Python agent integration unavailable");
    if (supportsPractice(await practiceCapability(), "go")) {
      const go = await fixtureLesson("go");
      const result = await practiceLesson("owner", go.track.id, go.meta.id, { version: 1, cases: go.p.cases });
      assert.equal(result.results[0]!.status, "passed", result.results[0]!.stderr);
      assert.deepEqual(await getLesson("owner", go.track.id, go.meta.id), go.meta);
    } else assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Go agent integration unavailable");
  } finally { child.kill("SIGTERM"); await once(child, "exit"); Object.assign(config, prior); await rm(dir, { recursive: true, force: true }); }
});


test("real Python cases: encoding, comparison, syntax, errors, timeout and isolated state", { timeout: 30_000 }, async (t) => {
  if (!supportsPractice(await practiceCapability(), "python")) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required Python integration unavailable");
    t.skip("Python sandbox unavailable"); return;
  }
  const run = async (code: string) => (await runPractice(payload(code, "python"))).results[0]!;
  assert.equal((await run("def double(n): return n * 2")).status, "passed");
  assert.equal((await run("def double(n): return n")).status, "failed");
  assert.equal((await run("def double(n) return n")).status, "compile_error");
  assert.equal((await run("return 1")).status, "compile_error");
  const thrown = await run("def double(n): raise ValueError('fixture')");
  assert.equal(thrown.status, "runtime_error"); assert.match(thrown.stderr, /solution.py/);
  assert.equal((await run("def double(n):\n while True: pass")).status, "timeout");
  const invalid = await run("def double(n): return set([n])");
  assert.equal(invalid.status, "invalid_output"); assert.match(invalid.stderr, /JSON-compatible/);
  const i = payload("def double(n): return n * 2", "python"); delete i.request.cases[0]!.expected;
  assert.equal((await runPractice(i)).results[0]!.status, "completed");
  i.practice.inputs = [{ name: "n", schema: { type: "string" } }]; i.practice.output = { type: "string" };
  i.practice.cases = [{ id: "sample-1", name: "String", inputs: { n: "é" } }];
  i.request.cases = [{ id: "custom-1", name: "Encoding", inputs: { n: 'é\n\\"; __import__("os").system("false")' } }];
  assert.equal((await runPractice(i)).results[0]!.actual, String(i.request.cases[0]!.inputs.n).repeat(2));
  const isolated = payload("import os,pathlib\ndef double(n):\n assert not pathlib.Path('sentinel').exists()\n assert not any(pathlib.Path(p).exists() for p in ['.reference','.meta','.cache','solution.test.mjs','/etc/passwd'])\n assert 'FIXTURE_PRIVATE_KEY' not in os.environ\n pathlib.Path('sentinel').write_text('case')\n return n * 2", "python");
  isolated.request.cases.push({ ...isolated.request.cases[0]!, id: "sample-2" });
  assert.deepEqual((await runPractice(isolated)).results.map(r => r.status), ["passed", "passed"]);
});


test("real Python nested relative imports and UTF-8 output bounds", { timeout: 10_000 }, async (t) => {
  if (!supportsPractice(await practiceCapability(), "python")) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required Python integration unavailable");
    t.skip("Python sandbox unavailable"); return;
  }
  const nested = payload("from .helper import twice\ndef double(n): return twice(n)", "python");
  nested.practice.entry.file = "src/solution.py";
  nested.files = { "src/solution.py": nested.files["solution.py"]!, "src/helper.py": Buffer.from("def twice(n): return n * 2").toString("base64"), "src/__init__.py": "" };
  assert.equal((await runPractice(nested)).results[0]!.status, "passed");
  const unicode = payload("def double(n): return [chr(233) * 4096] * 4", "python");
  unicode.practice.output = { type: "array", items: { type: "string" } };
  delete unicode.practice.cases[0]!.expected;
  assert.equal((await runPractice(unicode)).results[0]!.status, "completed");
});


test("real Go practice: compile once, fresh cases, errors, comparison and schema types", { timeout: 180_000 }, async (t) => {
  if (!supportsPractice(await practiceCapability(), "go")) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required Go integration unavailable");
    t.skip("Go sandbox unavailable"); return;
  }
  const run = async (body: string) => (await runPractice(payload(`package lesson\n${body}`, "go"))).results[0]!;
  const success = await run("func Double(n int64) int64 { return n * 2 }");
  assert.equal(success.status, "passed", success.stderr);
  assert.equal((await run("func Double(n int64) int64 { return n }")).status, "failed");
  assert.equal((await run("func Double(n int64) int64 { return missing }")).status, "compile_error");
  assert.equal((await run("func Double(n int64) int64 { panic(\"fixture\") }")).status, "runtime_error");
  assert.equal((await run("func Double(n int64) int64 { for {} }")).status, "timeout");
  const i = payload('package lesson\nimport "os"\nfunc Double(n int64) int64 { if _, err := os.Stat("sentinel"); err == nil { panic("state leaked") }; for _, p := range []string{".reference", ".meta", ".cache", "solution_test.go", "/etc/passwd"} { if _, err := os.Stat(p); err == nil { panic("private file") } }; if err := os.WriteFile("sentinel", []byte("case"), 0600); err != nil { panic(err) }; return n * 2 }', "go");
  delete i.request.cases[0]!.expected;
  i.request.cases.push({ ...i.request.cases[0]!, id: "sample-2" });
  assert.deepEqual((await runPractice(i)).results.map(r => r.status), ["completed", "completed"]);
  const object = payload('package lesson\nfunc Double(n StupenPracticeInput0) StupenPracticeOutput { return StupenPracticeOutput{Field0:n.Field0, Field1:n.Field1} }', "go");
  const schema = { type: "object" as const, properties: { "": { type: "string" as const }, "a,b": { type: "array" as const, items: { type: "integer" as const } } }, required: ["", "a,b"] };
  object.practice.inputs = [{ name: "n", schema }]; object.practice.output = schema;
  object.practice.cases = [{ id: "sample-1", name: "Object", inputs: { n: { "": "é\n\\\"", "a,b": [0, 2] } }, expected: { "": "é\n\\\"", "a,b": [0, 2] } }];
  object.request.cases = object.practice.cases;
  const encoded = (await runPractice(object)).results[0]!;
  assert.equal(encoded.status, "passed", encoded.stderr);
  assert.match(goSchemaTypes(object.practice), /StupenPracticeInput0/);
  assert.equal(GO_TYPES, "stupen_practice_types.go");
});


test("real Go output budget counts JSON values rather than Go escape expansion", { timeout: 60_000 }, async (t) => {
  if (!supportsPractice(await practiceCapability(), "go")) {
    assert.notEqual(process.env.PRACTICE_INTEGRATION, "1", "Required Go integration unavailable");
    t.skip("Go sandbox unavailable"); return;
  }
  const i = payload('package lesson\nimport "strings"\nfunc Double(n int64) []string { s := strings.Repeat("<", 8192); return []string{s,s,s,s, `literal\\u2028`} }', "go");
  i.practice.output = { type: "array", items: { type: "string" } }; delete i.request.cases[0]!.expected;
  const result = (await runPractice(i)).results[0]!;
  assert.equal(result.status, "completed", result.stderr);
  assert.equal((result.actual as string[])[4], 'literal\\u2028');
  i.files["solution.go"] = Buffer.from('package lesson\nimport "strings"\nfunc Double(n int64) []string { s := strings.Repeat("\\u2028", 2730); return []string{s,s,s,s} }').toString("base64");
  assert.equal((await runPractice(i)).results[0]!.status, "completed");
});


test("Go snapshots regenerate schema support without changing canonical files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stupen-go-source-"));
  try {
    await writeFile(join(dir, GO_TYPES), "CANONICAL SCHEMA TYPES");
    await writeFile(join(dir, "solution.go"), "package lesson");
    await writeFile(join(dir, "solution_test.go"), "CANONICAL TESTS");
    await writeFile(join(dir, "go.mod"), "module lesson\ngo 1.24\n");
    const files = await packPractice(dir, [{ path: GO_TYPES, role: "support" }, { path: "solution.go", role: "starter" }, { path: "solution_test.go", role: "test" }, { path: "go.mod", role: "support" }]);
    assert.deepEqual(Object.keys(files), ["solution.go", "go.mod"]);
    assert.equal(await readFile(join(dir, GO_TYPES), "utf8"), "CANONICAL SCHEMA TYPES");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
