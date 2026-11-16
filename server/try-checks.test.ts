import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startSession } from "./auth.ts";
import { config } from "./config.ts";
import { database, useMemoryDatabase } from "./db.ts";
import { createTrack, lessonDir, readSubmissions, writeLesson, type LessonMeta } from "./store.ts";

test("ordinary-test Run enforces access and leaves progress/history unchanged on pass and fail", { timeout: 20_000 }, async () => {
  const prior = config.dataDir;
  const dir = await mkdtemp(join(tmpdir(), "stupen-try-checks-"));
  config.dataDir = dir;
  const db = database();
  for (const id of ["owner", "other"]) db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").run(id, `${id}@example.test`, Date.now());
  const session = (id: string) => startSession(id, "email", { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage).split(";")[0]!;
  const cookie = session("owner"), other = session("other");
  let passed = true, runnerCalls = 0;
  const runner = createServer((req, res) => {
    if (req.url === "/v1/status") { res.end(JSON.stringify({ sandbox: { sandboxed: true }, runners: {}, docker: {} })); return; }
    assert.equal(req.url, "/v1/quick");
    runnerCalls++;
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ at: "now", passed, sandboxed: true, results: [{ command: "go test", exitCode: passed ? 0 : 1, output: "fixture test output", durationMs: 1, timedOut: false }] }));
  });
  runner.listen(0, "127.0.0.1"); await once(runner, "listening");
  const runnerPort = (runner.address() as { port: number }).port;
  const socket = join(dir, "server.sock");
  const child = spawn(process.execPath, ["server/index.ts"], { cwd: config.appDir, env: { PATH: "/usr/bin:/bin", HOME: dir, AUTH_MODE: "accounts", STUDY_DATA_DIR: dir, STUDY_TOOLS_DIR: join(dir, "tools"), SOCKET: socket, RUNNER_URL: `http://127.0.0.1:${runnerPort}`, RUNNER_TOKEN: "fixture" } });
  child.stderr.resume();
  const call = (path: string, headers: Record<string, string> = { cookie }) => new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = request({ socketPath: socket, path, method: "POST", headers: { host: "localhost", "x-study-coach": "1", ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode!, data: JSON.parse(text) }); } catch { reject(new Error("Expected JSON")); } });
    }); req.on("error", reject); req.end();
  });
  try {
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", () => reject(new Error("Fixture server exited"))); child.stdout.on("data", (c) => { if (c.toString().includes("stupen on")) resolve(); }); });
    const track = await createTrack("owner", { subject: "Handler", runner: "go" });
    const meta: LessonMeta = { id: "01-handler", title: "Handler", objective: "", brief: "", hints: [], sources: [], files: [{ path: "solution.go", role: "starter" }, { path: "solution_test.go", role: "test" }], createdAt: "", status: "started", attempts: 3, failStreak: 2, verified: true };
    await writeLesson("owner", track.id, meta, [{ path: "solution.go", content: "package lesson" }, { path: "solution_test.go", content: "package lesson" }], []);
    const base = `/api/tracks/${track.id}/lessons/${meta.id}`;
    const path = `${base}/try-checks`;
    assert.equal((await call(path, {})).status, 401);
    assert.equal((await call(path, { cookie: other })).status, 404);
    assert.equal((await call(path, { cookie, "x-study-coach": "" })).status, 403);
    assert.equal((await call(path.replace(meta.id, "99-absent"))).status, 404);
    assert.equal(runnerCalls, 0, "access checks precede execution");
    const file = join(lessonDir("owner", track.id, meta.id), ".meta/lesson.json");
    const before = await readFile(file, "utf8");
    for (const result of [true, false]) {
      passed = result;
      const response = await call(path);
      assert.equal(response.status, 200);
      assert.equal(response.data.checks.passed, result);
      assert.deepEqual(Object.keys(response.data), ["checks"]);
      assert.equal(await readFile(file, "utf8"), before);
      assert.deepEqual(await readSubmissions("owner", track.id, meta.id), []);
    }
    const submitted = await call(`${base}/check`);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.data.meta.attempts, 4);
    assert.equal(submitted.data.meta.failStreak, 3);
    assert.equal((await readSubmissions("owner", track.id, meta.id)).length, 1);
  } finally {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    runner.close(); await once(runner, "close");
    db.close(); useMemoryDatabase(); config.dataDir = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
