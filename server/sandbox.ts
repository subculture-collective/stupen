import { execFile, spawn } from "node:child_process";
import { access, constants, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { config } from "./config.ts";
import { type Command, RUNNERS } from "./runners.ts";

const run = promisify(execFile);
const home = homedir();

export type CheckResult = { command: string; exitCode: number | null; output: string; durationMs: number; timedOut: boolean };
export type Checks = { at: string; results: CheckResult[]; passed: boolean; sandboxed: boolean };

type Toolchain = { path: string[]; binds: string[]; env: Record<string, string>; bwrap: boolean };
let toolchain: Promise<Toolchain> | undefined;

async function exists(p: string) {
  return access(p, constants.X_OK).then(() => true, () => false);
}

/**
 * Where compilers and runtimes live. mise installs are under the home folder,
 * which the sandbox hides, so their folders are mounted back read-only.
 */
function detect(): Promise<Toolchain> {
  toolchain ??= (async () => {
    const mise = await run("mise", ["bin-paths"], { timeout: 15_000 }).then((r) => r.stdout.split("\n").filter(Boolean), () => [] as string[]);
    const cargo = join(home, ".cargo/bin");
    const path = [...mise, cargo, "/usr/local/bin", "/usr/bin", "/bin"];
    const binds = [join(home, ".local/share/mise/installs"), join(home, ".rustup"), cargo, config.toolsDir, join(config.appDir, "node_modules")];
    const env: Record<string, string> = {
      PATH: path.join(":"),
      RUSTUP_HOME: join(home, ".rustup"),
      RUSTUP_TOOLCHAIN: "stable",
      CARGO_HOME: "/tmp/cargo",
      CARGO_TARGET_DIR: "/tmp/target",
      GOCACHE: "/tmp/go-cache",
      GOPATH: "/tmp/go",
      GOFLAGS: "-mod=mod",
      GOTOOLCHAIN: "local",
      GOPROXY: "off",
      GOTELEMETRY: "off",
      PYTHONDONTWRITEBYTECODE: "1",
      LANG: "C.UTF-8",
    };
    const bwrap = config.sandbox && (await exists("/usr/bin/bwrap"));
    return { path, binds, env, bwrap };
  })();
  return toolchain;
}

async function which(bin: string, path: string[]): Promise<boolean> {
  for (const dir of path) if (await exists(join(dir, bin))) return true;
  return false;
}

/** Which runners can check code on this host, and why not when they cannot. */
export async function runnerAvailability(): Promise<Record<string, { ok: boolean; detail?: string }>> {
  const tc = await detect();
  const out: Record<string, { ok: boolean; detail?: string }> = {};
  for (const r of RUNNERS) {
    const missing: string[] = [];
    for (const b of r.needs) if (!(await which(b, tc.path))) missing.push(b);
    if ((r.id === "python" || r.id === "sql") && !(await exists(join(config.toolsDir, "py/bin/python")))) missing.push("pytest venv (run pnpm setup:tools)");
    out[r.id] = missing.length ? { ok: false, detail: `missing ${missing.join(", ")}` } : { ok: true };
  }
  return out;
}

export async function sandboxStatus(): Promise<{ sandboxed: boolean; detail: string }> {
  const tc = await detect();
  if (tc.bwrap) return { sandboxed: true, detail: "Checks run in bubblewrap: no network, no home folder, a fresh copy of the lesson each run." };
  return { sandboxed: false, detail: config.sandbox ? "bubblewrap is not installed, so checks run unsandboxed as the server user." : "Sandbox disabled (STUDY_SANDBOX=0): checks run as the server user." };
}

function bwrapArgs(tc: Toolchain, work: string): string[] {
  const args = ["--ro-bind", "/", "/"];
  // Hide everything personal or shared: home folders, sockets, data disks.
  for (const d of ["/home", "/root", "/run", "/tmp", "/var/tmp", "/mnt", "/media", "/srv"]) args.push("--tmpfs", d);
  for (const b of tc.binds) args.push("--ro-bind-try", b, b);
  args.push("--bind", work, "/tmp/work", "--dev", "/dev", "--proc", "/proc");
  args.push("--unshare-all", "--die-with-parent", "--new-session", "--chdir", "/tmp/work");
  args.push("--setenv", "HOME", "/tmp/home");
  for (const [k, v] of Object.entries(tc.env)) args.push("--setenv", k, v);
  return args;
}

function runOne(tc: Toolchain, work: string, cmd: Command, timeoutMs: number, maxOutput = 100_000): Promise<CheckResult> {
  const started = Date.now();
  const [bin, args] = tc.bwrap
    ? ["/usr/bin/bwrap", [...bwrapArgs(tc, work), ...cmd.argv]]
    : [cmd.argv[0]!, cmd.argv.slice(1)];
  return new Promise((done) => {
    const child = spawn(bin, args, {
      cwd: work,
      env: tc.bwrap ? { PATH: tc.env.PATH! } : { ...process.env, ...tc.env, HOME: join(work, ".home"), CARGO_HOME: join(work, ".cargo"), CARGO_TARGET_DIR: join(work, ".target"), GOCACHE: join(work, ".gocache"), GOPATH: join(work, ".gopath") },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    const add = (b: Buffer) => {
      if (output.length < maxOutput) output += b.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const label = cmd.label ?? cmd.argv.join(" ");
      done({ command: label, exitCode, output: output.replaceAll(work, ".").replaceAll("/tmp/work/", "./"), durationMs: Date.now() - started, timedOut });
    };
    child.on("error", (err) => {
      output += String(err);
      finish(null);
    });
    child.on("close", finish);
  });
}

/**
 * Run commands against a throwaway copy of `dir`, so code under test cannot
 * change the tests or anything else in the lesson.
 */
export async function runChecksIn(dir: string, commands: Command[], opts: { overlay?: Record<string, string> } = {}): Promise<Checks> {
  const tc = await detect();
  const base = join(tmpdir(), "study-coach-runs");
  await mkdir(base, { recursive: true });
  const work = await mkdtemp(join(base, "run-"));
  try {
    await cp(dir, work, { recursive: true, filter: (src) => !/\/\.(reference|meta)(\/|$)/.test(src) });
    if (opts.overlay) {
      const { writeFile } = await import("node:fs/promises");
      for (const [rel, content] of Object.entries(opts.overlay)) {
        await mkdir(join(work, rel, ".."), { recursive: true });
        await writeFile(join(work, rel), content);
      }
    }
    const results: CheckResult[] = [];
    for (const cmd of commands) {
      const r = await runOne(tc, work, cmd, config.checkTimeoutMs);
      results.push(r);
      if (r.timedOut) break;
    }
    return { at: new Date().toISOString(), results, passed: results.length > 0 && results.every((r) => r.exitCode === 0), sandboxed: tc.bwrap };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Run one command with `files` in a fresh sandboxed folder and return its
 * output. Used to extract text from uploaded documents without trusting them.
 */
export async function sandboxed(files: Record<string, Buffer | string>, argv: string[], maxOutput = 3_000_000): Promise<CheckResult> {
  const tc = await detect();
  const base = join(tmpdir(), "study-coach-runs");
  await mkdir(base, { recursive: true });
  const work = await mkdtemp(join(base, "x-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    for (const [name, data] of Object.entries(files)) await writeFile(join(work, name), data);
    // "@python" is the tools venv's Python on whichever machine runs this.
    const resolved = argv.map((a, i) => (i === 0 && a === "@python" ? join(config.toolsDir, "py/bin/python") : a));
    return await runOne(tc, work, { argv: resolved }, 60_000, maxOutput);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
