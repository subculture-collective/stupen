import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { typescriptService } from "./typescriptService.ts";
import { checkProblems, location, position } from "./problems.ts";
import { goCompletions, goDocumentation, importedPackage } from "./goAssistance.ts";
import { localDocumentation } from "./editorAssistance.ts";

const libDir = new URL("./", import.meta.resolve("typescript-language-service"));
const libs = Object.fromEntries(readdirSync(libDir).filter((name) => /^lib\..*\.d\.ts$/.test(name)).map((name) => [`/lib/${name}`, readFileSync(new URL(name, libDir), "utf8")]));
const nodeDir = new URL("./", import.meta.resolve("@types/node/package.json"));
for (const path of readdirSync(nodeDir, { recursive: true }) as string[]) if (path.endsWith(".d.ts")) libs[`/node_modules/@types/node/${path}`] = readFileSync(new URL(path, nodeDir), "utf8");

test("Node standard library imports have types and hover documentation", () => {
  const service = typescriptService(libs);
  const content = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("sum", () => assert.equal(1 + 1, 2));';
  assert.deepEqual(service.sync([{ path: "solution.test.ts", content }]), []);
  assert.match(service.hover("solution.test.ts", content.lastIndexOf("equal"))!.signature, /equal/);
});

test("TypeScript completion and hover use standard library types and documentation", () => {
  const service = typescriptService(libs);
  const content = 'const value = "hello";\nvalue.toU';
  service.sync([{ path: "solution.ts", content }]);
  const completion = service.complete("solution.ts", content.length).find((c) => c.label === "toUpperCase");
  assert.ok(completion);
  assert.match(completion.info!, /upper/i);
  assert.match(service.hover("solution.ts", content.indexOf("value"))!.signature, /value/);
});

test("TypeScript diagnostics follow unsaved edits, cross-file imports and removed files", () => {
  const service = typescriptService(libs);
  const helper = { path: "helpers.ts", content: '/** Double a value. */\nexport function double(n: number) { return n * 2; }' };
  const content = 'import { double } from "./helpers.ts";\nconst result: number = double("wrong");';
  const errors = service.sync([helper, { path: "solution.ts", content }]);
  assert.ok(errors.some((e) => e.path === "solution.ts" && /string.*number/.test(e.message)));
  assert.match(service.hover("solution.ts", content.indexOf("double", 15))!.documentation, /Double a value/);
  assert.deepEqual(service.sync([helper, { path: "solution.ts", content: content.replace('"wrong"', "2") }]), []);
  assert.deepEqual(service.sync([]), []);
});

test("Go imported package names and aliases provide real standard library docs", async () => {
  const code = 'package lesson\nimport (\n f "fmt"\n "strings"\n)\nfunc main() { f.Println(strings.TrimSpace("hi")) }';
  assert.equal(importedPackage("f", code), "fmt");
  assert.equal(importedPackage("strings", code), "strings");
  assert.ok((await goCompletions(code, "f")).some((c) => c.label === "Println" && /newline/i.test(c.info!)));
  assert.match((await goDocumentation("TrimSpace", "strings", code))!.documentation, /white space/);
  assert.ok((await goCompletions(code)).some((c) => c.label === "append"));
  assert.deepEqual(await goCompletions(code, "unknown"), []);
  assert.ok((await goCompletions('package lesson\nimport "math"', "math")).some((c) => c.label === "Pi"));
  assert.equal(importedPackage("fmt", 'package lesson\nvar text = `\n"fmt"\n`'), undefined);
});

test("Python hover includes builtin docs and the learner's docstrings", () => {
  assert.match(localDocumentation("len", "solution.py", [])!.documentation, /number of items/);
  const file = { path: "solution.py", content: 'def total(values):\n    """Sum the supplied values."""\n    return sum(values)' };
  assert.equal(localDocumentation("total", file.path, [file])!.documentation, "Sum the supplied values.");
});

const checks = (output: string) => ({ at: "", sandboxed: true, passed: false, results: [{ command: "check", output, exitCode: 1, durationMs: 1, timedOut: false }] });
const files = [{ path: "src/solution.ts", content: "first\nconst value = 2;\n" }, { path: "solution.py", content: "def broken():\n    return missing\n" }, { path: "solution.go", content: "package lesson\nfunc broken() { missing() }" }];

test("Problems locate TypeScript, Go and Python errors without exposing hidden paths", () => {
  const typed = checkProblems(checks("src/solution.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'."), files);
  assert.equal(typed[0]!.path, "src/solution.ts");
  assert.deepEqual(location(files[0]!.content, typed[0]!.from), { line: 2, column: 7 });
  const go = checkProblems(checks("./solution.go:2:17: undefined: missing"), files);
  assert.match(go[0]!.message, /undefined/);
  const py = checkProblems(checks('  File "/tmp/work/solution.py", line 2, in broken\n    return missing\nNameError: name missing is not defined'), files);
  assert.equal(py[0]!.path, "solution.py");
  assert.equal(location(files[1]!.content, py[0]!.from).line, 2);
  const hidden = checkProblems(checks(".reference/secret.ts(2,1): error: nope"), files);
  assert.ok(hidden.every((p) => p.path === ""));
  assert.ok(checkProblems(checks(".reference/src/solution.ts(2,1): error: hidden"), files).every((p) => p.path === ""));
});

test("Problems handle Rust locations, warnings, repeated diagnostics and location-free failures", () => {
  const file = { path: "src/lib.rs", content: "pub fn add() {\n missing\n}" };
  const rust = checkProblems(checks("error[E0425]: cannot find value `missing`\n --> src/lib.rs:2:2"), [file]);
  assert.match(rust[0]!.message, /cannot find/);
  const go = checkProblems(checks("solution.go:2:17: warning: unused\nsolution.go:2:17: warning: unused"), files);
  assert.equal(go.length, 1);
  assert.equal(go[0]!.severity, "warning");
  assert.equal(checkProblems(checks("FAIL expected 4, got 5"), files)[0]!.path, "");
  assert.equal(position("a\nxyz", 200, 200), 5);
  const node = checkProblems(checks("TypeError: not callable\n    at file:///work/solution.go:2:17"), files);
  assert.match(node[0]!.message, /not callable/);
});
