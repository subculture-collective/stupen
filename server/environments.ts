import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "./config.ts";
import { HttpError } from "./util.ts";

/**
 * A container environment for a track. Lessons run in a copy of their folder
 * at /work; /cache is the lesson's persistent dependency cache.
 *
 * - setup: shell run once as root when the image is prepared (apt-get install …); the result is kept as a local image.
 * - install: run when a manifest file changes, with internet access through the egress proxy; put dependencies in /cache.
 * - check: run for every check, offline unless checkNetwork is set.
 * - preview: optional; must write a self-contained /out/index.html (see /opt/study/preview-inline.mjs).
 */
export type Environment = {
  preset?: string;
  label: string;
  image: string;
  setup: string;
  install: string;
  check: string;
  preview: string;
  manifests: string[];
  /** File conventions for the lesson writer. */
  layout: string;
  /** Editor syntax for learner files. */
  syntax: string;
  checkNetwork: boolean;
  env: Record<string, string>;
  /** Docker memory limit, such as "3g". */
  memory: string;
  cpus: number;
  timeoutSec: number;
};

const BASE: Omit<Environment, "label" | "image" | "install" | "check" | "layout" | "syntax"> = {
  setup: "",
  preview: "",
  manifests: [],
  checkNetwork: false,
  env: {},
  memory: "3g",
  cpus: 2,
  timeoutSec: 300,
};

const VITE_PREVIEW =
  'ln -sfn /cache/node_modules node_modules && npx vite build --base ./ --outDir /tmp/preview-dist --emptyOutDir --logLevel warn && node /opt/study/preview-inline.mjs /tmp/preview-dist /out/index.html';
const NODE_INSTALL = "npm install --no-audit --no-fund --loglevel=error && rm -rf /cache/node_modules && cp -a node_modules /cache/node_modules";

export const PRESETS: Environment[] = [
  {
    ...BASE,
    preset: "react",
    label: "React + Vite (TypeScript, any npm packages)",
    image: "node:24-bookworm",
    manifests: ["package.json", "package-lock.json"],
    install: NODE_INSTALL,
    check: "ln -sfn /cache/node_modules node_modules && npm test --silent",
    preview: VITE_PREVIEW,
    env: { npm_config_cache: "/cache/.npm", CI: "1" },
    syntax: "typescript",
    layout: `A Vite + React 19 app in TypeScript.
- package.json: "type": "module"; scripts "test": "vitest run" and "build": "vite build"; dependencies react and react-dom; devDependencies vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, typescript, @types/react and @types/react-dom. Use caret ranges of current major versions. Add any other npm package the lesson needs.
- vite.config.ts: the react plugin; test: { environment: "jsdom", globals: true, setupFiles: "./src/setupTests.ts" } (setupTests imports "@testing-library/jest-dom/vitest"); build: { cssCodeSplit: false, assetsInlineLimit: 100000000, rollupOptions: { output: { inlineDynamicImports: true } } } so the preview can be one file.
- index.html at the root loading /src/main.tsx; components in src/; tests in src/*.test.tsx that render components and act like a user. Tests must not use the network.
- The learner sees a live preview built from index.html, so give the app something visible.`,
  },
  {
    ...BASE,
    preset: "web",
    label: "Web page (HTML, CSS, JavaScript)",
    image: "node:24-bookworm",
    manifests: ["package.json", "package-lock.json"],
    install: NODE_INSTALL,
    check: "ln -sfn /cache/node_modules node_modules && npm test --silent",
    preview: "node /opt/study/preview-inline.mjs . /out/index.html",
    env: { npm_config_cache: "/cache/.npm", CI: "1" },
    syntax: "html",
    layout: `A plain web page: index.html, style.css and script.js (the learner's files; script.js uses ES modules and exports the functions under test). Tests: package.json ("type": "module", script "test": "vitest run", devDependencies vitest and jsdom) and tests/page.test.js using a jsdom environment that loads index.html and script.js. Tests must not use the network. The learner sees a live preview of index.html.`,
  },
  {
    ...BASE,
    preset: "node",
    label: "Node.js + TypeScript (any npm packages)",
    image: "node:24-bookworm",
    manifests: ["package.json", "package-lock.json"],
    install: NODE_INSTALL,
    check: "ln -sfn /cache/node_modules node_modules && npm test --silent",
    env: { npm_config_cache: "/cache/.npm", CI: "1" },
    syntax: "typescript",
    layout: `A Node 24 project in TypeScript: package.json ("type": "module", script "test": "vitest run", devDependencies vitest and typescript plus @types/node, and any npm dependencies the lesson needs), src/*.ts for the learner's code and test/*.test.ts. Servers (Express, Fastify, Hono…) are tested in-process or on 127.0.0.1 with a random port; tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "python",
    label: "Python (any pip packages)",
    image: "python:3.13-bookworm",
    manifests: ["requirements.txt", "pyproject.toml"],
    install: 'python -m venv /cache/venv && /cache/venv/bin/pip install -q --disable-pip-version-check pytest $([ -f requirements.txt ] && echo "-r requirements.txt")',
    check: "/cache/venv/bin/python -m pytest -q -p no:cacheprovider --color=no",
    env: { PIP_CACHE_DIR: "/cache/.pip", PYTHONDONTWRITEBYTECODE: "1" },
    syntax: "python",
    layout: `Python 3.13: requirements.txt listing any packages the lesson needs (pandas, numpy, fastapi, httpx, flask, sqlalchemy…; pytest is always installed), the learner's modules at the root or in a package, and test_*.py pytest tests. Web apps are tested with their in-process test clients. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "go",
    label: "Go (any modules)",
    image: "golang:1.26",
    manifests: ["go.mod"],
    install: "go mod tidy && go mod download",
    check: "GOPROXY=off GOSUMDB=off go mod tidy >/dev/null 2>&1; go vet ./... && go test -v ./...",
    env: { GOPATH: "/cache/go", GOMODCACHE: "/cache/go/pkg/mod", GOCACHE: "/cache/go-build", GOTOOLCHAIN: "local", GOFLAGS: "-mod=mod" },
    syntax: "go",
    layout: `A Go module: go.mod ("module lesson", "go 1.26", require any modules the lesson needs; go.sum is created on install), the learner's code in *.go and table-driven tests in *_test.go with t.Run names. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "rust",
    label: "Rust (any crates)",
    image: "rust:1-bookworm",
    manifests: ["Cargo.toml"],
    install: "cargo fetch",
    check: "cargo test --offline --color never",
    env: { CARGO_HOME: "/cache/cargo", CARGO_TARGET_DIR: "/cache/target", CARGO_TERM_COLOR: "never" },
    syntax: "rust",
    layout: `A Cargo package: Cargo.toml ([package] name = "lesson", edition = "2021", and any crates the lesson needs under [dependencies] or [dev-dependencies]), src/lib.rs (and src/main.rs for binaries) for the learner's code, and tests in tests/*.rs. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "java",
    label: "Java + Maven (JUnit, any dependencies)",
    image: "maven:3-eclipse-temurin-21",
    manifests: ["pom.xml"],
    install:
      "mvn -B -q -s /opt/study/maven-settings.xml -Dmaven.repo.local=/cache/m2 -Dmaven.test.failure.ignore=true -DfailIfNoTests=false test >/dev/null 2>&1 || mvn -B -s /opt/study/maven-settings.xml -Dmaven.repo.local=/cache/m2 -DskipTests test-compile",
    check: "mvn -B -o --no-transfer-progress -Dmaven.repo.local=/cache/m2 -Dstyle.color=never test",
    env: { MAVEN_OPTS: "-Duser.home=/tmp/home" },
    syntax: "java",
    layout: `A Maven project: pom.xml (Java 21, JUnit 5 via junit-jupiter and maven-surefire-plugin 3.x, plus any dependencies the lesson needs), the learner's code in src/main/java/... and JUnit tests in src/test/java/.... Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "ruby",
    label: "Ruby (any gems)",
    image: "ruby:3.4",
    manifests: ["Gemfile", "Gemfile.lock"],
    install: '[ -f Gemfile ] && bundle install --quiet || echo "no Gemfile"',
    check: 'if [ -f Gemfile ]; then bundle exec rake test 2>/dev/null || bundle exec ruby -Ilib -Itest -e \'Dir["test/**/*_test.rb"].sort.each { |f| require File.expand_path(f) }\'; else ruby -Ilib -Itest -e \'Dir["test/**/*_test.rb"].sort.each { |f| require File.expand_path(f) }\'; fi',
    env: { BUNDLE_PATH: "/cache/bundle", BUNDLE_APP_CONFIG: "/tmp/home/.bundle", GEM_HOME: "/cache/gems" },
    syntax: "ruby",
    layout: `Ruby 3.4: a Gemfile (source "https://rubygems.org", gem "minitest" and any gems the lesson needs), the learner's code in lib/ and Minitest tests in test/*_test.rb that require_relative the code. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "php",
    label: "PHP + Composer (PHPUnit, any packages)",
    image: "composer:2",
    manifests: ["composer.json", "composer.lock"],
    install: "composer install --no-interaction --no-progress --quiet && rm -rf /cache/vendor && cp -a vendor /cache/vendor",
    check: "cp -a /cache/vendor vendor && vendor/bin/phpunit --colors=never",
    env: { COMPOSER_HOME: "/cache/composer" },
    syntax: "php",
    layout: `PHP 8: composer.json (require-dev phpunit/phpunit ^11, autoload psr-4 "App\\\\": "src/", plus any packages the lesson needs), the learner's classes in src/ and PHPUnit tests in tests/*Test.php, with phpunit.xml pointing at tests/. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "dotnet",
    label: "C# / .NET (xUnit, any NuGet packages)",
    image: "mcr.microsoft.com/dotnet/sdk:9.0",
    manifests: ["*.csproj", "*.sln"],
    install: "dotnet restore Lesson.Tests",
    check: "dotnet test Lesson.Tests --nologo",
    // dotnet test restores again from the package feed, so checks keep network access.
    checkNetwork: true,
    env: { NUGET_PACKAGES: "/cache/nuget", DOTNET_CLI_HOME: "/tmp/home", DOTNET_NOLOGO: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1" },
    syntax: "csharp",
    layout: `Two .NET 9 projects: Lesson/Lesson.csproj (class library with the learner's code) and Lesson.Tests/Lesson.Tests.csproj (xUnit with Microsoft.NET.Test.Sdk, xunit and xunit.runner.visualstudio, referencing ../Lesson/Lesson.csproj, plus any NuGet packages the lesson needs). No solution file is needed. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "elixir",
    label: "Elixir (ExUnit, any Hex packages)",
    image: "elixir:1.18",
    manifests: ["mix.exs", "mix.lock"],
    install: "mix local.hex --force --if-missing && mix local.rebar --force --if-missing && mix deps.get && mix deps.compile && cp mix.lock /cache/mix.lock",
    // The lock file is written on install, in a throwaway copy of the lesson; bring it back for the checks.
    check: "([ -f mix.lock ] || cp /cache/mix.lock . 2>/dev/null); mix test",
    env: { MIX_HOME: "/cache/mix", HEX_HOME: "/cache/hex", MIX_DEPS_PATH: "/cache/deps", MIX_BUILD_ROOT: "/cache/_build", MIX_ENV: "test" },
    syntax: "elixir",
    layout: `A Mix project: mix.exs (app :lesson, any Hex dependencies the lesson needs), the learner's code in lib/ and ExUnit tests in test/*_test.exs with test/test_helper.exs calling ExUnit.start(). Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "deno",
    label: "Deno (TypeScript, npm: and jsr: imports)",
    image: "denoland/deno:latest",
    manifests: ["deno.json", "deno.jsonc"],
    install: "deno install --quiet 2>/dev/null; deno test --no-run --quiet",
    check: "deno test --cached-only --allow-read --allow-env --no-check=remote",
    env: { DENO_DIR: "/cache/deno", DENO_NO_UPDATE_CHECK: "1" },
    syntax: "typescript",
    layout: `A Deno 2 project: deno.json with imports (jsr:@std/assert and any npm: or jsr: packages the lesson needs), the learner's code in *.ts and tests in *_test.ts using Deno.test. Tests must not use the internet.`,
  },
  {
    ...BASE,
    preset: "bun",
    label: "Bun (TypeScript, any npm packages)",
    image: "oven/bun:1",
    manifests: ["package.json", "bun.lock", "bun.lockb"],
    install: "bun install --silent && rm -rf /cache/node_modules && cp -a node_modules /cache/node_modules",
    check: "ln -sfn /cache/node_modules node_modules && bun test",
    env: { BUN_INSTALL_CACHE_DIR: "/cache/.bun" },
    syntax: "typescript",
    layout: `A Bun project: package.json with any npm packages the lesson needs, the learner's code in src/*.ts and tests in *.test.ts using "bun:test". Tests must not use the internet.`,
  },
];

/** Extra presets as JSON files in the repo's environments/ folder or the data folder's environments/. */
export function allPresets(): Environment[] {
  const extra: Environment[] = [];
  for (const dir of [join(config.appDir, "environments"), join(config.dataDir, "environments")]) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        extra.push(cleanEnvironment({ ...JSON.parse(readFileSync(join(dir, n), "utf8")), preset: n.replace(/\.json$/, "") }));
      } catch (e) {
        console.warn(`environment ${join(dir, n)}: ${(e as Error).message}`);
      }
    }
  }
  const ids = new Set(extra.map((e) => e.preset));
  return [...PRESETS.filter((p) => !ids.has(p.preset)), ...extra];
}

const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/** Validate an environment from a request or a JSON file. Commands are free text: they only ever run inside containers. */
export function cleanEnvironment(input: any, base?: Environment): Environment {
  const from = input?.preset && !input.image ? allPresets().find((p) => p.preset === input.preset) : undefined;
  const src = { ...BASE, ...(base ?? {}), ...(from ?? {}), ...(input ?? {}) };
  const image = text(src.image, 200).trim();
  if (!/^[a-z0-9][a-z0-9._/:@-]{0,199}$/i.test(image)) throw new HttpError(400, "the container image name looks wrong (for example node:24 or ghcr.io/owner/image:tag)");
  const memory = /^\d{1,3}[mg]$/i.test(String(src.memory ?? "")) ? String(src.memory).toLowerCase() : "3g";
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(src.env ?? {})) if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) env[k] = String(v).slice(0, 2000);
  const check = text(src.check, 4000).trim();
  if (!check) throw new HttpError(400, "the environment needs a check command");
  return {
    ...(src.preset ? { preset: text(src.preset, 60) } : {}),
    label: text(src.label, 80).trim() || image,
    image,
    setup: text(src.setup, 8000),
    install: text(src.install, 4000),
    check,
    preview: text(src.preview, 4000),
    manifests: (Array.isArray(src.manifests) ? src.manifests : String(src.manifests ?? "").split(/[,\s]+/))
      .map((m: unknown) => String(m).trim())
      .filter((m: string) => /^[\w.*-]{1,80}$/.test(m))
      .slice(0, 20),
    layout: text(src.layout, 6000),
    syntax: /^[a-z+#-]{1,20}$/.test(String(src.syntax ?? "")) ? String(src.syntax) : "plain",
    checkNetwork: Boolean(src.checkNetwork),
    env,
    memory,
    cpus: Math.min(8, Math.max(0.5, Number(src.cpus) || 2)),
    timeoutSec: Math.min(1800, Math.max(30, Math.trunc(Number(src.timeoutSec) || 300))),
  };
}
