import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, mock } from "node:test";
import { SUBMISSION_DETAIL_CHARS, SUBMISSION_LIMIT } from "../shared/submissions.ts";
import { config } from "./config.ts";
import { createTrack, deleteLesson, deleteTrack, getLesson, lessonDir, readSubmissions, recordSubmission, saveLessonMeta, updateLessonMeta, writeLesson, type LessonMeta } from "./store.ts";
import type { Checks } from "./sandbox.ts";

const checks = (passed = false): Checks => ({ at: new Date().toISOString(), passed, sandboxed: true, results: [{ command: "node --test", output: "Test result", exitCode: passed ? 0 : 1, durationMs: 12, timedOut: false }] });

test("canonical history is private, bounded, atomic with progress and follows lesson/track deletion", async () => {
  const prior = config.dataDir;
  config.dataDir = await mkdtemp(join(tmpdir(), "stupen-submissions-"));
  try {
    const t = await createTrack("owner", { subject: "History", runner: "typescript" });
    await createTrack("other", { subject: "History", runner: "typescript" });
    const m: LessonMeta = { id: "01-history", title: "History", objective: "", brief: "", hints: [], sources: [], files: [], createdAt: "", status: "new", attempts: 7, verified: true, lastChecks: checks() };
    for (const user of ["owner", "other"]) await writeLesson(user, t.id, m, [], []);
    assert.deepEqual(await readSubmissions("owner", t.id, m.id), [], "legacy checks are not fabricated into history");
    await assert.rejects(readSubmissions("intruder", t.id, m.id), { status: 404 });
    const failed = await recordSubmission("owner", t.id, m.id, checks());
    assert.equal(failed.attempts, 8);
    assert.equal(failed.failStreak, 1);
    assert.equal((await readSubmissions("owner", t.id, m.id))[0]!.durationMs, 12);
    assert.equal(Object.hasOwn(failed, "submissions"), false);
    assert.equal(Object.hasOwn(await getLesson("owner", t.id, m.id), "submissions"), false);
    const passed = await recordSubmission("owner", t.id, m.id, checks(true));
    assert.equal(passed.status, "passed");
    assert.equal(passed.failStreak, 0);
    await saveLessonMeta("owner", t.id, { ...passed, revealedAt: new Date().toISOString() });
    assert.equal((await readSubmissions("owner", t.id, m.id)).length, 2, "ordinary metadata writes preserve history");
    await Promise.all([
      updateLessonMeta("owner", t.id, m.id, (fresh) => ({ ...fresh, revealedAt: "first" })),
      recordSubmission("owner", t.id, m.id, checks()),
      updateLessonMeta("owner", t.id, m.id, (fresh) => ({ ...fresh, revealedAt: "second" })),
    ]);
    assert.equal((await getLesson("owner", t.id, m.id)).attempts, passed.attempts + 1);
    assert.equal((await getLesson("owner", t.id, m.id)).lastChecks?.passed, false);
    assert.equal((await readSubmissions("owner", t.id, m.id)).length, 3, "concurrent metadata writers preserve new history");
    for (let i = 0; i < SUBMISSION_LIMIT + 1; i++) await recordSubmission("owner", t.id, m.id, { ...checks(), results: Array(25).fill({ ...checks().results[0], output: '"\\\n😀'.repeat(10_000) }) });
    const history = await readSubmissions("owner", t.id, m.id);
    assert.equal(history.length, SUBMISSION_LIMIT);
    assert.equal(new Set(history.map((s) => s.id)).size, SUBMISSION_LIMIT);
    assert.ok(history.every((s) => s.detailsTruncated));
    assert.ok(history.every((s) => s.checks.results.reduce((n, r) => n + r.command.length + r.output.length, 0) <= SUBMISSION_DETAIL_CHARS));
    assert.deepEqual(await readSubmissions("other", t.id, m.id), []);
    const file = join(lessonDir("owner", t.id, m.id), ".meta/lesson.json");
    const original = await readFile(file, "utf8");
    // Block the atomic write's temporary path without changing the saved record.
    const now = mock.method(Date, "now", () => 12345);
    const blocked = `${file}.${process.pid}.12345.tmp`;
    await mkdir(blocked);
    await assert.rejects(recordSubmission("owner", t.id, m.id, checks(true)), { status: 500 });
    now.mock.restore();
    await rm(blocked, { recursive: true });
    assert.equal(await readFile(file, "utf8"), original);
    await deleteLesson("owner", t.id, m.id);
    await assert.rejects(readSubmissions("owner", t.id, m.id), { status: 404 });
    await deleteTrack("other", t.id);
    await assert.rejects(readSubmissions("other", t.id, m.id), { status: 404 });
  } finally {
    await rm(config.dataDir, { recursive: true, force: true });
    config.dataDir = prior;
  }
});
