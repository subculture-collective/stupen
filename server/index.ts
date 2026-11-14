import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";

import { clampCeiling, HeaderParser, systemPrompt, turnPrompt } from "./coach.ts";
import { config } from "./config.ts";
import { cancelJob, findJob, lessonJob, listJobs, planJob } from "./jobs.ts";
import { addText, addUpload, addUrl } from "./materials.ts";
import { PLACEHOLDERS, listPrompts, resetPrompts, savePrompts, TRIGGERS } from "./prompts.ts";
import { claudeChat } from "./providers/claude.ts";
import { codexChat } from "./providers/codex.ts";
import { type ChatEvent, type ChatRequest, subscriptionEnv } from "./providers/process.ts";
import { lessonCommands, RUNNERS, runner } from "./runners.ts";
import { runChecksIn, runnerAvailability, sandboxStatus } from "./sandbox.ts";
import {
  appendLog,
  assistByLesson,
  createTrack,
  deleteLesson,
  deleteMaterial,
  deleteTrack,
  getLesson,
  getMaterial,
  getTrack,
  LEVEL_LABEL,
  LEVELS,
  lessonDir,
  lessonFiles,
  listLessons,
  listMaterials,
  listTracks,
  readLessonFile,
  readPlan,
  readReference,
  restorePlan,
  saveLessonMeta,
  starterContent,
  updateMaterial,
  updateTrack,
  userId,
  writeLessonFile,
  writeNotes,
  writePlan,
} from "./store.ts";
import { HttpError } from "./util.ts";

const run = promisify(execFile);

function sameSecret(got: string | string[] | undefined, want: string): boolean {
  const a = Buffer.from(typeof got === "string" ? got : "");
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
const chatProviders: Record<string, (req: ChatRequest) => AsyncGenerator<ChatEvent>> = { claude: claudeChat, codex: codexChat };

const allowedHosts = new Set(
  ["localhost", "127.0.0.1", "[::1]", ...(process.env.ALLOWED_HOSTS?.split(",") ?? [])].map((h) => h.trim()).filter(Boolean),
);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, "request too large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const provider = (v: unknown) => (v === "codex" ? "codex" : v === "claude" ? "claude" : undefined);
const strOr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : undefined);

let loginCache: { at: number; value: unknown } | undefined;
async function providerStatus() {
  if (loginCache && Date.now() - loginCache.at < 60_000) return loginCache.value;
  const env = subscriptionEnv();
  const claude = await run(config.claudeBin, ["auth", "status"], { env, timeout: 15_000 })
    .then(({ stdout }) => {
      const s = JSON.parse(stdout);
      return { ok: Boolean(s.loggedIn), detail: s.loggedIn ? `${s.authMethod} ${s.subscriptionType ?? ""}`.trim() : "not signed in" };
    })
    .catch((e) => ({ ok: false, detail: String(e.message ?? e).slice(0, 200) }));
  const codex = await run(config.codexBin, ["login", "status"], { env, timeout: 15_000 })
    .then(({ stdout, stderr }) => {
      const text = `${stdout}${stderr}`.trim().split("\n").pop() ?? "";
      return { ok: /ChatGPT|logged in/i.test(text), detail: text.slice(0, 200) };
    })
    .catch((e) => ({ ok: false, detail: String(e.message ?? e).slice(0, 200) }));
  loginCache = { at: Date.now(), value: { claude, codex } };
  return loginCache.value;
}

async function trackState(user: string, id: string) {
  const [track, plan, lessons, materials, help] = await Promise.all([
    getTrack(user, id),
    readPlan(user, id),
    listLessons(user, id),
    listMaterials(user, id),
    assistByLesson(user, id),
  ]);
  return {
    track,
    ...plan,
    lessons: lessons.map(({ brief: _b, lastChecks, ...l }) => ({ ...l, help: help[l.id] ?? null, lastPassed: lastChecks?.passed ?? null })),
    materials,
    jobs: listJobs(user, id),
  };
}

async function lessonState(user: string, track: string, lesson: string) {
  const [meta, files, help] = await Promise.all([getLesson(user, track, lesson), lessonFiles(user, track, lesson), assistByLesson(user, track)]);
  return { meta, files, help: help[lesson] ?? null };
}

async function checkLesson(user: string, trackId: string, lesson: string) {
  const track = await getTrack(user, trackId);
  const r = runner(track.runner);
  const files = await lessonFiles(user, trackId, lesson);
  const commands = lessonCommands(r, files.map((f) => f.path), track.customCommand);
  if (!commands.length) throw new HttpError(400, r.graded === "coach" ? "written lessons are graded by the coach: use Submit for grading" : "set a check command in the track settings first");
  const checks = await runChecksIn(lessonDir(user, trackId, lesson), commands);
  const meta = await getLesson(user, trackId, lesson);
  const failStreak = checks.passed ? 0 : (meta.failStreak ?? 0) + 1;
  const next = {
    ...meta,
    attempts: meta.attempts + 1,
    lastChecks: checks,
    failStreak,
    status: checks.passed ? ("passed" as const) : meta.status === "passed" ? ("passed" as const) : ("started" as const),
    ...(checks.passed && !meta.passedAt ? { passedAt: checks.at } : {}),
  };
  await saveLessonMeta(user, trackId, next);
  return { checks, meta: next, firstPass: checks.passed && !meta.passedAt };
}

async function chat(user: string, req: IncomingMessage, res: ServerResponse) {
  const input = await body(req);
  const providerFn = chatProviders[input.provider];
  if (!providerFn) throw new HttpError(400, "unknown provider");
  const message = String(input.message ?? "").trim().slice(0, 20_000);
  if (!message) throw new HttpError(400, "empty message");
  const track = await getTrack(user, String(input.track ?? ""));
  const lessonId = strOr(input.lesson);
  const meta = lessonId ? await getLesson(user, track.id, lessonId) : undefined;
  const ceiling = clampCeiling(input.ceiling, track.defaultCeiling);
  const threadId = typeof input.threadId === "string" && /^[\w-]{8,80}$/.test(input.threadId) ? input.threadId : undefined;
  const grading = input.promptId === "grade";
  const web = Boolean(input.web);

  const [{ notes, outline }, materials] = await Promise.all([readPlan(user, track.id), listMaterials(user, track.id)]);
  const files = meta
    ? await Promise.all(
        (await lessonFiles(user, track.id, meta.id)).map(async (f) => ({ path: f.path, editable: f.editable, content: await readLessonFile(user, track.id, meta.id, f.path).catch(() => "") })),
      )
    : [];
  const attachment = strOr(input.material) ? await getMaterial(user, track.id, input.material).then((m) => ({ title: m.material.title, text: m.text })) : undefined;
  let system = systemPrompt({ track, ceiling, ...(meta ? { lesson: meta } : {}), notes, ...(outline.summary ? { planSummary: outline.summary } : {}), materials, web, grading });
  if (grading && meta && runner(track.runner).graded === "coach") {
    const ref = await readReference(user, track.id, meta.id);
    if (ref.length) system += `\n\nModel answer from the lesson author (private: use it to grade; do not reveal it below help level 6):\n${ref.map((f) => f.content).join("\n\n")}`;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const abort = new AbortController();
  // Proxies such as Cloudflare drop idle responses; Codex sends nothing until its reply is complete.
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(keepalive);
    abort.abort();
  });

  const parser = new HeaderParser();
  let reply = "";
  let thread = threadId;
  let error: string | undefined;
  try {
    for await (const ev of providerFn({
      system,
      prompt: turnPrompt({ message, files, ...(meta?.lastChecks ? { checks: meta.lastChecks } : {}), ...(attachment ? { attachment } : {}) }),
      ...(threadId ? { threadId } : {}),
      web,
      signal: abort.signal,
    })) {
      if (ev.type === "delta") {
        const text = parser.feed(ev.text);
        reply += text;
        if (text) emit("delta", { text });
      } else if (ev.type === "thread") {
        thread = ev.id;
        emit("thread", { id: ev.id });
      } else if (ev.type === "notice" || ev.type === "activity") {
        emit(ev.type, { message: ev.message });
      } else {
        error = ev.message;
        emit("error", { message: ev.message });
      }
    }
    const rest = parser.flush();
    reply += rest;
    if (rest) emit("delta", { text: rest });
  } catch (e) {
    error = String((e as Error).message ?? e);
    emit("error", { message: error });
  }

  let passed = false;
  if (grading && meta && parser.verdict && !error) {
    const fresh = await getLesson(user, track.id, meta.id);
    passed = parser.verdict === "pass";
    await saveLessonMeta(user, track.id, {
      ...fresh,
      attempts: fresh.attempts + 1,
      failStreak: passed ? 0 : (fresh.failStreak ?? 0) + 1,
      status: passed || fresh.status === "passed" ? "passed" : "started",
      ...(passed && !fresh.passedAt ? { passedAt: new Date().toISOString() } : {}),
    });
  }
  await appendLog(user, {
    at: new Date().toISOString(),
    track: track.id,
    ...(meta ? { lesson: meta.id } : {}),
    provider: input.provider,
    ...(thread ? { threadId: thread } : {}),
    ceiling,
    ...(parser.level !== undefined ? { assist: parser.level } : {}),
    ...(parser.verdict ? { verdict: parser.verdict } : {}),
    ...(strOr(input.promptId) ? { prompt: String(input.promptId).slice(0, 60) } : {}),
    message,
    reply,
    ...(error ? { error } : {}),
  });
  clearInterval(keepalive);
  const help = meta ? ((await assistByLesson(user, track.id))[meta.id] ?? null) : null;
  emit("done", { assist: parser.level ?? null, verdict: parser.verdict ?? null, help, aborted: abort.signal.aborted });
  res.end();
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function serveStatic(path: string, res: ServerResponse) {
  const dist = join(import.meta.dirname, "..", "dist");
  let file = normalize(join(dist, path));
  if (!file.startsWith(dist)) throw new HttpError(404, "not found");
  if (!(await stat(file).catch(() => undefined))?.isFile()) file = join(dist, "index.html");
  const data = await readFile(file).catch(() => undefined);
  if (!data) throw new HttpError(404, "build the web app first: pnpm build");
  const immutable = file.includes(`${join(dist, "assets")}/`);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(data);
}

type Route = { method: string; pattern: RegExp; handle: (user: string, m: RegExpExecArray, req: IncomingMessage, res: ServerResponse, url: URL) => Promise<unknown> };
const T = "([a-z0-9][a-z0-9-]{0,60})";
const L = "(\\d{2,3}-[a-z0-9-]{1,48})";
const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/me$/,
    handle: async (user) => {
      const [sandbox, available] = await Promise.all([sandboxStatus(), runnerAvailability()]);
      return {
        user,
        sandbox,
        runners: RUNNERS.map((r) => ({ id: r.id, label: r.label, syntax: r.syntax, layout: r.layout, graded: r.graded ?? null, ...available[r.id] })),
        levels: LEVELS.map((id) => ({ id, label: LEVEL_LABEL[id] })),
      };
    },
  },
  { method: "GET", pattern: /^\/api\/providers$/, handle: () => providerStatus() },
  { method: "GET", pattern: /^\/api\/tracks$/, handle: (user) => listTracks(user) },
  { method: "POST", pattern: /^\/api\/tracks$/, handle: async (user, _m, req) => createTrack(user, await body(req)) },
  { method: "GET", pattern: new RegExp(`^/api/tracks/${T}$`), handle: (user, m) => trackState(user, m[1]!) },
  { method: "PUT", pattern: new RegExp(`^/api/tracks/${T}$`), handle: async (user, m, req) => updateTrack(user, m[1]!, await body(req)) },
  { method: "DELETE", pattern: new RegExp(`^/api/tracks/${T}$`), handle: async (user, m) => (await deleteTrack(user, m[1]!), { ok: true }) },
  {
    method: "PUT",
    pattern: new RegExp(`^/api/tracks/${T}/plan$`),
    handle: async (user, m, req) => {
      const input = await body(req);
      const { outline } = await readPlan(user, m[1]!);
      await writePlan(user, m[1]!, String(input.plan ?? "").slice(0, 100_000), outline, "manual-edit");
      return { ok: true };
    },
  },
  { method: "POST", pattern: new RegExp(`^/api/tracks/${T}/plan/restore$`), handle: async (user, m, req) => (await restorePlan(user, m[1]!, String((await body(req)).name ?? "")), { ok: true }) },
  { method: "PUT", pattern: new RegExp(`^/api/tracks/${T}/notes$`), handle: async (user, m, req) => (await writeNotes(user, m[1]!, String((await body(req)).notes ?? "")), { ok: true }) },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/jobs/plan$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      const p = provider(i.provider);
      const mids = ids(i.materialIds);
      return planJob(user, m[1]!, { ...(p ? { provider: p } : {}), ...(strOr(i.instruction) ? { instruction: String(i.instruction).slice(0, 4000) } : {}), ...(mids ? { materialIds: mids } : {}), ...(typeof i.web === "boolean" ? { web: i.web } : {}) });
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/jobs/find$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      const p = provider(i.provider);
      return findJob(user, m[1]!, { ...(p ? { provider: p } : {}), ...(strOr(i.query) ? { query: String(i.query) } : {}), ...(Number(i.count) ? { count: Number(i.count) } : {}), incorporate: Boolean(i.incorporate) });
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/jobs/lesson$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      const p = provider(i.provider);
      const mids = ids(i.materialIds);
      return lessonJob(user, m[1]!, {
        ...(p ? { provider: p } : {}),
        ...(strOr(i.outlineId) ? { outlineId: String(i.outlineId) } : {}),
        ...(strOr(i.topic) ? { topic: String(i.topic) } : {}),
        ...(mids ? { materialIds: mids } : {}),
        ...(typeof i.web === "boolean" ? { web: i.web } : {}),
      });
    },
  },
  { method: "GET", pattern: /^\/api\/jobs$/, handle: async (user, _m, _r, _s, url) => listJobs(user, url.searchParams.get("track") ?? undefined) },
  { method: "POST", pattern: /^\/api\/jobs\/(j[a-z0-9]+)\/cancel$/, handle: async (user, m) => (cancelJob(user, m[1]!), { ok: true }) },
  { method: "GET", pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}$`), handle: (user, m) => lessonState(user, m[1]!, m[2]!) },
  { method: "DELETE", pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}$`), handle: async (user, m) => (await deleteLesson(user, m[1]!, m[2]!), { ok: true }) },
  {
    method: "GET",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/file$`),
    handle: async (user, m, _r, _s, url) => ({ content: await readLessonFile(user, m[1]!, m[2]!, url.searchParams.get("path") ?? "") }),
  },
  {
    method: "PUT",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/file$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      await writeLessonFile(user, m[1]!, m[2]!, String(i.path ?? ""), String(i.content ?? ""));
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/starter$`),
    handle: async (user, m, _r, _s, url) => ({ content: await starterContent(user, m[1]!, m[2]!, url.searchParams.get("path") ?? "") }),
  },
  { method: "POST", pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/check$`), handle: (user, m) => checkLesson(user, m[1]!, m[2]!) },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/solution$`),
    handle: async (user, m) => {
      const meta = await getLesson(user, m[1]!, m[2]!);
      if (!meta.revealedAt) await saveLessonMeta(user, m[1]!, { ...meta, revealedAt: new Date().toISOString() });
      return { files: await readReference(user, m[1]!, m[2]!) };
    },
  },
  { method: "GET", pattern: new RegExp(`^/api/tracks/${T}/materials/(m[a-z0-9]{6,20})$`), handle: (user, m) => getMaterial(user, m[1]!, m[2]!) },
  {
    method: "PATCH",
    pattern: new RegExp(`^/api/tracks/${T}/materials/(m[a-z0-9]{6,20})$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      await updateMaterial(user, m[1]!, m[2]!, { ...(strOr(i.title) ? { title: String(i.title).slice(0, 160) } : {}), ...(typeof i.note === "string" ? { note: i.note.slice(0, 2000) } : {}) });
      return { ok: true };
    },
  },
  { method: "DELETE", pattern: new RegExp(`^/api/tracks/${T}/materials/(m[a-z0-9]{6,20})$`), handle: async (user, m) => (await deleteMaterial(user, m[1]!, m[2]!), { ok: true }) },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/materials$`),
    handle: async (user, m, req) => {
      const i = await body(req, 22_000_000);
      await getTrack(user, m[1]!);
      const note = typeof i.note === "string" ? i.note.slice(0, 2000) : undefined;
      if (i.kind === "url") return addUrl(user, m[1]!, String(i.url ?? ""), strOr(i.title), note);
      if (i.kind === "file") return addUpload(user, m[1]!, String(i.name ?? "upload.txt"), String(i.data ?? ""), note);
      return addText(user, m[1]!, String(i.title ?? ""), String(i.text ?? ""), note);
    },
  },
  { method: "GET", pattern: /^\/api\/prompts$/, handle: async (user) => ({ prompts: await listPrompts(user), triggers: TRIGGERS, placeholders: PLACEHOLDERS }) },
  { method: "PUT", pattern: /^\/api\/prompts$/, handle: async (user, _m, req) => ({ prompts: await savePrompts(user, (await body(req)).prompts) }) },
  { method: "POST", pattern: /^\/api\/prompts\/reset$/, handle: async (user) => ({ prompts: await resetPrompts(user) }) },
];

const server = createServer(async (req, res) => {
  try {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!allowedHosts.has(host)) throw new HttpError(403, "host not allowed");
    if (config.edgeSecret && !sameSecret(req.headers[config.edgeSecretHeader], config.edgeSecret)) throw new HttpError(403, "requests must come through the sign-in proxy");
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const path = url.pathname;
    // A custom header forces a CORS preflight, which this server never answers.
    if (method !== "GET" && req.headers["x-study-coach"] !== "1") throw new HttpError(403, "missing app header");

    if (path.startsWith("/api/")) {
      const rawUser = req.headers[config.userHeader];
      const user = userId(Array.isArray(rawUser) ? rawUser[0] : rawUser);
      if (path === "/api/chat" && method === "POST") return await chat(user, req, res);
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(path);
        if (m) return send(res, 200, await r.handle(user, m, req, res, url));
      }
      throw new HttpError(404, "not found");
    }
    if (config.production && method === "GET") return await serveStatic(path, res);
    throw new HttpError(404, "not found");
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : typeof (e as any)?.status === "number" ? (e as any).status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
});

async function listen() {
  if (config.socket) {
    const { chmod, mkdir, rm } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(config.socket), { recursive: true, mode: 0o700 });
    await chmod(dirname(config.socket), 0o700);
    await rm(config.socket, { force: true });
    return new Promise<string>((resolve) => server.listen(config.socket, () => resolve(`unix:${config.socket}`)));
  }
  return new Promise<string>((resolve) => server.listen(config.port, config.host, () => resolve(`http://${config.host}:${config.port}`)));
}

void listen().then(async (where) => {
  console.log(`study-coach on ${where}`);
  console.log(`  data    ${config.dataDir}`);
  console.log(`  sandbox ${(await sandboxStatus()).detail}`);
});
