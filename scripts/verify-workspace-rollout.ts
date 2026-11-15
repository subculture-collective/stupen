/** Authorized live smoke: creates/deletes only its own disposable account/data.
 * Run from the release: ROLLOUT_SMOKE=1 node --env-file=<private app env> scripts/verify-workspace-rollout.ts
 * Never print sessions, environment values, connection data or learner content.
 */
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { config } from "../server/config.ts";
import { database } from "../server/db.ts";
import { deleteAccountRows, startSession } from "../server/auth.ts";
import { createTrack, getLesson, lessonDir, userDir, writeLesson, type LessonMeta } from "../server/store.ts";
import { newId } from "../server/util.ts";
import { status } from "../server/exec.ts";
import type { Practice } from "../shared/practice.ts";

assert.equal(process.env.ROLLOUT_SMOKE, "1", "Set ROLLOUT_SMOKE=1 only for an authorized disposable-account smoke.");
assert.equal(config.authMode, "accounts");
assert.ok(config.runnerUrl, "Live smoke requires RUNNER_URL; no local execution fallback.");
const runner = await status();
assert.equal(runner.sandbox.sandboxed, true);
assert.equal(runner.practice?.version, 1);
for (const lang of ["typescript", "javascript", "python", "go"]) assert.ok(runner.practice?.runtimes.includes(lang), `${lang} practice capability missing`);
console.log("PASS: remote runner advertises sandboxed TS/JS, Python and Go practice v1");

const user = newId("rollout-");
const email = `${user}@example.invalid`;
const db = database();
db.prepare("INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(user, email, "Disposable rollout smoke", Date.now());
const cookie = startSession(user, "email", { headers: { "user-agent": "Stupen rollout verification" }, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage).split(";")[0]!;
const origin = config.publicOrigin + config.basePath;
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${origin}/api${path}`, { method, headers: { cookie, "x-study-coach": "1", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180_000) });
  assert.equal(res.status, 200, `${method} ${path}: HTTP ${res.status}`);
  return res.json() as Promise<any>;
}
const variants = [
  { runtime: "typescript", entry: "solution.ts", symbol: "double", source: "export function double(n: number) { return n * 2; }", test: "solution.test.ts", testSource: 'import { test } from "node:test"; import assert from "node:assert/strict"; import { double } from "./solution.ts"; test("canonical double", () => assert.equal(double(2), 4));' },
  { runtime: "python", entry: "solution.py", symbol: "double", source: "def double(n):\n    return n * 2\n", test: "test_solution.py", testSource: "from solution import double\ndef test_double():\n    assert double(2) == 4\n" },
  { runtime: "go", entry: "solution.go", symbol: "Double", source: "package lesson\nfunc Double(n int64) int64 { return n * 2 }\n", test: "solution_test.go", testSource: 'package lesson\nimport "testing"\nfunc TestDouble(t *testing.T) { if Double(2) != 4 { t.Fatal("canonical mismatch") } }\n' },
];
try {
  const me = await api("/me");
  assert.equal(me.user, email);
  const models = await api("/models");
  assert.equal(models.choices.some((c: any) => ["claude", "codex"].includes(c.id)), false, "disposable account cannot use owner subscriptions");
  for (const v of variants) {
    const track = await createTrack(user, { subject: `Rollout ${v.runtime}`, runner: v.runtime });
    const practice: Practice = { version: 1, entry: { file: v.entry, symbol: v.symbol }, inputs: [{ name: "n", schema: { type: "integer" } }], output: { type: "integer" }, cases: [{ id: "sample-1", name: "Double two", inputs: { n: 2 }, expected: 4 }] };
    const files = [{ path: v.entry, content: v.source }, { path: v.test, content: v.testSource }, ...(v.runtime === "go" ? [{ path: "go.mod", content: "module lesson\ngo 1.24\n" }] : [])];
    const meta: LessonMeta = { id: "01-rollout", title: "Disposable rollout smoke", objective: "Double", brief: "Disposable verification lesson", hints: [], sources: [], files: files.map((f) => ({ path: f.path, role: f.path === v.test ? "test" : f.path === v.entry ? "starter" : "support" })), createdAt: new Date().toISOString(), status: "new", attempts: 0, verified: true, practice };
    await writeLesson(user, track.id, meta, files, [{ path: v.entry, content: v.source }]);
    const path = `/tracks/${track.id}/lessons/${meta.id}`;
    assert.equal((await api(`${path}/run`)).enabled, true);
    const before = await readFile(join(lessonDir(user, track.id, meta.id), ".meta/lesson.json"), "utf8");
    const run = await api(`${path}/run`, "POST", { version: 1, cases: [{ id: "custom-1", name: "Deliberate practice mismatch", inputs: { n: 7 }, expected: 999 }] });
    assert.equal(run.sandboxed, true);
    assert.equal(run.results[0].actual, 14);
    assert.equal(run.results[0].status, "failed");
    assert.equal(await readFile(join(lessonDir(user, track.id, meta.id), ".meta/lesson.json"), "utf8"), before);
    assert.deepEqual(await api(`${path}/submissions`), []);
    const submitted = await api(`${path}/check`, "POST");
    assert.equal(submitted.checks.passed, true, `${v.runtime} canonical checks failed`);
    assert.equal(submitted.meta.attempts, 1);
    assert.equal(submitted.meta.status, "passed");
    assert.equal((await api(`${path}/submissions`))[0].passed, true);
    await api(`${path}/file`, "PUT", { path: v.entry, content: v.source.replace("n * 2", "n * 3") });
    const failed = await api(`${path}/check`, "POST");
    assert.equal(failed.checks.passed, false);
    assert.equal(failed.meta.attempts, 2);
    assert.equal(failed.meta.status, "passed");
    assert.equal(failed.meta.failStreak, 1);
    assert.deepEqual((await api(`${path}/submissions`)).map((s: any) => s.passed), [false, true]);
    assert.equal((await getLesson(user, track.id, meta.id)).attempts, 2);
    console.log(`PASS: ${v.runtime} public authenticated custom Run leaves progress/history unchanged; canonical pass/fail Submit persists progress/history`);
  }
  await api("/account", "DELETE", { confirm: email });
  assert.equal(db.prepare("SELECT id FROM accounts WHERE id = ?").get(user), undefined);
  console.log("PASS: disposable account and learner files deleted through account API");
} finally {
  // Exception cleanup is strictly scoped to this script's random account.
  deleteAccountRows(user);
  await rm(userDir(user), { recursive: true, force: true });
  db.close();
}
