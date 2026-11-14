import assert from "node:assert/strict";
import { test } from "node:test";

import { summarize } from "./checks.ts";

const c = (output: string, passed = false) => ({ at: "", passed, sandboxed: true, results: [{ command: "x", exitCode: passed ? 0 : 1, output, durationMs: 1, timedOut: false }] });

test("cargo sums every test binary", () => {
  assert.equal(summarize(c("test result: ok. 0 passed; 0 failed;\ntest result: FAILED. 3 passed; 17 failed;")), "3 of 20 tests pass");
});
test("pytest summary lines", () => {
  assert.equal(summarize(c("....F\n1 failed, 4 passed in 0.03s")), "4 of 5 tests pass");
  assert.equal(summarize(c("5 passed in 0.01s", true)), "5 of 5 tests pass");
});
test("go -v cases", () => {
  assert.equal(summarize(c("--- PASS: TestA (0.00s)\n    --- FAIL: TestA/b (0.00s)")), "1 of 2 tests pass");
});
test("node --test totals", () => {
  assert.equal(summarize(c("ℹ tests 3\nℹ suites 0\nℹ pass 2\nℹ fail 1")), "2 of 3 tests pass");
});
test("PASS/FAIL lines from hand-written harnesses", () => {
  assert.equal(summarize(c("PASS add\nFAIL sub expected 1 got 2")), "1 of 2 cases pass");
});
