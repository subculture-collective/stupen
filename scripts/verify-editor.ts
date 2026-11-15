/** Browser conformance check against a local Vite server, with isolated lesson API fixtures. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import type { LessonMeta, Me, Track, TrackState } from "../web/src/api.ts";

const base = process.env.BASE ?? "http://127.0.0.1:5198";
const prefix = new URL(base).pathname.replace(/\/$/, "");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/google/chrome/chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const code: Record<string, string> = {
  "solution.ts": 'const value: number = "wrong";\nconst greeting = "hello";\ngreeting.toUpperCase();\n',
  "helpers.ts": '/** Double a value. */\nexport function double(n: number) { return n * 2; }\n',
  "solution.go": 'package lesson\nimport "fmt"\n\n// greet prints a message.\nfunc greet() {\n fmt.Println("hello")\n}\n',
  "solution.py": 'def total(values):\n    """Sum the supplied values."""\n    return sum(values)\n\nprint(len([1, 2]))\n',
  "data.json": '{"valid": true}\n',
  "solution.test.ts": 'import { test } from "node:test";\n',
};
const track: Track = { id: "editor-check", title: "Editor checks", subject: "Programming", runner: "typescript", level: "beginner", goals: "Practise", background: "", style: "", sessionMinutes: 20, defaultCeiling: 0, provider: "claude", web: false, createdAt: "", updatedAt: "" };
const meta: LessonMeta = { id: "01-editor", title: "Editor lesson", objective: "Practise editing", brief: "Edit the solution.\n\n" + "Read this lesson while coding.\n\n".repeat(80), hints: [], sources: [], files: Object.keys(code).map((path) => ({ path, role: path.includes(".test.") ? "test" : "starter" })), createdAt: "", status: "started", attempts: 0, verified: true };
const state: TrackState = { track, plan: "", outline: { lessons: [], sources: [], updatedAt: "" }, notes: "", history: [], lessons: [{ ...meta, help: null, lastPassed: null }], materials: [], jobs: [] };
const me: Me = { user: "fixture", authMode: "proxy", isAdmin: false, sandbox: { sandboxed: true, detail: "Fixture" }, docker: { ok: false }, runners: [{ id: "typescript", label: "TypeScript", syntax: "typescript", layout: "", graded: null, ok: true }], environments: [], levels: [] };

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname.slice(prefix.length);
  let data: unknown;
  if (path === "/api/auth/config") data = { mode: "proxy" };
  else if (path === "/api/me") data = me;
  else if (path === "/api/models") data = { choices: [], kinds: [], connections: [] };
  else if (path === "/api/providers") data = {};
  else if (path === "/api/tracks") data = [track];
  else if (path === "/api/prompts") data = { prompts: [], triggers: {}, placeholders: {} };
  else if (path === "/api/tracks/editor-check") data = state;
  else if (path.endsWith("/01-editor")) data = { meta, files: meta.files.map((f) => ({ ...f, editable: f.role !== "test" })), help: null };
  else if (path.endsWith("/file")) {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { path: string; content: string };
      code[body.path] = body.content;
      data = { ok: true };
    } else data = { content: code[url.searchParams.get("path")!] };
  } else if (path.endsWith("/check")) data = { meta, firstPass: false, checks: { at: "", passed: false, sandboxed: true, results: [{ command: "go test", exitCode: 1, durationMs: 1, timedOut: false, output: "./solution.go:6:2: undefined: missing" }] } };
  else throw new Error(`Unexpected fixture request: ${path}`);
  await route.fulfill({ json: data });
});

const openFile = async (path: string) => {
  await page.locator(".tabs").getByRole("tab").filter({ hasText: path }).click();
  const readOnly = meta.files.find((f) => f.path === path)?.role === "test";
  await page.getByRole("textbox", { name: `${path}${readOnly ? " (read-only)" : ""}`, exact: true }).waitFor();
};
const replace = async (text: string) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
};
const waitFor = (test: () => boolean) => page.waitForFunction(test, undefined, { timeout: 20_000 });

try {
  await page.goto(`${base}/#/t/${track.id}/learn/${meta.id}`);
  await page.locator(".cm-content").waitFor();
  await page.getByRole("tab", { name: /^Problems/ }).click();
  await page.getByRole("button", { name: /solution.ts:1:.*Type 'string' is not assignable/ }).waitFor({ timeout: 30_000 });
  assert.ok(await page.locator(".cm-lintRange-error").count(), "TypeScript error underline");
  await page.getByRole("button", { name: /solution.ts:1:.*Type 'string' is not assignable/ }).click();
  assert.equal(await page.locator(".cm-content").evaluate((e) => e === document.activeElement), true);

  await replace('const text = "hello";\ntext.');
  await page.keyboard.type("toU");
  await page.getByRole("option", { name: /toUpperCase/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("option", { name: /toUpperCase/ }).click();
  assert.match(await page.locator(".cm-content").innerText(), /text.toUpperCase$/);
  await page.keyboard.press("Escape");
  await replace('const text = "hello";\ntext.toUpperCase();');
  await page.locator(".cm-line").filter({ hasText: "text.toUpperCase" }).getByText("toUpperCase", { exact: true }).hover();
  await page.locator(".code-documentation").filter({ hasText: /upper/i }).waitFor();

  await replace("const count = 1;\nconsole.log(count);\n");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  for (let n = 0; n < 6; n++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.insertText("total");
  assert.match(await page.locator(".cm-content").innerText(), /const total = 1;\nconsole.log\(total\)/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Home");
  for (let n = 0; n < 7; n++) await page.keyboard.press("ArrowRight");
  await waitFor(() => document.querySelectorAll(".cm-selectionMatch").length > 0);

  await replace("");
  await page.keyboard.type("(");
  assert.equal(await page.locator(".cm-content").innerText(), "()");
  await replace("");
  await page.keyboard.type('"');
  assert.equal(await page.locator(".cm-content").innerText(), '""');
  await replace("const valid = 2;\n");
  await page.getByRole("tab", { name: "Problems (0)", exact: true }).waitFor();
  console.log("PASS: TypeScript completion, hover, diagnostics, multiple cursors, word matches, bracket/quote closing");

  await openFile("solution.go");
  await page.locator(".cm-line").filter({ hasText: "fmt.Println" }).getByText("Println", { exact: true }).hover();
  await page.locator(".code-documentation").filter({ hasText: /newline/i }).waitFor();
  await replace('package lesson\nimport "fmt"\nfunc main() { fmt.Pri');
  await page.keyboard.press("Control+Space");
  await page.getByRole("option", { name: /Println/ }).waitFor();
  await page.keyboard.press("Escape");
  await replace('package lesson\nimport "fmt"\n\nfunc main() {\n\n missing()\n}\n');
  await page.getByRole("button", { name: /Run checks/ }).click();
  await page.getByRole("button", { name: /solution.go:6:2.*undefined: missing/ }).waitFor();
  await openFile("solution.ts");
  await page.getByRole("button", { name: /solution.go:6:2.*undefined: missing/ }).click();
  assert.equal(await page.getByRole("tab", { name: "solution.go", exact: true }).getAttribute("aria-selected"), "true");
  assert.ok(await page.locator(".cm-lintRange-error").count());
  await page.keyboard.insertText(" ");
  await waitFor(() => !document.querySelector(".problem-location")?.textContent?.includes("solution.go:6:2"));
  console.log("PASS: Go standard library completion/docs, check diagnostics, cross-file problem navigation, stale checks");

  await openFile("solution.py");
  await page.locator(".cm-line").filter({ hasText: "print(len" }).getByText("len", { exact: true }).hover();
  await page.locator(".code-documentation").filter({ hasText: /number of items/ }).waitFor();
  await replace("values = [1, 2]\nle");
  await page.keyboard.press("Control+Space");
  await page.getByRole("option", { name: /^len\b/ }).waitFor();
  await page.keyboard.press("Escape");
  await replace('def total(values):\n    """Sum the supplied values."""\n    return sum(values)\n\ntotal([1, 2])');
  await page.locator(".cm-line").last().getByText("total", { exact: true }).hover();
  await page.locator(".code-documentation").filter({ hasText: "Sum the supplied values." }).waitFor();
  console.log("PASS: Python completion, builtin hover and local docstrings");

  const coach = page.getByRole("separator", { name: "Resize coach panel" });
  await page.getByRole("button", { name: "Expand coach panel" }).click();
  await coach.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await coach.getAttribute("aria-valuenow"), "410");
  const description = page.getByRole("separator", { name: "Resize description panel" });
  const box = (await description.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 80);
  await page.mouse.up();
  assert.equal(await description.getAttribute("aria-valuenow"), "420");
  const results = page.getByRole("separator", { name: "Resize results panel" });
  await results.focus();
  await page.keyboard.press("ArrowUp");
  assert.equal(await results.getAttribute("aria-valuenow"), "220");
  await page.getByRole("button", { name: "Collapse results panel" }).click();
  assert.equal(await results.count(), 0);
  await page.getByRole("button", { name: "Expand results panel" }).click();
  await page.getByRole("button", { name: "Collapse coach panel" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Expand coach panel" }).click();
  assert.equal(await description.getAttribute("aria-valuenow"), "420");
  assert.equal(await coach.getAttribute("aria-valuenow"), "410");
  console.log("PASS: keyboard/pointer resizing, collapse/expand and persisted sizes");

  // The two content panes scroll independently; controls and results stay in reach.
  await page.getByRole("button", { name: "Collapse coach panel" }).click();
  await replace(Array.from({ length: 160 }, (_, i) => `# Code line ${i}`).join("\n"));
  for (const viewport of [{ width: 1153, height: 814 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const reading = page.getByRole("region", { name: "Description", exact: true });
    const codePane = page.getByRole("region", { name: "Code", exact: true });
    const r = (await reading.boundingBox())!;
    const c = (await codePane.boundingBox())!;
    assert.ok(r.width >= 220 && c.width >= 300 && r.x + r.width <= c.x, "reading and code remain side by side");
    const toolbar = (await page.getByRole("button", { name: /Run checks/ }).boundingBox())!;
    assert.ok(toolbar.y >= 0 && toolbar.y + toolbar.height <= viewport.height);
    await page.locator(".brief").evaluate((e) => { e.scrollTop = 500; });
    assert.ok(await page.locator(".brief").evaluate((e) => e.scrollTop) > 0);
    await page.locator(".cm-scroller").evaluate((e) => { e.scrollTop = 400; });
    assert.ok(await page.locator(".cm-scroller").evaluate((e) => e.scrollTop) > 0);
    assert.equal(await page.locator(".brief").evaluate((e) => e.scrollTop), 500);
    await page.locator(".cm-scroller").evaluate((e) => { e.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole("button", { name: "Problem List", exact: true }).click();
  await page.getByRole("dialog", { name: "Problem List" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Problem List", exact: true }).evaluate((e) => e === document.activeElement), true);
  await page.getByRole("button", { name: "Problem List", exact: true }).click();
  assert.match(await page.getByRole("link", { name: /Editor lesson/ }).getAttribute("href") ?? "", /learn\/01-editor$/);
  await page.getByRole("link", { name: /Editor lesson/ }).click();
  assert.equal(await page.getByRole("dialog", { name: "Problem List" }).count(), 0);
  await page.getByRole("button", { name: "Expand coach panel" }).click();
  const draft = page.getByRole("textbox", { name: "Message to the coach" });
  await draft.fill("Keep my question");
  await page.getByRole("combobox", { name: "Help limit" }).selectOption("2");
  await page.getByRole("button", { name: "Collapse coach panel" }).click();
  await page.getByRole("button", { name: "Expand coach panel" }).click();
  assert.equal(await draft.inputValue(), "Keep my question");
  assert.equal(await page.getByRole("combobox", { name: "Help limit" }).inputValue(), "2");
  console.log("PASS: split desktop sizes, independent reading scroll, persistent toolbar, Problem List route and folded coach state");

  await openFile("solution.test.ts");
  const before = await page.locator(".cm-content").innerText();
  await page.locator(".cm-content").click();
  await page.keyboard.type("cannot edit");
  assert.equal(await page.locator(".cm-content").innerText(), before);
  await openFile("data.json");
  await replace('{"broken": }');
  await page.getByRole("tab", { name: /^Problems/ }).click();
  await page.getByRole("button", { name: /data.json:.*JSON|data.json:.*Unexpected/ }).waitFor();
  console.log("PASS: read-only tests and JSON diagnostics");

  mkdirSync("captures", { recursive: true });
  await page.screenshot({ path: "captures/editor-desktop.png" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: "captures/editor-dark.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  assert.equal(await description.count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("tab", { name: "Description", exact: true }).click();
  await page.getByRole("region", { name: "Description", exact: true }).waitFor();
  assert.equal(await page.locator(".cm-content").isVisible(), false);
  await page.getByRole("tab", { name: "Coach", exact: true }).click();
  await page.locator(".coach").waitFor();
  assert.equal(await draft.inputValue(), "Keep my question");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /broken/);
  await page.getByRole("tab", { name: "Code", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Coach", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await page.getByRole("tab", { name: "Description", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page.screenshot({ path: "captures/editor-phone.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: narrow layout, dark theme, no browser errors");
} catch (error) {
  mkdirSync("captures", { recursive: true });
  await page.screenshot({ path: "captures/editor-failure.png" });
  console.error(await page.locator(".results-panel").innerText().catch(() => "No results panel"));
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
