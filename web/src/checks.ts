import type { Checks } from "./api.ts";

/** "3 of 4 tests pass" when the output says so; otherwise passed or failed. */
export function summarize(c: Checks): string {
  const text = c.results.map((r) => r.output).join("\n");
  const of = (p: number, f: number, unit = "tests") => `${p} of ${p + f} ${unit} pass`;
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)];
  if (cargo.length) return of(cargo.reduce((a, m) => a + Number(m[1]), 0), cargo.reduce((a, m) => a + Number(m[2]), 0));
  const goPass = (text.match(/^\s*--- PASS/gm) ?? []).length;
  const goFail = (text.match(/^\s*--- FAIL/gm) ?? []).length;
  if (goPass + goFail) return of(goPass, goFail);
  const node = /^# pass (\d+)\n# fail (\d+)/m.exec(text) ?? /ℹ pass (\d+)\nℹ fail (\d+)/.exec(text);
  if (node) return of(Number(node[1]), Number(node[2]));
  const pytest = /^=*\s*(?:(\d+) failed)?(?:, )?(?:(\d+) passed)?.* in [\d.]+s/m.exec(text);
  if (pytest && (pytest[1] || pytest[2])) return of(Number(pytest[2] ?? 0), Number(pytest[1] ?? 0));
  // Vitest: "Tests  6 failed | 3 passed (9)"
  const vitest = /^\s*Tests\s+(?:(\d+) failed)?(?:\s*\|\s*)?(?:(\d+) passed)?[^\n]*\((\d+)\)/m.exec(text);
  if (vitest) return of(Number(vitest[2] ?? 0), Number(vitest[3]) - Number(vitest[2] ?? 0));
  // Jest: "Tests:       2 failed, 7 passed, 9 total"
  const jest = /^Tests:\s+(?:(\d+) failed, )?(?:(\d+) passed, )?(\d+) total/m.exec(text);
  if (jest) return of(Number(jest[2] ?? 0), Number(jest[3]) - Number(jest[2] ?? 0));
  // Maven Surefire totals: "Tests run: 9, Failures: 2, Errors: 0" (the last one is the summary).
  const surefire = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)/g)].at(-1);
  if (surefire) return of(Number(surefire[1]) - Number(surefire[2]) - Number(surefire[3]), Number(surefire[2]) + Number(surefire[3]));
  // .NET: "Failed!  - Failed: 2, Passed: 7" / "Passed!  - Failed: 0, Passed: 9"
  const dotnet = /Failed:\s+(\d+), Passed:\s+(\d+)/.exec(text);
  if (dotnet) return of(Number(dotnet[2]), Number(dotnet[1]));
  // ExUnit "9 tests, 2 failures"; RSpec "9 examples, 2 failures"; Minitest "9 runs, 12 assertions, 2 failures, 1 errors".
  const ex = /(\d+) (?:tests?|examples?|runs?)(?:, \d+ assertions?)?, (\d+) failures?(?:, (\d+) errors?)?/.exec(text);
  if (ex) return of(Number(ex[1]) - Number(ex[2]) - Number(ex[3] ?? 0), Number(ex[2]) + Number(ex[3] ?? 0));
  // PHPUnit "OK (9 tests, …)" or "Tests: 9, Assertions: 12, Failures: 2."
  const phpOk = /^OK \((\d+) tests?/m.exec(text);
  if (phpOk) return of(Number(phpOk[1]), 0);
  const php = /^Tests: (\d+), Assertions: \d+(?:, (?:Errors|Failures): (\d+))?(?:, (?:Errors|Failures): (\d+))?/m.exec(text);
  if (php) return of(Number(php[1]) - Number(php[2] ?? 0) - Number(php[3] ?? 0), Number(php[2] ?? 0) + Number(php[3] ?? 0));
  // Deno "ok | 3 passed | 1 failed"; Bun " 3 pass" / " 1 fail".
  const deno = /\| (\d+) passed \| (\d+) failed/.exec(text);
  if (deno) return of(Number(deno[1]), Number(deno[2]));
  const bunPass = /^\s*(\d+) pass$/m.exec(text);
  const bunFail = /^\s*(\d+) fail$/m.exec(text);
  if (bunPass || bunFail) return of(Number(bunPass?.[1] ?? 0), Number(bunFail?.[1] ?? 0));
  const pass = (text.match(/^PASS\b/gm) ?? []).length;
  const fail = (text.match(/^FAIL\b/gm) ?? []).length;
  if (pass + fail) return of(pass, fail, "cases");
  return c.passed ? "Checks pass" : "Checks fail";
}
