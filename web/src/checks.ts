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
  const pass = (text.match(/^PASS\b/gm) ?? []).length;
  const fail = (text.match(/^FAIL\b/gm) ?? []).length;
  if (pass + fail) return of(pass, fail, "cases");
  return c.passed ? "Checks pass" : "Checks fail";
}
