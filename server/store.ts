import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { config } from "./config.ts";
import { cleanEnvironment, type Environment } from "./environments.ts";
import { runner } from "./runners.ts";
import type { Checks } from "./sandbox.ts";
import { HttpError, inside, newId, readJson, safeRel, slugify, writeAtomic, writeJson } from "./util.ts";

export type Provider = "claude" | "codex";
export const LEVELS = ["new", "beginner", "intermediate", "advanced", "expert"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = {
  new: "Never programmed / brand new to the subject",
  beginner: "Beginner: knows the basics",
  intermediate: "Intermediate: builds small things alone",
  advanced: "Advanced: works with it professionally",
  expert: "Expert: wants depth and edge cases",
};

export type Track = {
  id: string;
  title: string;
  /** What is being learned, in the learner's words: "Rust", "SQL window functions", "Spanish verbs". */
  subject: string;
  runner: string;
  /** For the "custom" runner: a shell command run in the lesson folder. */
  customCommand?: string;
  /** For the "container" runner: image, install and check commands. */
  environment?: Environment;
  level: Level;
  goals: string;
  background: string;
  /** How the learner likes to be taught, free text. */
  style: string;
  sessionMinutes: number;
  defaultCeiling: number;
  provider: Provider;
  /** Let generation jobs search and read the web. */
  web: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OutlineItem = { id: string; title: string; objective: string; concepts: string[] };
export type Source = { title: string; url: string; note?: string };
export type Outline = { lessons: OutlineItem[]; sources: Source[]; updatedAt: string; summary?: string };

export type LessonFile = { path: string; role: "starter" | "test" | "support" };
export type LessonMeta = {
  id: string;
  title: string;
  objective: string;
  outlineId?: string;
  brief: string;
  hints: string[];
  sources: Source[];
  files: LessonFile[];
  /** Material ids the lesson was built from. */
  materials?: string[];
  createdAt: string;
  status: "new" | "started" | "passed";
  attempts: number;
  passedAt?: string;
  /** True when a reference solution passed the tests before the lesson was handed out. */
  verified: boolean;
  lastChecks?: Checks;
  /** Consecutive failing check runs, for the "stuck" prompt trigger. */
  failStreak?: number;
  /** When the learner chose to see the reference solution. */
  revealedAt?: string;
};

export type Material = {
  id: string;
  title: string;
  kind: "file" | "url" | "text" | "web";
  url?: string;
  fileName?: string;
  /** What the material covers and why it is useful, written by the model or the learner. */
  note: string;
  addedAt: string;
  chars: number;
  /** Set once a plan revision has used this material. */
  usedAt?: string;
};

// ---------- users ----------

export function userId(raw: string | undefined): string {
  if (!raw) return "local";
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{0,63}$/.test(v)) throw new HttpError(400, "unusable user name from the proxy");
  return v.replace(/@/g, "_at_");
}

export const userDir = (user: string) => join(config.dataDir, "users", user);
const tracksDir = (user: string) => join(userDir(user), "tracks");
export const trackDir = (user: string, id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) throw new HttpError(400, "bad track id");
  return join(tracksDir(user), id);
};

// ---------- tracks ----------

export async function listTracks(user: string): Promise<Track[]> {
  const names = await readdir(tracksDir(user)).catch(() => [] as string[]);
  const out: Track[] = [];
  for (const n of names) {
    const t = await readJson<Track | undefined>(join(tracksDir(user), n, "track.json"), undefined);
    if (t) out.push(t);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getTrack(user: string, id: string): Promise<Track> {
  const t = await readJson<Track | undefined>(join(trackDir(user, id), "track.json"), undefined);
  if (!t) throw new HttpError(404, "track not found");
  return t;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Accept the editable fields of a track from a request body. */
export function trackFields(input: any, base?: Track): Omit<Track, "id" | "createdAt" | "updatedAt"> {
  const level = LEVELS.includes(input.level) ? (input.level as Level) : (base?.level ?? "beginner");
  const r = runner(String(input.runner ?? base?.runner ?? "written"));
  const subject = str(input.subject ?? base?.subject, 120);
  if (!subject) throw new HttpError(400, "say what you want to learn");
  const ceiling = Math.trunc(Number(input.defaultCeiling ?? base?.defaultCeiling ?? (level === "new" || level === "beginner" ? 4 : 3)));
  const customCommand = str(input.customCommand ?? base?.customCommand, 400);
  const environment = r.id === "container" ? cleanEnvironment(input.environment ?? base?.environment ?? { preset: "node" }, input.environment ? undefined : base?.environment) : undefined;
  return {
    title: str(input.title ?? base?.title, 80) || subject,
    subject,
    runner: r.id,
    ...(r.id === "custom" && customCommand ? { customCommand } : {}),
    ...(environment ? { environment } : {}),
    level,
    goals: str(input.goals ?? base?.goals, 2000),
    background: str(input.background ?? base?.background, 2000),
    style: str(input.style ?? base?.style, 1000),
    sessionMinutes: Math.min(240, Math.max(5, Math.trunc(Number(input.sessionMinutes ?? base?.sessionMinutes ?? 30)) || 30)),
    defaultCeiling: Number.isFinite(ceiling) ? Math.min(6, Math.max(0, ceiling)) : 3,
    provider: input.provider === "codex" ? "codex" : input.provider === "claude" ? "claude" : (base?.provider ?? "claude"),
    web: input.web === undefined ? (base?.web ?? true) : Boolean(input.web),
  };
}

export async function createTrack(user: string, input: any): Promise<Track> {
  const fields = trackFields(input);
  const existing = new Set((await listTracks(user)).map((t) => t.id));
  let id = slugify(fields.title, 40);
  for (let n = 2; existing.has(id); n++) id = `${slugify(fields.title, 36)}-${n}`;
  const now = new Date().toISOString();
  const track: Track = { id, ...fields, createdAt: now, updatedAt: now };
  await writeJson(join(trackDir(user, id), "track.json"), track);
  return track;
}

export async function updateTrack(user: string, id: string, input: any): Promise<Track> {
  const old = await getTrack(user, id);
  const track: Track = { ...old, ...trackFields(input, old), id, createdAt: old.createdAt, updatedAt: new Date().toISOString() };
  if (track.runner !== "custom") delete track.customCommand;
  if (track.runner !== "container") delete track.environment;
  await writeJson(join(trackDir(user, id), "track.json"), track);
  return track;
}

export async function touchTrack(user: string, id: string) {
  const t = await getTrack(user, id);
  await writeJson(join(trackDir(user, id), "track.json"), { ...t, updatedAt: new Date().toISOString() });
}

export async function deleteTrack(user: string, id: string) {
  await getTrack(user, id);
  await rm(trackDir(user, id), { recursive: true, force: true });
}

// ---------- plan, outline, notes ----------

export async function readPlan(user: string, id: string): Promise<{ plan: string; outline: Outline; notes: string; history: string[] }> {
  const dir = trackDir(user, id);
  const [plan, outline, notes, history] = await Promise.all([
    readFile(join(dir, "plan.md"), "utf8").catch(() => ""),
    readJson<Outline>(join(dir, "outline.json"), { lessons: [], sources: [], updatedAt: "" }),
    readFile(join(dir, "notes.md"), "utf8").catch(() => ""),
    readdir(join(dir, "history")).then((n) => n.filter((x) => x.endsWith(".md")).sort().reverse(), () => [] as string[]),
  ]);
  return { plan, outline, notes, history };
}

/** Save a new plan, keeping the previous one in history/ so it can be restored. */
export async function writePlan(user: string, id: string, plan: string, outline?: Outline, reason = "edit") {
  const dir = trackDir(user, id);
  const old = await readFile(join(dir, "plan.md"), "utf8").catch(() => "");
  const oldOutline = await readFile(join(dir, "outline.json"), "utf8").catch(() => "");
  if (old) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeAtomic(join(dir, "history", `${stamp}-${slugify(reason, 24)}.md`), old);
    if (oldOutline) await writeAtomic(join(dir, "history", `${stamp}-${slugify(reason, 24)}.outline.json`), oldOutline);
  }
  await writeAtomic(join(dir, "plan.md"), plan);
  if (outline) await writeJson(join(dir, "outline.json"), { ...outline, updatedAt: new Date().toISOString() });
  await touchTrack(user, id);
}

export async function restorePlan(user: string, id: string, name: string) {
  if (!/^[\w-]+\.md$/.test(name)) throw new HttpError(400, "bad history name");
  const dir = join(trackDir(user, id), "history");
  const plan = await readFile(join(dir, name), "utf8").catch(() => undefined);
  if (plan === undefined) throw new HttpError(404, "no such plan version");
  const outline = await readJson<Outline | undefined>(join(dir, name.replace(/\.md$/, ".outline.json")), undefined);
  await writePlan(user, id, plan, outline, "before-restore");
}

export async function writeNotes(user: string, id: string, notes: string) {
  await writeAtomic(join(trackDir(user, id), "notes.md"), notes.slice(0, 20_000));
}

// ---------- lessons ----------

const lessonsDir = (user: string, track: string) => join(trackDir(user, track), "lessons");
export const lessonDir = (user: string, track: string, lesson: string) => {
  if (!/^\d{2,3}-[a-z0-9-]{1,48}$/.test(lesson)) throw new HttpError(400, "bad lesson id");
  return join(lessonsDir(user, track), lesson);
};
const metaPath = (user: string, track: string, lesson: string) => join(lessonDir(user, track, lesson), ".meta", "lesson.json");

export async function listLessons(user: string, track: string): Promise<LessonMeta[]> {
  const names = (await readdir(lessonsDir(user, track)).catch(() => [] as string[])).filter((n) => /^\d{2,3}-/.test(n)).sort();
  const out: LessonMeta[] = [];
  for (const n of names) {
    const m = await readJson<LessonMeta | undefined>(metaPath(user, track, n), undefined);
    if (m) out.push(m);
  }
  return out;
}

export async function getLesson(user: string, track: string, lesson: string): Promise<LessonMeta> {
  const m = await readJson<LessonMeta | undefined>(metaPath(user, track, lesson), undefined);
  if (!m) throw new HttpError(404, "lesson not found");
  return m;
}

export async function saveLessonMeta(user: string, track: string, meta: LessonMeta) {
  await writeJson(metaPath(user, track, meta.id), meta);
}

export async function nextLessonId(user: string, track: string, title: string): Promise<string> {
  const n = (await listLessons(user, track)).length + 1;
  return `${String(n).padStart(2, "0")}-${slugify(title, 40)}`;
}

/** Write a new lesson folder: learner files, tests, hidden reference solution and metadata. */
export async function writeLesson(
  user: string,
  track: string,
  meta: LessonMeta,
  files: { path: string; content: string }[],
  reference: { path: string; content: string }[],
) {
  const dir = lessonDir(user, track, meta.id);
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeAtomic(inside(dir, f.path), f.content);
  // The starter files as handed out, so the learner can start over.
  for (const f of files) if (meta.files.find((m) => m.path === f.path)?.role === "starter") await writeAtomic(inside(join(dir, ".meta", "starter"), f.path), f.content);
  for (const f of reference) await writeAtomic(inside(join(dir, ".reference"), f.path), f.content);
  await saveLessonMeta(user, track, meta);
}

export async function deleteLesson(user: string, track: string, lesson: string) {
  await getLesson(user, track, lesson);
  await rm(lessonDir(user, track, lesson), { recursive: true, force: true });
}

const MAX_FILE = 200_000;

export async function lessonFiles(user: string, track: string, lesson: string): Promise<{ path: string; editable: boolean; role: LessonFile["role"]; added?: boolean }[]> {
  const t = await getTrack(user, track);
  const meta = await getLesson(user, track, lesson);
  const dir = lessonDir(user, track, lesson);
  const r = runner(t.runner);
  const found: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ["target", "node_modules", "vendor", "__pycache__", "dist", "_build", "deps", "bin", "obj"].includes(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) found.push(relative(dir, full));
    }
  }
  await walk(dir);
  const roles = new Map(meta.files.map((f) => [f.path, f.role]));
  return found.sort().map((path) => {
    const role = roles.get(path) ?? (r.editable(path) ? "starter" : "support");
    // Container lessons let the learner change anything but the tests (manifests too, to add packages).
    // Otherwise a file is editable only when the runner says it is learner code and the generator did not mark it as a test.
    const editable = r.id === "container" ? role !== "test" && r.editable(path) : role === "starter" && r.editable(path);
    return { path, role, editable, ...(roles.has(path) ? {} : { added: true }) };
  });
}

export async function readLessonFile(user: string, track: string, lesson: string, rel: string): Promise<string> {
  if (!safeRel(rel)) throw new HttpError(400, "bad path");
  const full = inside(lessonDir(user, track, lesson), rel);
  const info = await stat(full).catch(() => undefined);
  if (!info?.isFile()) throw new HttpError(404, "file not found");
  if (info.size > MAX_FILE) throw new HttpError(413, "file too large");
  return readFile(full, "utf8");
}

export async function writeLessonFile(user: string, track: string, lesson: string, rel: string, content: string) {
  const entry = (await lessonFiles(user, track, lesson)).find((f) => f.path === rel);
  if (!entry?.editable) throw new HttpError(403, "only your own solution files can be edited");
  if (Buffer.byteLength(content) > MAX_FILE) throw new HttpError(413, "file too large");
  await writeAtomic(inside(lessonDir(user, track, lesson), rel), content);
  const meta = await getLesson(user, track, lesson);
  if (meta.status === "new") await saveLessonMeta(user, track, { ...meta, status: "started" });
}

export async function readReference(user: string, track: string, lesson: string): Promise<{ path: string; content: string }[]> {
  const dir = join(lessonDir(user, track, lesson), ".reference");
  const out: { path: string; content: string }[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push({ path: relative(dir, full), content: await readFile(full, "utf8") });
    }
  }
  await walk(dir);
  return out;
}

// ---------- materials ----------

const materialsDir = (user: string, track: string) => join(trackDir(user, track), "materials");
const MATERIAL_ID = /^m[a-z0-9]{6,20}$/;

export async function listMaterials(user: string, track: string): Promise<Material[]> {
  const names = (await readdir(materialsDir(user, track)).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
  const out: Material[] = [];
  for (const n of names) {
    const m = await readJson<Material | undefined>(join(materialsDir(user, track), n), undefined);
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export async function addMaterial(user: string, track: string, m: Omit<Material, "id" | "addedAt" | "chars">, text: string): Promise<Material> {
  const id = newId("m");
  const body = text.slice(0, 400_000);
  const material: Material = { ...m, id, addedAt: new Date().toISOString(), chars: body.length };
  await writeAtomic(join(materialsDir(user, track), `${id}.txt`), body);
  await writeJson(join(materialsDir(user, track), `${id}.json`), material);
  await touchTrack(user, track);
  return material;
}

export async function getMaterial(user: string, track: string, id: string): Promise<{ material: Material; text: string }> {
  if (!MATERIAL_ID.test(id)) throw new HttpError(400, "bad material id");
  const material = await readJson<Material | undefined>(join(materialsDir(user, track), `${id}.json`), undefined);
  if (!material) throw new HttpError(404, "material not found");
  const text = await readFile(join(materialsDir(user, track), `${id}.txt`), "utf8").catch(() => "");
  return { material, text };
}

export async function updateMaterial(user: string, track: string, id: string, patch: Partial<Pick<Material, "title" | "note" | "usedAt">>) {
  const { material } = await getMaterial(user, track, id);
  await writeJson(join(materialsDir(user, track), `${id}.json`), { ...material, ...patch });
}

export async function deleteMaterial(user: string, track: string, id: string) {
  await getMaterial(user, track, id);
  await rm(join(materialsDir(user, track), `${id}.json`), { force: true });
  await rm(join(materialsDir(user, track), `${id}.txt`), { force: true });
}

// ---------- coach log ----------

export type LogEntry = {
  at: string;
  track: string;
  lesson?: string;
  provider: string;
  threadId?: string;
  ceiling: number;
  assist?: number;
  verdict?: string;
  prompt?: string;
  message: string;
  reply: string;
  error?: string;
};

const logPath = (user: string) => join(userDir(user), "coach-log.jsonl");

export async function appendLog(user: string, entry: LogEntry) {
  await mkdir(userDir(user), { recursive: true });
  await appendFile(logPath(user), `${JSON.stringify(entry)}\n`, "utf8");
}

export type AssistSummary = { highest: number; turns: number };

/** Highest help level the coach reported for each lesson of a track. */
export async function assistByLesson(user: string, track: string): Promise<Record<string, AssistSummary>> {
  const out: Record<string, AssistSummary> = {};
  const text = await readFile(logPath(user), "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: LogEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.track !== track || !e.lesson || e.error) continue;
    const s = (out[e.lesson] ??= { highest: 0, turns: 0 });
    s.turns++;
    if (typeof e.assist === "number") s.highest = Math.max(s.highest, e.assist);
  }
  return out;
}

export async function starterContent(user: string, track: string, lesson: string, rel: string): Promise<string> {
  if (!safeRel(rel)) throw new HttpError(400, "bad path");
  return readFile(inside(join(lessonDir(user, track, lesson), ".meta", "starter"), rel), "utf8").catch(() => {
    throw new HttpError(404, "no starter copy of that file");
  });
}

/** The learner adds a file of their own to a lesson. */
export async function createLessonFile(user: string, track: string, lesson: string, rel: string, content: string) {
  if (!safeRel(rel)) throw new HttpError(400, "use a simple relative path such as src/helpers.ts");
  const t = await getTrack(user, track);
  if (!runner(t.runner).editable(rel)) throw new HttpError(403, "that name is reserved for tests or is not a learner file in this format");
  const full = inside(lessonDir(user, track, lesson), rel);
  if (await stat(full).catch(() => undefined)) throw new HttpError(409, "that file already exists");
  if (Buffer.byteLength(content) > MAX_FILE) throw new HttpError(413, "file too large");
  await writeAtomic(full, content);
}

/** Remove a file the learner added; files that came with the lesson stay. */
export async function deleteLessonFile(user: string, track: string, lesson: string, rel: string) {
  const meta = await getLesson(user, track, lesson);
  if (!safeRel(rel)) throw new HttpError(400, "bad path");
  if (meta.files.some((f) => f.path === rel)) throw new HttpError(403, "files that came with the lesson can be reset but not deleted");
  await rm(inside(lessonDir(user, track, lesson), rel), { force: true });
}
