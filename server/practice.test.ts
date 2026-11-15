import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Practice } from "../shared/practice.ts";
import { config } from "./config.ts";
import { practicePrompt, publishedPractice, validatePractice } from "./practice.ts";
import { createTrack, getLesson, listLessons, type LessonMeta, saveLessonMeta, writeLesson } from "./store.ts";

const files = [{ path: "solution.ts", role: "starter" }, { path: "solution.test.ts", role: "test" }];
const sample = (): Practice => ({ version: 1, entry: { file: "solution.ts", symbol: "double" }, inputs: [{ name: "n", schema: { type: "integer" } }], output: { type: "integer" }, cases: [{ id: "sample-1", name: "Zero", inputs: { n: 0 }, expected: 0 }] });

test("generated callable fixtures validate for TS, JS, Python and Go, without enabling execution", () => {
  for (const [runtime, file, symbol] of [["typescript", "solution.ts", "double"], ["javascript", "solution.mjs", "double"], ["python", "solution.py", "double_value"], ["go", "solution.go", "Double"]]) {
    const p = sample();
    p.entry = { file: file!, symbol: symbol! };
    assert.deepEqual(publishedPractice(JSON.stringify(p), runtime!, [{ path: file!, role: "starter" }], true), p);
    assert.match(practicePrompt(runtime!), new RegExp(file!.replace(".", "\\.")));
    assert.equal("runnable" in p, false);
  }
});

test("false/zero/empty expected values are distinct from absent expected output", () => {
  for (const [schema, expected] of [[{ type: "boolean" }, false], [{ type: "integer" }, 0], [{ type: "string" }, ""], [{ type: "array", items: { type: "integer" } }, []], [{ type: "object", properties: {}, required: [] }, {}]] as const) {
    const p = { ...sample(), output: schema, cases: [{ ...sample().cases[0], expected }] };
    assert.equal(Object.hasOwn(validatePractice(p, "typescript", files).cases[0]!, "expected"), true);
  }
  const p = sample();
  delete p.cases[0]!.expected;
  assert.equal(Object.hasOwn(validatePractice(p, "typescript", files).cases[0]!, "expected"), false);
});

test("malformed entry paths, symbols, roles and runtime mismatches cannot publish", () => {
  for (const file of ["../solution.ts", ".reference/solution.ts", ".meta/lesson.json", ".cache/x.ts", "/solution.ts", "a\\b.ts", "missing.ts", "solution.test.ts", "solution.py"]) {
    assert.throws(() => validatePractice({ ...sample(), entry: { file, symbol: "double" } }, "typescript", files));
  }
  for (const symbol of ["double()", "obj.double", "async", "for", "__proto__", "x".repeat(65)]) {
    assert.throws(() => validatePractice({ ...sample(), entry: { file: "solution.ts", symbol } }, "typescript", files));
  }
  for (const runtime of ["written", "container", "custom", "rust", "unknown"]) {
    assert.equal(publishedPractice(sample(), runtime, files, true), undefined);
    assert.match(practicePrompt(runtime), /empty string/);
  }
});

test("closed schemas validate named inputs and supplied expected outputs within bounds", () => {
  const invalid: unknown[] = [
    { ...sample(), version: 2 }, { ...sample(), reference: "private" },
    { ...sample(), inputs: [...sample().inputs, ...sample().inputs] },
    { ...sample(), output: { type: "null" } }, { ...sample(), output: { type: "string", extra: true } },
    { ...sample(), output: { type: "object", properties: { x: { type: "string" } }, required: [] } },
    { ...sample(), cases: [] }, { ...sample(), cases: Array.from({ length: 11 }, (_, i) => ({ ...sample().cases[0], id: `sample-${i}` })) },
    ...[NaN, Infinity, 9007199254740992, null, "wrong"].map((expected) => ({ ...sample(), cases: [{ ...sample().cases[0], expected }] })),
    { ...sample(), cases: [{ ...sample().cases[0], inputs: { n: 0, extra: 1 } }] },
    { ...sample(), cases: [{ ...sample().cases[0], inputs: {} }] },
    { ...sample(), cases: [...sample().cases, ...sample().cases] },
    { ...sample(), cases: [{ ...sample().cases[0], id: "custom-1" }] },
    { ...sample(), output: { type: "string" }, cases: [{ ...sample().cases[0], expected: "é".repeat(4097) }] },
    { ...sample(), output: { type: "array", items: { type: "integer" } }, cases: [{ ...sample().cases[0], expected: Array(1001).fill(1) }] },
  ];
  for (const p of invalid) assert.throws(() => validatePractice(p, "typescript", files));
  let deep: unknown = { type: "integer" };
  for (let n = 0; n < 8; n++) deep = { type: "array", items: deep };
  assert.throws(() => validatePractice({ ...sample(), output: deep }, "typescript", files), /nesting/);
  assert.throws(() => validatePractice(JSON.stringify(sample()).replace('"version":1', '"version":1,"vers\\u0069on":1'), "typescript", files), /duplicate/);
  assert.throws(() => validatePractice(" ".repeat(65_537), "typescript", files), /64 KiB/);
  const p = sample();
  p.output = { type: "object", properties: { values: { type: "array", items: { type: "number" } } }, required: ["values"] };
  p.cases[0]!.expected = { values: [1.25, -2, 0] };
  assert.deepEqual(validatePractice(p, "typescript", files), p);
});

test("unverified or malformed metadata is omitted with a warning, not a broken lesson", () => {
  const warnings: string[] = [];
  assert.equal(publishedPractice(JSON.stringify(sample()), "typescript", files, false, (m) => warnings.push(m)), undefined);
  assert.equal(publishedPractice("{broken", "typescript", files, true, (m) => warnings.push(m)), undefined);
  assert.equal(publishedPractice(undefined, "typescript", files, true), undefined);
  assert.equal(publishedPractice("", "typescript", files, true), undefined);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /canonical reference\/starter verification/);
});

test("stored lesson/API data retains public cases and legacy checks, never reference content or private extras", async () => {
  const prior = config.dataDir;
  const temp = await mkdtemp(join(tmpdir(), "stupen-practice-"));
  config.dataDir = temp;
  try {
    const track = await createTrack("fixture", { title: "Cases", subject: "Functions", runner: "typescript" });
    const meta: LessonMeta = { id: "01-cases", title: "Cases", objective: "Double", brief: "A task", hints: [], sources: [], files: [{ path: "solution.ts", role: "starter" }, { path: "solution.test.ts", role: "test" }], createdAt: "", status: "new", attempts: 0, verified: true, practice: sample() };
    await writeLesson("fixture", track.id, meta, [{ path: "solution.ts", content: "export function double(n: number) { return 0; }" }], [{ path: "solution.ts", content: "PROTECTED REFERENCE SOURCE" }]);
    const loaded = await getLesson("fixture", track.id, meta.id);
    assert.deepEqual(loaded.practice, sample());
    assert.doesNotMatch(JSON.stringify(loaded), /PROTECTED|\.reference|\.meta/);
    const malformed = { ...meta, practice: { ...sample(), privateSource: "PRIVATE" } };
    await saveLessonMeta("fixture", track.id, malformed);
    assert.equal((await getLesson("fixture", track.id, meta.id)).practice, undefined);
    assert.equal((await listLessons("fixture", track.id))[0]?.practice, undefined);
    await saveLessonMeta("fixture", track.id, { ...meta, verified: false });
    assert.equal((await getLesson("fixture", track.id, meta.id)).practice, undefined);
    const { practice: _removed, ...legacy } = meta;
    await saveLessonMeta("fixture", track.id, legacy);
    assert.deepEqual(await getLesson("fixture", track.id, meta.id), legacy);
  } finally {
    config.dataDir = prior;
    await rm(temp, { recursive: true, force: true });
  }
});
