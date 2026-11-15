import { execFile, spawn } from "node:child_process";
import { access, constants, cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    const nodeDir = dirname(await realpath(process.execPath));
    const cargo = join(home, ".cargo/bin");
    const path = [nodeDir, ...mise, cargo, "/usr/local/bin", "/usr/bin", "/bin"];
    const binds = [nodeDir, join(home, ".local/share/mise/installs"), join(home, ".rustup"), cargo, config.toolsDir, join(config.appDir, "node_modules")];
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

function bwrapArgs(tc: Toolchain, work: string, strict = false): string[] {
  const args = strict ? ["--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin", "--ro-bind-try", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64"] : ["--ro-bind", "/", "/"];
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


export type PracticeProcess = { exitCode: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; outputTruncated: boolean };

/** Practice always requires isolation, and never inherits app credentials or mounts /etc. */
export async function practiceProcess(work: string, argv: string[], timeoutMs: number, maxOutput = 16_384, signal?: AbortSignal): Promise<PracticeProcess> {
  signal?.throwIfAborted();
  const tc = await detect();
  if (!tc.bwrap) throw Object.assign(new Error("Practice needs a working bubblewrap sandbox."), { status: 503 });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/bwrap", [...bwrapArgs(tc, work, true), ...argv], { cwd: work, env: { PATH: tc.env.PATH! }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
    let size = 0, timedOut = false, outputTruncated = false;
    const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const add = (stream: "stdout" | "stderr", data: Buffer) => {
      const room = Math.max(0, maxOutput - size);
      chunks[stream].push(data.subarray(0, room));
      size += Math.min(room, data.length);
      if (data.length > room) { outputTruncated = true; kill(); }
    };
    child.stdout.on("data", (b: Buffer) => add("stdout", b));
    child.stderr.on("data", (b: Buffer) => add("stderr", b));
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, timeoutMs));
    child.once("error", (e) => { clearTimeout(timer); kill(); reject(e); });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      kill();
      if (signal?.aborted) { reject(signal.reason); return; }
      // A clipped UTF-8 sequence must not expand past the byte budget during decoding.
      const decode = (buffers: Buffer[]) => Buffer.concat(buffers).toString("utf8").replace(/\uFFFD/g, "");
      resolve({ exitCode, stdout: decode(chunks.stdout), stderr: decode(chunks.stderr), durationMs: Date.now() - started, timedOut, outputTruncated });
    });
  });
}

let practiceReady: Promise<import("../shared/practiceRun.ts").PracticeCapability | undefined> | undefined;
export function practiceCapability(): Promise<import("../shared/practiceRun.ts").PracticeCapability | undefined> {
  practiceReady ??= (async () => {
    if (!(await detect()).bwrap) return;
    const work = await mkdtemp(join(tmpdir(), "stupen-practice-probe-"));
    try {
      if ((await practiceProcess(work, ["node", "-e", "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)"], 2000)).exitCode !== 0) return;
      const runtimes = ["javascript"];
      if ((await practiceProcess(work, [join(config.appDir, "node_modules/.bin/tsc"), "--version"], 2000)).exitCode === 0) runtimes.push("typescript");
      return { version: 1 as const, runtimes };
    } catch { return; }
    finally { await rm(work, { recursive: true, force: true }); }
  })();
  return practiceReady;
}
