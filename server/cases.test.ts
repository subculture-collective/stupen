import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initialCaseDrafts, parseCaseDrafts, validateCaseDrafts } from "../shared/cases.ts";
import type { Practice } from "../shared/practice.ts";
import { startSession } from "./auth.ts";
import { config } from "./config.ts";
import { database, useMemoryDatabase } from "./db.ts";
import { createTrack, getLesson, lessonDir, readCaseDrafts, trackDir, userDir, writeCaseDrafts, writeLesson, type LessonMeta } from "./store.ts";
import { writeJson } from "./util.ts";
import { STORAGE_LIMIT_BYTES } from "./limits.ts";

const practice: Practice = { version: 1, entry: { file: "solution.ts", symbol: "double" }, inputs: [{ name: "n", schema: { type: "integer" } }], output: { type: "integer" }, cases: [{ id: "sample-1", name: "Zero", inputs: { n: 0 }, expected: 0 }, { id: "sample-2", name: "Two", inputs: { n: 2 } }] };

test("draft parsing reports field errors, preserves falsy expected values, and withholds every executable case on error", () => {
  const d = initialCaseDrafts(practice);
  assert.equal(parseCaseDrafts(d, practice).cases?.[0]?.expected, 0);
  assert.equal(Object.hasOwn(parseCaseDrafts(d, practice).cases![1]!, "expected"), false);
  for (const text of ['"wrong"', "1e999", "9007199254740992", "null", "{"]) {
    d.cases[0]!.inputs.n = text;
    assert.equal(parseCaseDrafts(d, practice).cases, undefined);
    assert.ok(parseCaseDrafts(d, practice).errors["sample-1"]?.["inputs.n"]);
    assert.doesNotThrow(() => validateCaseDrafts(d, practice), "unfinished JSON remains a bounded draft");
  }
  const objectPractice: Practice = { ...practice, inputs: [{ name: "n", schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } }] };
  for (const text of ['{"x":"a","x":"b"}', '{"x":"a","extra":1}', '{}', JSON.stringify({ x: "é".repeat(4097) })]) {
    d.cases[0]!.inputs.n = text;
    assert.ok(parseCaseDrafts(d, objectPractice).errors["sample-1"]?.["inputs.n"]);
  }
  const arrayPractice: Practice = { ...practice, inputs: [{ name: "n", schema: { type: "array", items: { type: "integer" } } }] };
  d.cases[0]!.inputs.n = JSON.stringify(Array(1001).fill(1));
  assert.match(parseCaseDrafts(d, arrayPractice).errors["sample-1"]!["inputs.n"]!, /1000/);
  // An input named expected must not collide with the expected-output error.
  const named = { ...practice, inputs: [{ name: "expected", schema: { type: "boolean" as const } }], cases: [{ id: "sample-1", name: "False", inputs: { expected: false }, expected: 0 }] };
  const n = initialCaseDrafts(named);
  n.cases[0]!.expected = "false";
  assert.equal(parseCaseDrafts(n, named).errors["sample-1"]!["inputs.expected"], undefined);
  assert.match(parseCaseDrafts(n, named).errors["sample-1"]!.expected!, /integer/);
});

test("every valid sample remains editable after JSON escaping, including prototype-like IDs", () => {
  const escaped: Practice = { ...practice, inputs: [{ name: "n", schema: { type: "string" } }], cases: [{ id: "constructor", name: "Quoted", inputs: { n: '"'.repeat(8192) } }] };
  const draft = initialCaseDrafts(escaped);
  assert.doesNotThrow(() => validateCaseDrafts(draft, escaped));
  assert.equal(parseCaseDrafts(draft, escaped).cases?.[0]?.inputs.n, '"'.repeat(8192));
  assert.equal(parseCaseDrafts(draft, escaped).errors.constructor, undefined);
});

test("storage envelopes reject paths, commands, missing samples, foreign IDs, count and byte overflows", () => {
  const base = initialCaseDrafts(practice);
  const bad = [
    { ...base, path: ".reference/solution.ts" }, { ...base, command: "echo unsafe" }, { ...base, version: 2 },
    { ...base, selected: "other" }, { ...base, cases: base.cases.slice(1) },
    { ...base, cases: [...base.cases, base.cases[0]] },
    { ...base, cases: [...base.cases, { ...base.cases[0], id: "foreign" }] },
    { ...base, cases: [...base.cases, { ...base.cases[0], id: "custom-../path" }] },
    { ...base, cases: [{ ...base.cases[0], inputs: { n: 4 } }, base.cases[1]] },
    { ...base, cases: [{ ...base.cases[0], inputs: { n: "1", extra: "2" } }, base.cases[1]] },
    { ...base, cases: [{ ...base.cases[0], expected: "é".repeat(33_000) }, base.cases[1]] },
    { ...base, cases: [...base.cases, ...Array.from({ length: 19 }, (_, i) => ({ ...base.cases[0], id: `custom-${i}` }))] },
    { ...base, cases: [...base.cases, ...Array.from({ length: 18 }, (_, i) => ({ ...base.cases[0], id: `custom-${i}`, expected: " ".repeat(16_000) }))] },
  ];
  for (const value of bad) assert.throws(() => validateCaseDrafts(value, practice));
});

test("owned drafts round-trip independently of sample metadata, starter/tests, grading, and other learners", async () => {
  const prior = config.dataDir;
  config.dataDir = await mkdtemp(join(tmpdir(), "stupen-cases-"));
  try {
    const track = await createTrack("owner", { title: "Cases", subject: "Functions", runner: "typescript" });
    const meta: LessonMeta = { id: "01-cases", title: "Cases", objective: "Double", brief: "", hints: [], sources: [], files: [{ path: "solution.ts", role: "starter" }, { path: "solution.test.ts", role: "test" }], createdAt: "", status: "new", attempts: 3, failStreak: 2, verified: true, practice };
    const files = [{ path: "solution.ts", content: "STARTER" }, { path: "solution.test.ts", content: "CANONICAL" }];
    for (const user of ["owner", "other"]) {
      if (user === "other") {
        await writeJson(join(trackDir(user, track.id), "track.json"), track);
      }
      await writeLesson(user, track.id, meta, files, [{ path: "solution.ts", content: "PROTECTED" }]);
    }
    const draft = await readCaseDrafts("owner", track.id, meta.id);
    draft.cases[0]!.inputs.n = "{";
    draft.cases.push({ id: "custom-1", name: "My case", inputs: { n: "4" } });
    draft.selected = "custom-1";
    await writeCaseDrafts("owner", track.id, meta.id, draft);
    assert.deepEqual(await readCaseDrafts("owner", track.id, meta.id), draft);
    assert.deepEqual(await readCaseDrafts("other", track.id, meta.id), initialCaseDrafts(practice));
    assert.deepEqual(await getLesson("owner", track.id, meta.id), meta);
    for (const f of [...files, { path: ".reference/solution.ts", content: "PROTECTED" }]) assert.equal(await readFile(join(lessonDir("owner", track.id, meta.id), f.path), "utf8"), f.content);
    const stored = JSON.parse(await readFile(join(lessonDir("owner", track.id, meta.id), ".meta/cases.json"), "utf8"));
    assert.equal(stored.cases.length, 2, "unchanged samples are not persisted");
    await assert.rejects(readCaseDrafts("intruder", track.id, meta.id), { status: 404 });
    const { practice: _practice, ...legacy } = meta;
    await writeLesson("owner", track.id, { ...legacy, id: "02-legacy" }, files, []);
    await assert.rejects(writeCaseDrafts("owner", track.id, "02-legacy", draft), { status: 422 });
  } finally {
    await rm(config.dataDir, { recursive: true, force: true });
    config.dataDir = prior;
  }
});

test("HTTP case routes enforce sessions, ownership, app header, storage quota and request limits", { timeout: 20_000 }, async () => {
  const prior = config.dataDir;
  const dir = await mkdtemp(join(tmpdir(), "stupen-cases-api-"));
  config.dataDir = dir;
  const socket = join(dir, "server.sock");
  const db = database();
  for (const id of ["owner", "other"]) db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").run(id, `${id}@example.test`, Date.now());
  const cookie = startSession("owner", "email", { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage).split(";")[0]!;
  const other = startSession("other", "email", { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage).split(";")[0]!;
  const child = spawn(process.execPath, ["server/index.ts"], { cwd: config.appDir, env: { PATH: join(dir, "no-binaries"), HOME: dir, AUTH_MODE: "accounts", STUDY_DATA_DIR: dir, STUDY_TOOLS_DIR: join(dir, "tools"), SOCKET: socket } });
  child.stderr.resume();
  const call = (path: string, method = "GET", data?: unknown, headers: Record<string, string> = { cookie }) => new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = request({ socketPath: socket, path, method, headers: { host: "localhost", "x-study-coach": "1", "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Fixture server exited before listening")));
      child.stdout.on("data", (chunk) => { if (chunk.toString().includes("stupen on")) resolve(); });
    });
    const track = await createTrack("owner", { title: "API cases", subject: "Functions", runner: "typescript" });
    await writeLesson("owner", track.id, { id: "01-cases", title: "Cases", objective: "", brief: "", hints: [], sources: [], files: [{ path: "solution.ts", role: "starter" }], createdAt: "", status: "new", attempts: 0, verified: true, practice }, [], []);
    const url = `/api/tracks/${track.id}/lessons/01-cases/cases`;
    assert.equal((await call(url, "GET", undefined, {})).status, 401);
    assert.equal((await call(url, "GET", undefined, { cookie: other })).status, 404);
    const draft = initialCaseDrafts(practice);
    assert.deepEqual((await call(url)).data, draft);
    draft.selected = "sample-2";
    assert.equal((await call(url, "PUT", draft)).status, 200);
    assert.deepEqual((await call(url)).data, draft);
    assert.equal((await call(url, "PUT", draft, { cookie, "x-study-coach": "" })).status, 403);
    assert.equal((await call(url, "PUT", { ...draft, command: "unsafe" })).status, 400);
    assert.equal((await call(url, "PUT", { ...draft, extra: "x".repeat(262_144) })).status, 413);
    await mkdir(userDir("other"), { recursive: true });
    const quotaFile = join(userDir("other"), "quota-fixture");
    await writeFile(quotaFile, "");
    await truncate(quotaFile, STORAGE_LIMIT_BYTES + 1);
    assert.equal((await call(url, "PUT", draft, { cookie: other })).status, 413, "case saves use the account storage quota");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    db.close();
    useMemoryDatabase();
    config.dataDir = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
