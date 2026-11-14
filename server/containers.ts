import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { config } from "./config.ts";
import type { Environment } from "./environments.ts";
import type { CheckResult, Checks } from "./sandbox.ts";

const run = promisify(execFile);

export const INTERNAL_NET = "study-coach-internal";
const EGRESS_NET = "study-coach-egress";
export const PROXY = "study-coach-egress-proxy";
/**
 * In the runner VM the egress proxy runs on the host, outside the VM, and the
 * VM reaches it at EGRESS_PROXY_URL; containers that need the internet then
 * join the VM's normal bridge, whose only way out is that proxy.
 */
const EXTERNAL_PROXY = process.env.EGRESS_PROXY_URL || undefined;
const PROXY_URL = EXTERNAL_PROXY ?? `http://${PROXY}:3128`;
const netFor = (online: boolean) => (EXTERNAL_PROXY && online ? "bridge" : INTERNAL_NET);
const CGROUP = process.env.CGROUP_PARENT ?? "batch.slice";
const cgroupArgs = () => (CGROUP ? ["--cgroup-parent", CGROUP] : []);
const SLOTS = Number(process.env.CONTAINER_SLOTS ?? 3);
const PROXY_ENV = { HTTP_PROXY: PROXY_URL, HTTPS_PROXY: PROXY_URL, http_proxy: PROXY_URL, https_proxy: PROXY_URL, NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1" };
const HELPERS = join(config.appDir, "container");
const UID = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

const docker = (args: string[], timeout = 120_000) => run("docker", args, { timeout, maxBuffer: 20_000_000 });

// ---------- availability and shared infrastructure ----------

let available: Promise<{ ok: boolean; detail?: string }> | undefined;
export function dockerAvailable() {
  available ??= docker(["version", "--format", "{{.Server.Version}}"], 15_000).then(
    (r) => ({ ok: true, detail: `Docker ${r.stdout.trim()}` }),
    (e) => ({ ok: false, detail: `Docker is not usable by the server: ${String(e.message).split("\n")[0]}` }),
  );
  return available;
}

async function exists(kind: "network" | "container" | "image", name: string) {
  return docker([kind, "inspect", name], 30_000).then(
    () => true,
    () => false,
  );
}

let infra: Promise<void> | undefined;
/**
 * The internal network lesson containers join (no route out), and the egress
 * proxy that bridges it to the internet for public addresses only.
 * Recreates the proxy when its code changes.
 */
export function ensureInfra(): Promise<void> {
  infra ??= (async () => {
    if (!(await exists("network", INTERNAL_NET))) await docker(["network", "create", "--internal", "--label", "study-coach=1", INTERNAL_NET]);
    if (EXTERNAL_PROXY) return;
    if (!(await exists("network", EGRESS_NET))) await docker(["network", "create", "--label", "study-coach=1", EGRESS_NET]);
    const code = (await readFile(join(config.appDir, "server/egress-proxy.ts"))).toString() + (await readFile(join(config.appDir, "server/netguard.ts"))).toString();
    const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
    const current = await docker(["inspect", "-f", '{{index .Config.Labels "study-coach.hash"}} {{.State.Running}}', PROXY], 30_000).then(
      (r) => r.stdout.trim(),
      () => "",
    );
    if (current !== `${hash} true`) {
      await docker(["rm", "-f", PROXY], 30_000).catch(() => {});
      await docker(
        [
          "run", "-d", "--name", PROXY, "--restart", "unless-stopped",
          "--label", "study-coach=1", "--label", `study-coach.hash=${hash}`,
          "--network", EGRESS_NET,
          "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
          "--memory", "256m", "--pids-limit", "256",
          "-v", `${join(config.appDir, "server")}:/app:ro`,
          "node:24-alpine", "node", "/app/egress-proxy.ts",
        ],
        300_000,
      );
      await docker(["network", "connect", INTERNAL_NET, PROXY]);
    }
  })();
  infra.catch(() => {
    infra = undefined;
  });
  return infra;
}

// ---------- images ----------

const preparing = new Map<string, Promise<string>>();

/** Pull the base image and, when the environment has setup commands, bake them into a local image. Returns the image to run. */
export function prepareImage(env: Environment, log: (m: string) => void = () => {}): Promise<string> {
  const key = createHash("sha256").update(`${env.image}\n${env.setup}`).digest("hex").slice(0, 16);
  const tag = env.setup.trim() ? `study-coach-env:${key}` : env.image;
  if (!preparing.has(tag)) {
    const p = (async () => {
      await ensureInfra();
      if (!(await exists("image", env.image))) {
        log(`Downloading the ${env.image} image (first use only)…`);
        await docker(["pull", "-q", env.image], 1_800_000);
      }
      if (!env.setup.trim() || (await exists("image", tag))) return tag;
      log("Running the environment's setup commands…");
      const name = `study-coach-setup-${key}-${Date.now().toString(36)}`;
      try {
        const args = ["run", "--name", name, "--network", netFor(true), "--security-opt", "no-new-privileges", "--memory", "4g", "--pids-limit", "2048", "--user", "0:0"];
        for (const [k, v] of Object.entries(PROXY_ENV)) args.push("-e", `${k}=${v}`);
        args.push("--entrypoint", "sh", env.image, "-c", env.setup);
        await docker(args, 1_800_000).catch((e) => {
          throw new Error(`setup failed: ${String(e.stderr || e.stdout || e.message).slice(-1500)}`);
        });
        await docker(["commit", name, tag], 600_000);
      } finally {
        await docker(["rm", "-f", name], 60_000).catch(() => {});
      }
      return tag;
    })();
    preparing.set(tag, p);
    p.catch(() => preparing.delete(tag));
  }
  return preparing.get(tag)!;
}

// ---------- running ----------

/** The meaningful part of a command for display: skips setup steps such as `ln -sfn …` and `cp -a …`. */
function shortLabel(cmd: string, first = false): string {
  const parts = cmd.split("&&").map((p) => p.trim()).filter((p) => !/^(ln|cp|rm|mkdir) /.test(p));
  return ((first ? parts[0] : parts.at(-1)) ?? cmd).slice(0, 120);
}

let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= SLOTS) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

type RunOpts = {
  image: string;
  env: Environment;
  /** Host folder copied to /work before the script runs (mounted read-only at /src). */
  src: string;
  cache: string;
  out?: string;
  script: string;
  network: boolean;
  label: string;
  timeoutSec: number;
};

function runContainer(o: RunOpts): Promise<CheckResult> {
  const name = `study-coach-run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const args = [
    "run", "--rm", "--name", name, "--label", "study-coach=1",
    "--network", netFor(o.network),
    "--user", UID, "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,size=4g", "--tmpfs", "/work:rw,exec,nosuid,size=4g,uid=" + UID.split(":")[0] + ",gid=" + UID.split(":")[1],
    "--memory", o.env.memory, "--memory-swap", o.env.memory, "--cpus", String(o.env.cpus), "--pids-limit", "1024",
    ...cgroupArgs(),
    "-v", `${o.src}:/src:ro`, "-v", `${o.cache}:/cache`, "-v", `${HELPERS}:/opt/study:ro`,
    "-w", "/work",
    "-e", "HOME=/tmp/home", "-e", "TERM=dumb", "-e", "NO_COLOR=1", "-e", "FORCE_COLOR=0",
  ];
  if (o.out) args.push("-v", `${o.out}:/out`);
  for (const [k, v] of Object.entries({ ...o.env.env, ...(o.network ? PROXY_ENV : {}) })) args.push("-e", `${k}=${v}`);
  args.push("--entrypoint", "sh", o.image, "-c", `mkdir -p "$HOME" && cp -a /src/. /work/ && cd /work && ${o.script}`);

  const started = Date.now();
  return new Promise((done) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const add = (b: Buffer) => {
      if (output.length < 200_000) output += b.toString();
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void docker(["kill", name], 30_000).catch(() => {});
    }, o.timeoutSec * 1000);
    child.on("error", (e) => (output += String(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ command: o.label, exitCode: code, output: output.replace(/\x1b\[[0-9;]*m/g, ""), durationMs: Date.now() - started, timedOut });
    });
  });
}

async function manifestHash(dir: string, env: Environment): Promise<string> {
  const names = (await readdir(dir).catch(() => [] as string[])).sort();
  const h = createHash("sha256").update(`${env.image}\n${env.setup}\n${env.install}`);
  for (const pattern of env.manifests) {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    for (const n of names.filter((x) => re.test(x))) {
      h.update(n);
      h.update(await readFile(join(dir, n)).catch(() => Buffer.alloc(0)));
    }
  }
  return h.digest("hex");
}

/** Copy a lesson's visible files (no hidden folders such as .meta, .reference or .cache) into a fresh folder. */
async function stage(lessonDir: string, overlay?: Record<string, string>) {
  const base = join(config.dataDir, "run", "stage");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "s-"));
  await cp(lessonDir, dir, { recursive: true, filter: (src) => src === lessonDir || !/\/\.[^/]+(\/|$)/.test(src.slice(lessonDir.length)) });
  for (const [rel, content] of Object.entries(overlay ?? {})) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return dir;
}

/**
 * Check a lesson in its container: install dependencies when a manifest
 * changed (with internet through the proxy), then run the check command.
 * `cacheDir` persists between runs; it is the lesson's .cache folder.
 */
export async function containerChecks(
  lessonDir: string,
  cacheDir: string,
  env: Environment,
  opts: { overlay?: Record<string, string>; log?: (m: string) => void } = {},
): Promise<Checks> {
  const log = opts.log ?? (() => {});
  const image = await prepareImage(env, log);
  await mkdir(cacheDir, { recursive: true });
  const src = await stage(lessonDir, opts.overlay);
  try {
    return await slot(async () => {
      const results: CheckResult[] = [];
      if (env.install.trim()) {
        const want = await manifestHash(src, env);
        const have = await readFile(join(cacheDir, ".study-install"), "utf8").catch(() => "");
        if (want !== have) {
          log("Installing dependencies…");
          const r = await runContainer({ image, env, src, cache: cacheDir, script: env.install, network: true, label: `install: ${shortLabel(env.install, true)}`, timeoutSec: 1200 });
          results.push(r);
          if (r.exitCode !== 0) return { at: new Date().toISOString(), results, passed: false, sandboxed: true };
          await writeFile(join(cacheDir, ".study-install"), want);
        }
      }
      results.push(await runContainer({ image, env, src, cache: cacheDir, script: env.check, network: env.checkNetwork, label: shortLabel(env.check), timeoutSec: env.timeoutSec }));
      const last = results.at(-1)!;
      return { at: new Date().toISOString(), results, passed: last.exitCode === 0, sandboxed: true };
    });
  } finally {
    await rm(src, { recursive: true, force: true });
  }
}

/** Build the lesson's preview into one HTML file. */
export async function containerPreview(lessonDir: string, cacheDir: string, env: Environment): Promise<{ html?: string; result: CheckResult }> {
  if (!env.preview.trim()) throw new Error("this environment has no preview");
  const image = await prepareImage(env);
  const out = await mkdtemp(join(config.dataDir, "run", "preview-"));
  const src = await stage(lessonDir);
  try {
    return await slot(async () => {
      const result = await runContainer({ image, env, src, cache: cacheDir, out, script: env.preview, network: env.checkNetwork, label: "build preview", timeoutSec: env.timeoutSec });
      const html = await readFile(join(out, "index.html"), "utf8").catch(() => undefined);
      return { ...(html !== undefined ? { html } : {}), result };
    });
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(src, { recursive: true, force: true });
  }
}

/** A Node image with Chromium baked in by the usual setup step; Playwright comes from the app's own node_modules. */
const BROWSER_ENV: Environment = {
  label: "browser",
  image: "node:24-bookworm-slim",
  setup: "apt-get update && apt-get install -y --no-install-recommends chromium fonts-dejavu-core && rm -rf /var/lib/apt/lists/*",
  install: "",
  check: "true",
  preview: "",
  manifests: [],
  layout: "",
  syntax: "plain",
  checkNetwork: true,
  env: {},
  memory: "1g",
  cpus: 1,
  timeoutSec: 90,
};

/** Render a page that needs JavaScript with headless Chromium in a container, through the egress proxy. Returns the final DOM. */
export async function renderPage(url: string): Promise<string> {
  const image = await prepareImage(BROWSER_ENV);
  const r = await docker(
    [
      "run", "--rm", "--label", "study-coach=1", "--network", netFor(true),
      "--user", UID, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,exec,size=512m",
      "--memory", "1g", "--pids-limit", "512", ...cgroupArgs(),
      "-e", "HOME=/tmp", "-e", `RENDER_PROXY=${PROXY_URL}`,
      "-v", `${join(config.appDir, "node_modules/playwright-core")}:/opt/pw:ro`, "-v", `${HELPERS}:/opt/study:ro`,
      "--entrypoint", "node", image, "/opt/study/render.mjs", url,
    ],
    90_000,
  );
  return r.stdout;
}
