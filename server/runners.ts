import { basename, join } from "node:path";

import { config } from "./config.ts";

export type Command = { argv: string[]; label?: string };

/**
 * How one kind of exercise is laid out and checked. The lesson generator is
 * given `layout`; the checker runs `commands` in a copy of the lesson folder.
 */
export type Runner = {
  id: string;
  label: string;
  /** Editor syntax for files of this runner (the web app maps it to a CodeMirror language). */
  syntax: string;
  /** Programs that must be installed for the checks to run. */
  needs: string[];
  /** File conventions, written for the lesson generator. */
  layout: string;
  /** True for files the learner writes; tests and support files stay read-only. */
  editable: (rel: string) => boolean;
  commands: (files: string[]) => Command[];
  /** Written answers are graded by the coach instead of commands. */
  graded?: "coach";
};

const py = () => join(config.toolsDir, "py/bin/python");
const PYTEST = (): Command => ({ argv: [py(), "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no"], label: "pytest -q" });
const isTestName = (name: string) => /(^|[._-])(test|tests|spec)([._-]|$)|^test|Test\.\w+$/.test(name);
const notInTests = (rel: string) => !rel.split("/").some((p) => p === "test" || p === "tests" || p === "spec");

const TSC_FLAGS = [
  "--noEmit", "--strict", "--target", "ES2023", "--module", "nodenext", "--moduleResolution", "nodenext",
  "--allowImportingTsExtensions", "--erasableSyntaxOnly", "--noUncheckedIndexedAccess", "--skipLibCheck", "--types", "node", "--typeRoots", join(config.appDir, "node_modules/@types"),
];

export const RUNNERS: Runner[] = [
  {
    id: "python",
    label: "Python",
    syntax: "python",
    needs: [],
    layout: "solution.py (the learner's code) and test_solution.py (pytest tests that import from solution). Standard library only. Python 3.13.",
    editable: (rel) => rel.endsWith(".py") && notInTests(rel) && !/^(test_.*|.*_test|conftest)\.py$/.test(basename(rel)),
    commands: () => [PYTEST()],
  },
  {
    id: "typescript",
    label: "TypeScript",
    syntax: "typescript",
    needs: ["node"],
    layout:
      "solution.ts (exports the learner's code) and solution.test.ts (uses node:test and node:assert/strict, imports from './solution.ts' with the .ts extension). Node 24 runs TypeScript by stripping types, so use only erasable syntax: no enums, namespaces or parameter properties. No npm packages.",
    editable: (rel) => /\.(ts|mts)$/.test(rel) && notInTests(rel) && !/\.(test|spec)\.m?ts$/.test(rel) && !rel.endsWith(".d.ts"),
    commands: (files) => {
      const ts = files.filter((f) => /\.m?ts$/.test(f) && !f.endsWith(".d.ts"));
      const tests = files.filter((f) => /\.(test|spec)\.m?ts$/.test(f));
      return [
        { argv: [join(config.appDir, "node_modules/.bin/tsc"), ...TSC_FLAGS, ...ts], label: "tsc --strict --noEmit" },
        { argv: ["node", "--test", ...tests], label: "node --test" },
      ];
    },
  },
  {
    id: "javascript",
    label: "JavaScript",
    syntax: "javascript",
    needs: ["node"],
    layout: "solution.mjs (exports the learner's code) and solution.test.mjs (uses node:test and node:assert/strict, imports from './solution.mjs'). No npm packages.",
    editable: (rel) => /\.(mjs|js)$/.test(rel) && notInTests(rel) && !/\.(test|spec)\.m?js$/.test(rel),
    commands: (files) => [{ argv: ["node", "--test", ...files.filter((f) => /\.(test|spec)\.m?js$/.test(f))], label: "node --test" }],
  },
  {
    id: "go",
    label: "Go",
    syntax: "go",
    needs: ["go"],
    layout: 'go.mod ("module lesson" and "go 1.24"), solution.go (package lesson) and solution_test.go (package lesson, standard testing package, table-driven tests with t.Run names). Standard library only.',
    editable: (rel) => rel.endsWith(".go") && !rel.endsWith("_test.go"),
    commands: () => [{ argv: ["go", "vet", "./..."] }, { argv: ["go", "test", "-v", "./..."] }],
  },
  {
    id: "rust",
    label: "Rust",
    syntax: "rust",
    needs: ["cargo"],
    layout: 'Cargo.toml ([package] name = "lesson", edition = "2021", no dependencies), src/lib.rs (the learner\'s code) and tests/solution.rs (integration tests using lesson::...).',
    editable: (rel) => rel.startsWith("src/") && rel.endsWith(".rs"),
    commands: () => [{ argv: ["cargo", "test", "--offline", "--quiet", "--color", "never"], label: "cargo test" }],
  },
  {
    id: "java",
    label: "Java",
    syntax: "java",
    needs: ["javac", "java"],
    layout:
      "Solution.java (public class Solution, the learner's code) and SolutionTest.java (public class SolutionTest with a main method that runs each case, prints PASS or FAIL with the case name, expected and actual values, and exits with status 1 if any case failed). No JUnit or other libraries. Default package.",
    editable: (rel) => rel.endsWith(".java") && !/Test\.java$/.test(rel),
    commands: () => [{ argv: ["bash", "-c", "mkdir -p .build && javac -d .build *.java && java -cp .build SolutionTest"], label: "javac && java SolutionTest" }],
  },
  {
    id: "c",
    label: "C",
    syntax: "c",
    needs: ["gcc"],
    layout:
      "solution.h (declarations, read-only), solution.c (the learner's code) and test_solution.c (a main that runs each case, prints PASS or FAIL with the case name, expected and actual values, and returns 1 if any failed). C17, standard library only.",
    editable: (rel) => rel.endsWith(".c") && !isTestName(basename(rel)),
    commands: () => [
      {
        argv: ["bash", "-c", "mkdir -p .build && gcc -std=c17 -Wall -Wextra -g -fsanitize=address,undefined -o .build/test *.c -lm && ./.build/test"],
        label: "gcc -std=c17 -Wall -Wextra -fsanitize=address,undefined && ./test",
      },
    ],
  },
  {
    id: "cpp",
    label: "C++",
    syntax: "cpp",
    needs: ["g++"],
    layout:
      "solution.hpp (declarations, read-only), solution.cpp (the learner's code) and test_solution.cpp (a main that runs each case, prints PASS or FAIL with the case name, expected and actual values, and returns 1 if any failed). C++20, standard library only.",
    editable: (rel) => /\.(cpp|cc)$/.test(rel) && !isTestName(basename(rel)),
    commands: () => [
      {
        argv: ["bash", "-c", "mkdir -p .build && g++ -std=c++20 -Wall -Wextra -g -fsanitize=address,undefined -o .build/test *.cpp && ./.build/test"],
        label: "g++ -std=c++20 -Wall -Wextra -fsanitize=address,undefined && ./test",
      },
    ],
  },
  {
    id: "sql",
    label: "SQL (SQLite)",
    syntax: "sql",
    needs: [],
    layout:
      "schema.sql (tables and sample rows, read-only), solution.sql (the learner's single query) and test_solution.py (pytest: builds an in-memory sqlite3 database from schema.sql, runs solution.sql and compares the rows, with a clear message showing expected and actual rows).",
    editable: (rel) => rel === "solution.sql" || /^query.*\.sql$/.test(rel),
    commands: () => [PYTEST()],
  },
  {
    id: "bash",
    label: "Bash",
    syntax: "shell",
    needs: ["bash"],
    layout:
      "solution.sh (defines functions; the learner's code) and test_solution.sh (sources solution.sh, runs each case, prints PASS or FAIL with the case name, expected and actual output, exits 1 if any failed). Bash 5, coreutils only.",
    editable: (rel) => rel.endsWith(".sh") && !isTestName(basename(rel)),
    commands: () => [{ argv: ["bash", "test_solution.sh"] }],
  },
  {
    id: "written",
    label: "Written answers (any subject)",
    syntax: "markdown",
    needs: [],
    layout:
      "answer.md (the learner writes the answers under the headings you provide). No tests: the coach grades the answer against the brief. Use this for concepts, design, maths, natural languages or anything without a test runner.",
    editable: (rel) => rel.endsWith(".md") || rel.endsWith(".txt"),
    commands: () => [],
    graded: "coach",
  },
  {
    id: "container",
    label: "Container (any language, any packages)",
    syntax: "plain",
    needs: [],
    layout: "",
    editable: (rel) => notInTests(rel) && !isTestName(basename(rel)),
    commands: () => [],
  },
  {
    id: "custom",
    label: "Other (my own check command)",
    syntax: "plain",
    needs: ["bash"],
    layout: "Use the file layout and test style that the learner's check command expects (given below). Keep the learner's code and the tests in separate files.",
    editable: (rel) => notInTests(rel) && !isTestName(basename(rel)),
    commands: () => [],
  },
];

/** The file conventions for a track, including its container environment. */
export function layoutFor(t: { runner: string; customCommand?: string | undefined; environment?: { label: string; image: string; layout: string; check: string; checkNetwork: boolean; preview: string } | undefined }): string {
  const r = runner(t.runner);
  if (r.id === "container" && t.environment) {
    const e = t.environment;
    return `${e.layout || "Any layout that the check command below can test."}\nThe lesson runs in the Docker image ${e.image}. Dependencies listed in the project's manifest files are installed with internet access before the checks; the checks then run ${e.checkNetwork ? "with" : "without"} network access, using: ${e.check}${e.preview ? "\nThe learner also gets a live preview built from the project." : ""}`;
  }
  if (r.id === "custom") return `${r.layout}\nThe learner's check command, run in the lesson folder: ${t.customCommand ?? "(none set)"}`;
  return r.layout;
}

export function runner(id: string): Runner {
  return RUNNERS.find((r) => r.id === id) ?? RUNNERS.find((r) => r.id === "written")!;
}

/** The check commands for a lesson, including a custom track command. */
export function lessonCommands(r: Runner, files: string[], customCommand?: string): Command[] {
  if (r.id === "custom") return customCommand ? [{ argv: ["bash", "-c", customCommand], label: customCommand }] : [];
  return r.commands(files);
}
