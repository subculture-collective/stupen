import { execFile, spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";

import {
  type Account,
  deleteAccountRows,
  deletePasskey,
  endOtherSessions,
  endSession,
  githubCallback,
  githubEnabled,
  githubStart,
  identities,
  listAccounts,
  listPasskeys,
  listSessions,
  passkeyLogin,
  passkeyLoginOptions,
  passkeyRegister,
  passkeyRegisterOptions,
  sendSignInLink,
  sessionAccount,
  setDisabled,
  startSession,
  useSignInLink,
} from "./auth.ts";
import { clampCeiling, HeaderParser, systemPrompt, turnPrompt } from "./coach.ts";
import { checkBaseUrl, deleteConnection, getConnection, KINDS, kindInfo, listConnections, mayUseServerLogins, providerChoices, saveConnection } from "./connections.ts";
import { checkRate, checkStorage, forgetStorage, STORAGE_LIMIT_BYTES, storageUsed, TRACK_LIMIT } from "./limits.ts";
import { clearPkce, openrouterCallback, openrouterStart } from "./openrouter.ts";
import { apiChat, listModels } from "./providers/api.ts";
import { config } from "./config.ts";
import { dockerAvailable, ensureInfra } from "./containers.ts";
import * as exec from "./exec.ts";
import { allPresets } from "./environments.ts";
import { cancelJob, findJob, lessonJob, listJobs, planJob } from "./jobs.ts";
import { addText, addUpload, addUrl } from "./materials.ts";
import { PLACEHOLDERS, listPrompts, resetPrompts, savePrompts, TRIGGERS } from "./prompts.ts";
import { claudeChat } from "./providers/claude.ts";
import { codexChat } from "./providers/codex.ts";
import { type ChatEvent, type ChatRequest, subscriptionEnv } from "./providers/process.ts";
import { lessonCommands, RUNNERS, runner } from "./runners.ts";
import { sandboxStatus } from "./sandbox.ts";
import {
  appendLog,
  assistByLesson,
  createLessonFile,
  createTrack,
  deleteLessonFile,
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
  userDir,
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

const provider = (v: unknown) => (typeof v === "string" && /^[a-z0-9]{1,24}$/.test(v) ? v : undefined);
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
  let checks;
  if (r.id === "container") {
    if (!track.environment) throw new HttpError(400, "set up the track's container environment in Settings first");
    const d = await exec.dockerAvailable();
    if (!d.ok) throw new HttpError(503, d.detail ?? "Docker is not available");
    const dir = lessonDir(user, trackId, lesson);
    checks = await exec.containerChecks(dir, join(dir, ".cache"), track.environment);
  } else {
    const commands = lessonCommands(r, files.map((f) => f.path), track.customCommand);
    if (!commands.length) throw new HttpError(400, r.graded === "coach" ? "written lessons are graded by the coach: use Submit for grading" : "set a check command in the track settings first");
    checks = await exec.quickChecks(lessonDir(user, trackId, lesson), r.id, track.customCommand);
  }
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
  const providerId = provider(input.provider) ?? "";
  let providerFn: (req: ChatRequest) => AsyncGenerator<ChatEvent>;
  if (chatProviders[providerId]) {
    if (!mayUseServerLogins(user)) throw new HttpError(403, "Connect your own model on the Models page first.");
    providerFn = chatProviders[providerId]!;
  } else {
    const c = getConnection(user, providerId);
    if (!c) throw new HttpError(400, "Choose a model: that connection no longer exists.");
    providerFn = (r) => apiChat(user, c, r);
  }
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
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
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
    handle: async (user, _m, req) => {
      const { sandbox, runners: available, docker: dockerOk } = await exec.status();
      const a = accounts.get(req);
      return {
        user: a ? (a.email ?? a.name ?? a.id) : user,
        authMode: config.authMode,
        isAdmin: a ? a.isAdmin : true,
        sandbox,
        docker: dockerOk,
        runners: RUNNERS.map((r) => ({ id: r.id, label: r.label, syntax: r.syntax, layout: r.layout, graded: r.graded ?? null, ...(r.id === "container" ? dockerOk : (available[r.id] ?? { ok: false, detail: "the code runner did not report it" })) })),
        environments: allPresets(),
        levels: LEVELS.map((id) => ({ id, label: LEVEL_LABEL[id] })),
      };
    },
  },
  { method: "GET", pattern: /^\/api\/providers$/, handle: async (user) => (mayUseServerLogins(user) ? providerStatus() : {}) },
  { method: "GET", pattern: /^\/api\/models$/, handle: async (user) => ({ choices: providerChoices(user), kinds: KINDS, connections: listConnections(user) }) },
  { method: "POST", pattern: /^\/api\/connections$/, handle: async (user, _m, req) => saveConnection(user, await body(req)) },
  { method: "DELETE", pattern: /^\/api\/connections\/(c[a-f0-9]{12})$/, handle: async (user, m) => (deleteConnection(user, m[1]!), { ok: true }) },
  {
    method: "POST",
    pattern: /^\/api\/connections\/models$/,
    handle: async (user, _m, req) => {
      const i = await body(req);
      const stored = typeof i.id === "string" ? getConnection(user, i.id) : undefined;
      const kind = stored?.kind ?? (kindInfo(String(i.kind))?.id);
      if (!kind) throw new HttpError(400, "Choose a provider.");
      const key = typeof i.key === "string" && i.key.trim() ? i.key.trim() : stored?.key;
      if (!key) throw new HttpError(400, "Paste your API key first.");
      return { models: await listModels(kind, key, stored?.baseUrl || (kind === "compatible" ? checkBaseUrl(String(i.baseUrl ?? "")) : "")) };
    },
  },
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
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/preview$`),
    handle: async (user, m) => {
      const track = await getTrack(user, m[1]!);
      if (track.runner !== "container" || !track.environment?.preview) throw new HttpError(400, "this track's environment has no preview");
      const dir = lessonDir(user, m[1]!, m[2]!);
      await getLesson(user, m[1]!, m[2]!);
      return exec.containerPreview(dir, join(dir, ".cache"), track.environment);
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/files$`),
    handle: async (user, m, req) => {
      const i = await body(req);
      await createLessonFile(user, m[1]!, m[2]!, String(i.path ?? "").trim(), String(i.content ?? ""));
      return { ok: true };
    },
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/api/tracks/${T}/lessons/${L}/file$`),
    handle: async (user, m, _r, _s, url) => (await deleteLessonFile(user, m[1]!, m[2]!, url.searchParams.get("path") ?? ""), { ok: true }),
  },
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

/** The signed-in account for this request (accounts mode only). */
const accounts = new WeakMap<IncomingMessage, Account>();
const accountOf = (req: IncomingMessage) => {
  const a = accounts.get(req);
  if (!a) throw new HttpError(401, "Sign in first.");
  return a;
};

function redirect(res: ServerResponse, location: string, setCookie?: string | string[]) {
  res.writeHead(302, { location, "cache-control": "no-store", ...(setCookie ? { "set-cookie": setCookie } : {}) });
  res.end();
}

function sendWithCookie(res: ServerResponse, setCookie: string, body: unknown) {
  res.setHeader("set-cookie", setCookie);
  send(res, 200, body);
}

const admin = (req: IncomingMessage) => {
  const a = accountOf(req);
  if (!a.isAdmin) throw new HttpError(403, "Admins only.");
  return a;
};

/** Deletes an account's database rows and every file it stored. */
async function removeAccount(id: string) {
  const { rm } = await import("node:fs/promises");
  deleteAccountRows(id);
  await rm(userDir(id), { recursive: true, force: true });
  forgetStorage(id);
}

/** Streams the account's files (tracks, lessons, materials, prompts, coach log, chats) as a .tar.gz. */
function exportAccount(user: string, res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "application/gzip",
    "content-disposition": `attachment; filename="stupen-export-${new Date().toISOString().slice(0, 10)}.tar.gz"`,
    "cache-control": "no-store",
  });
  const tar = spawn("tar", ["-czf", "-", "--ignore-failed-read", "-C", join(config.dataDir, "users"), user], { stdio: ["ignore", "pipe", "ignore"] });
  tar.stdout.pipe(res);
  res.on("close", () => tar.kill());
}

/** Sign-in endpoints; they work without a session. */
async function authRoute(path: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (method === "GET" && path === "/api/auth/config") {
    send(res, 200, { mode: config.authMode, email: true, github: githubEnabled(), passkeys: true, signup: config.openSignup });
    return true;
  }
  if (method !== "POST") return false;
  if (path === "/api/auth/email") {
    await sendSignInLink((await body(req)).email, req);
    send(res, 200, { ok: true });
    return true;
  }
  if (path === "/api/auth/email/verify") {
    const a = useSignInLink((await body(req)).token, req);
    sendWithCookie(res, startSession(a.id, "email", req), { ok: true });
    return true;
  }
  if (path === "/api/auth/passkey/options") {
    send(res, 200, await passkeyLoginOptions(req));
    return true;
  }
  if (path === "/api/auth/passkey/verify") {
    const a = await passkeyLogin((await body(req)).response);
    sendWithCookie(res, startSession(a.id, "passkey", req), { ok: true });
    return true;
  }
  if (path === "/api/auth/logout") {
    sendWithCookie(res, endSession(req), { ok: true });
    return true;
  }
  return false;
}

const accountRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/account$/,
    handle: async (_u, _m, req) => {
      const a = accountOf(req);
      return { id: a.id, email: a.email, name: a.name, isAdmin: a.isAdmin, createdAt: a.createdAt, identities: identities(a.id), passkeys: listPasskeys(a.id), sessions: listSessions(a.id, req), github: githubEnabled() };
    },
  },
  { method: "POST", pattern: /^\/api\/account\/passkeys\/options$/, handle: async (_u, _m, req) => passkeyRegisterOptions(accountOf(req)) },
  {
    method: "POST",
    pattern: /^\/api\/account\/passkeys$/,
    handle: async (_u, _m, req) => {
      const i = await body(req);
      return passkeyRegister(accountOf(req), i.response, i.name);
    },
  },
  { method: "DELETE", pattern: /^\/api\/account\/passkeys\/([A-Za-z0-9_-]{8,400})$/, handle: async (_u, m, req) => (deletePasskey(accountOf(req).id, m[1]!), { ok: true }) },
  {
    method: "GET",
    pattern: /^\/api\/account\/usage$/,
    handle: async (user) => ({ bytes: await storageUsed(user), limitBytes: STORAGE_LIMIT_BYTES, tracks: (await listTracks(user)).length, trackLimit: TRACK_LIMIT }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/account$/,
    handle: async (user, _m, req) => {
      const a = accountOf(req);
      const i = await body(req);
      if (String(i.confirm ?? "").trim().toLowerCase() !== (a.email ?? a.id)) throw new HttpError(400, "Type your email address to confirm.");
      await removeAccount(a.id);
      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/accounts$/,
    handle: async (_u, _m, req) => {
      admin(req);
      return Promise.all(listAccounts().map(async (a) => ({ ...a, bytes: await storageUsed(a.id), tracks: (await listTracks(a.id).catch(() => [])).length })));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/accounts\/([a-z0-9._-]{1,64})$/,
    handle: async (_u, m, req) => {
      const me = admin(req);
      if (m[1] === me.id) throw new HttpError(400, "You cannot disable your own account.");
      setDisabled(m[1]!, Boolean((await body(req)).disabled));
      return { ok: true };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/accounts\/([a-z0-9._-]{1,64})$/,
    handle: async (_u, m, req) => {
      const me = admin(req);
      if (m[1] === me.id) throw new HttpError(400, "Delete your own account from the Account page.");
      await removeAccount(m[1]!);
      return { ok: true };
    },
  },
  { method: "POST", pattern: /^\/api\/account\/sessions\/end-others$/, handle: async (_u, _m, req) => (endOtherSessions(accountOf(req).id, req), { ok: true }) },
];

const server = createServer(async (req, res) => {
  try {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!allowedHosts.has(host)) throw new HttpError(403, "host not allowed");
    if (config.edgeSecret && !sameSecret(req.headers[config.edgeSecretHeader], config.edgeSecret)) throw new HttpError(403, "requests must come through the sign-in proxy");
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    let path = url.pathname;
    if (config.basePath) {
      if (path === config.basePath) return redirect(res, `${config.basePath}/`);
      if (!path.startsWith(`${config.basePath}/`)) throw new HttpError(404, "not found");
      path = path.slice(config.basePath.length);
    }
    if (method === "GET" && (path === "/auth/openrouter" || path === "/auth/openrouter/callback")) {
      const raw = req.headers[config.userHeader];
      const who = config.authMode === "accounts" ? sessionAccount(req)?.id : userId(Array.isArray(raw) ? raw[0] : raw);
      if (!who) return redirect(res, `${config.basePath}/#/`);
      if (path === "/auth/openrouter") {
        const { location, setCookie } = openrouterStart();
        return redirect(res, location, setCookie);
      }
      try {
        await openrouterCallback(who, req, url);
        return redirect(res, `${config.basePath}/#/models?connected=openrouter`, clearPkce());
      } catch (e) {
        return redirect(res, `${config.basePath}/#/models?error=${encodeURIComponent(e instanceof Error ? e.message : "OpenRouter connection failed")}`, clearPkce());
      }
    }
    if (config.authMode === "accounts" && method === "GET" && path === "/auth/github") {
      const { location, setCookie } = githubStart(req);
      return redirect(res, location, setCookie);
    }
    if (config.authMode === "accounts" && method === "GET" && path === "/auth/github/callback") {
      try {
        const a = await githubCallback(req, url);
        return redirect(res, `${config.basePath}/`, [startSession(a.id, "github", req), "stupen_gh_state=; Path=/; Max-Age=0"]);
      } catch (e) {
        return redirect(res, `${config.basePath}/#/signin?error=${encodeURIComponent(e instanceof Error ? e.message : "GitHub sign-in failed")}`);
      }
    }
    // A custom header forces a CORS preflight, which this server never answers.
    if (method !== "GET" && req.headers["x-study-coach"] !== "1") throw new HttpError(403, "missing app header");

    if (path.startsWith("/api/")) {
      let user: string;
      if (config.authMode === "accounts") {
        if (path.startsWith("/api/auth/")) {
          if (await authRoute(path, method, req, res)) return;
          throw new HttpError(404, "not found");
        }
        const a = sessionAccount(req);
        if (!a) throw new HttpError(401, "Sign in first.");
        accounts.set(req, a);
        user = a.id;
      } else {
        if (path === "/api/auth/config" && method === "GET") return send(res, 200, { mode: "proxy" });
        const rawUser = req.headers[config.userHeader];
        user = userId(Array.isArray(rawUser) ? rawUser[0] : rawUser);
      }
      if (config.authMode === "accounts" && !accounts.get(req)?.isAdmin) {
        checkRate(user, method, path);
        await checkStorage(user, method);
        if (method === "POST" && path === "/api/tracks" && (await listTracks(user)).length >= TRACK_LIMIT) throw new HttpError(400, `You have ${TRACK_LIMIT} tracks; delete one to start another.`);
      }
      if (config.authMode === "accounts" && method === "GET" && path === "/api/account/export") return exportAccount(user, res);
      if (path === "/api/chat" && method === "POST") return await chat(user, req, res);
      for (const r of config.authMode === "accounts" ? [...accountRoutes, ...routes] : routes) {
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
  console.log(`stupen on ${where}`);
  console.log(`  data    ${config.dataDir}`);
  if (exec.remote()) {
    const st = await exec.status();
    console.log(`  runner  ${config.runnerUrl}: ${st.sandbox.detail} ${st.docker.detail ?? ""}`);
    return;
  }
  console.log(`  sandbox ${(await sandboxStatus()).detail}`);
  const d = await dockerAvailable();
  console.log(`  docker  ${d.detail}`);
  // Networks and the egress proxy are created up front so the first container lesson does not wait for them.
  if (d.ok) ensureInfra().catch((e) => console.warn(`  container network: ${(e as Error).message}`));
});
