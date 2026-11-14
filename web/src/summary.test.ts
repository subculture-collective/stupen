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

test("vitest, jest, surefire, dotnet, exunit, minitest, phpunit, deno and bun totals", () => {
  assert.equal(summarize(c(" Test Files  1 failed (1)\n      Tests  6 failed | 3 passed (9)")), "3 of 9 tests pass");
  assert.equal(summarize(c("      Tests  9 passed (9)", true)), "9 of 9 tests pass");
  assert.equal(summarize(c("Tests:       2 failed, 7 passed, 9 total")), "7 of 9 tests pass");
  assert.equal(summarize(c("Tests run: 4, Failures: 1, Errors: 0\nTests run: 9, Failures: 2, Errors: 1")), "6 of 9 tests pass");
  assert.equal(summarize(c("Failed!  - Failed:     2, Passed:     7, Skipped: 0")), "7 of 9 tests pass");
  assert.equal(summarize(c("Finished in 0.1 seconds\n9 tests, 2 failures")), "7 of 9 tests pass");
  assert.equal(summarize(c("9 runs, 12 assertions, 2 failures, 1 errors, 0 skips")), "6 of 9 tests pass");
  assert.equal(summarize(c("OK (9 tests, 12 assertions)", true)), "9 of 9 tests pass");
  assert.equal(summarize(c("FAILED | 3 passed | 1 failed (5ms)")), "3 of 4 tests pass");
  assert.equal(summarize(c(" 3 pass\n 1 fail\n 4 expect() calls")), "3 of 4 tests pass");
});

test("singular test counts", () => {
  assert.equal(summarize(c("1 test, 0 failures", true)), "1 of 1 tests pass");
});
