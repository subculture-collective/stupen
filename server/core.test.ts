import assert from "node:assert/strict";
import { test } from "node:test";

import { HeaderParser } from "./coach.ts";
import { blockedAddress, htmlToText } from "./fetch.ts";
import { runner } from "./runners.ts";
import { safeRel, slugify } from "./util.ts";

test("header parser strips ASSIST and VERDICT lines, streamed in pieces", () => {
  const p = new HeaderParser();
  const out = ["ASS", "IST: 3\nVERDICT: pa", "ss\nWell done.", " More."].map((x) => p.feed(x)).join("") + p.flush();
  assert.equal(out, "Well done. More.");
  assert.equal(p.level, 3);
  assert.equal(p.verdict, "pass");
});

test("header parser leaves replies without a header alone", () => {
  const p = new HeaderParser();
  const out = p.feed("Hello there, this reply has no header line at all and keeps going for a while longer than the hold limit.\nSecond line") + p.flush();
  assert.match(out, /^Hello there/);
  assert.equal(p.level, undefined);
});

test("private, loopback and link-local addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.0.0.50", "192.168.1.1", "172.20.0.2", "169.254.169.254", "100.65.164.66", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
    assert.equal(blockedAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"]) assert.equal(blockedAddress(ip), false, ip);
});

test("html to text keeps headings, code and links and drops scripts", () => {
  const { title, text } = htmlToText(
    `<html><head><title>Guide &amp; more</title><script>evil()</script></head><body><nav>menu</nav><main><h2>Loops</h2><p>Use <code>for</code> &lt;3</p><pre>for x in y:\n  pass</pre><a href="https://example.com/a">next</a></main></body></html>`,
  );
  assert.equal(title, "Guide & more");
  assert.match(text, /## Loops/);
  assert.match(text, /`for` <3/);
  assert.match(text, /```\nfor x in y:/);
  assert.match(text, /\[next\]\(https:\/\/example.com\/a\)/);
  assert.doesNotMatch(text, /evil|menu/);
});

test("lesson paths must be plain relative paths", () => {
  for (const ok of ["solution.py", "src/lib.rs", "tests/solution.rs"]) assert.equal(safeRel(ok), true, ok);
  for (const bad of ["../x", "/etc/passwd", ".hidden", "a/../b", "a\\b", "x/.git/config", ""]) assert.equal(safeRel(bad), false, bad);
});

test("slugs cut at a word boundary", () => {
  assert.equal(slugify("Reading command-line arguments into a config struct", 40), "reading-command-line-arguments-into-a");
  assert.equal(slugify("¡Hola, señor!"), "hola-senor");
});

test("runners keep tests read-only", () => {
  assert.equal(runner("python").editable("solution.py"), true);
  assert.equal(runner("python").editable("test_solution.py"), false);
  assert.equal(runner("go").editable("solution_test.go"), false);
  assert.equal(runner("rust").editable("tests/solution.rs"), false);
  assert.equal(runner("rust").editable("src/lib.rs"), true);
  assert.equal(runner("typescript").editable("solution.test.ts"), false);
  assert.equal(runner("java").editable("SolutionTest.java"), false);
  assert.equal(runner("c").editable("test_solution.c"), false);
  assert.equal(runner("sql").editable("schema.sql"), false);
  assert.equal(runner("written").editable("answer.md"), true);
});
