/**
 * The runner agent: runs inside the isolated runner VM and executes learner
 * code for the Stupen server. It receives a lesson's files, checks or builds
 * them with the same code the server uses locally (bubblewrap for quick
 * formats, Docker for containers) and returns the results. It holds no
 * accounts, keys or other learners' data; package caches live on the VM disk.
 *
 *   RUNNER_TOKEN=… EGRESS_PROXY_URL=http://10.0.2.100:3128 node server/agent.ts
 *
 * Every request needs `Authorization: Bearer $RUNNER_TOKEN`.
 */
import { timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, join, normalize } from "node:path";

import { config } from "./config.ts";
import { containerChecks, containerPreview, dockerAvailable, ensureInfra, renderPage } from "./containers.ts";
import type { Environment } from "./environments.ts";
import { lessonCommands, runner } from "./runners.ts";
import { runChecksIn, runnerAvailability, sandboxed, sandboxStatus } from "./sandbox.ts";

const TOKEN = process.env.RUNNER_TOKEN ?? "";
if (TOKEN.length < 32) throw new Error("set RUNNER_TOKEN (32+ characters)");
const PORT = Number(process.env.AGENT_PORT ?? 7070);
const HOST = process.env.AGENT_HOST ?? "0.0.0.0";

function authorized(req: IncomingMessage): boolean {
  const got = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 60_000_000) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

/** Write the posted files into a fresh folder, refusing paths that leave it. */
async function unpack(files: Record<string, string>): Promise<string> {
  const base = join(config.dataDir, "run", "agent");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "l-"));
  for (const [rel, b64] of Object.entries(files ?? {})) {
    const full = normalize(join(dir, rel));
    if (!full.startsWith(`${dir}/`)) throw Object.assign(new Error(`bad path ${rel}`), { status: 400 });
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(String(b64), "base64"));
  }
  return dir;
}

const cacheDir = (key: unknown) => {
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) throw Object.assign(new Error("bad cache key"), { status: 400 });
  return join(config.dataDir, "cache", key);
};

async function handle(op: string, i: any): Promise<unknown> {
  switch (op) {
    case "status":
      return { sandbox: await sandboxStatus(), runners: await runnerAvailability(), docker: await dockerAvailable() };
    case "quick": {
      const dir = await unpack(i.files);
      try {
        const commands = lessonCommands(runner(String(i.runner)), Object.keys(i.files ?? {}), typeof i.customCommand === "string" ? i.customCommand : undefined);
        return await runChecksIn(dir, commands);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    case "container": {
      const dir = await unpack(i.files);
      const log: string[] = [];
      try {
        const checks = await containerChecks(dir, cacheDir(i.cache), i.env as Environment, { log: (m) => log.push(m) });
        return { ...checks, log };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    case "preview": {
      const dir = await unpack(i.files);
      try {
        return await containerPreview(dir, cacheDir(i.cache), i.env as Environment);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    case "render":
      return { html: await renderPage(String(i.url)) };
    case "sandboxed": {
      const files = Object.fromEntries(Object.entries(i.files ?? {}).map(([k, v]) => [k, Buffer.from(String(v), "base64")]));
      if (Object.keys(files).some((k) => k.includes("/") || k.startsWith("."))) throw Object.assign(new Error("bad file name"), { status: 400 });
      return sandboxed(files, (i.argv as unknown[]).map(String), typeof i.maxOutput === "number" ? i.maxOutput : undefined);
    }
    default:
      throw Object.assign(new Error("unknown operation"), { status: 404 });
  }
}

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (!authorized(req)) return send(401, { error: "unauthorized" });
    const m = /^\/v1\/([a-z]+)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m) return send(404, { error: "not found" });
    send(200, await handle(m[1]!, await readBody(req)));
  } catch (e) {
    const err = e as Error & { status?: number };
    if (!err.status) console.error(err);
    send(err.status ?? 500, { error: err.message });
  }
})
  .setTimeout(0)
  .listen(PORT, HOST, () => {
    console.log(`runner agent on ${HOST}:${PORT}`);
    void dockerAvailable().then((d) => {
      console.log(`  docker ${d.detail}`);
      if (d.ok) ensureInfra().catch((e) => console.warn(`  container network: ${(e as Error).message}`));
    });
  });
