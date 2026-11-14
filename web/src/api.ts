/** "claude" or "codex" (the server's subscription logins, admins only) or a connection id. */
export type Provider = string;

export type ModelChoice = { id: string; label: string; model: string; kind: string; web: boolean };
export type ProviderKind = { id: string; label: string; keyUrl: string; model: string; web: boolean; baseUrl?: boolean; oauth?: boolean };
export type Connection = { id: string; kind: string; label: string; model: string; baseUrl: string; web: boolean; createdAt: number; keyHint: string };
export type Models = { choices: ModelChoice[]; kinds: ProviderKind[]; connections: Connection[] };
export type Level = "new" | "beginner" | "intermediate" | "advanced" | "expert";
export type Trigger = "manual" | "lesson-start" | "check-fail" | "stuck" | "check-pass" | "grade";

export type RunnerInfo = { id: string; label: string; syntax: string; layout: string; graded: "coach" | null; ok: boolean; detail?: string };
export type Environment = {
  preset?: string;
  label: string;
  image: string;
  setup: string;
  install: string;
  check: string;
  preview: string;
  manifests: string[];
  layout: string;
  syntax: string;
  checkNetwork: boolean;
  env: Record<string, string>;
  memory: string;
  cpus: number;
  timeoutSec: number;
};
export type Me = {
  user: string;
  authMode: "accounts" | "proxy";
  isAdmin: boolean;
  sandbox: { sandboxed: boolean; detail: string };
  docker: { ok: boolean; detail?: string };
  runners: RunnerInfo[];
  environments: Environment[];
  levels: { id: Level; label: string }[];
};

export type Track = {
  id: string;
  title: string;
  subject: string;
  runner: string;
  customCommand?: string;
  environment?: Environment;
  level: Level;
  goals: string;
  background: string;
  style: string;
  sessionMinutes: number;
  defaultCeiling: number;
  provider: Provider;
  web: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Source = { title: string; url: string; note?: string };
export type OutlineItem = { id: string; title: string; objective: string; concepts: string[] };
export type Outline = { lessons: OutlineItem[]; sources: Source[]; updatedAt: string; summary?: string };

export type CheckResult = { command: string; exitCode: number | null; output: string; durationMs: number; timedOut: boolean };
export type Checks = { at: string; results: CheckResult[]; passed: boolean; sandboxed: boolean };
export type Help = { highest: number; turns: number } | null;

export type LessonMeta = {
  id: string;
  title: string;
  objective: string;
  outlineId?: string;
  brief: string;
  hints: string[];
  sources: Source[];
  files: { path: string; role: "starter" | "test" | "support" }[];
  materials?: string[];
  createdAt: string;
  status: "new" | "started" | "passed";
  attempts: number;
  passedAt?: string;
  verified: boolean;
  lastChecks?: Checks;
  failStreak?: number;
  revealedAt?: string;
};
export type LessonSummary = Omit<LessonMeta, "brief" | "lastChecks"> & { help: Help; lastPassed: boolean | null };

export type Material = {
  id: string;
  title: string;
  kind: "file" | "url" | "text" | "web";
  url?: string;
  fileName?: string;
  note: string;
  addedAt: string;
  chars: number;
  usedAt?: string;
};

export type Job = {
  id: string;
  track: string;
  kind: "plan" | "find" | "lesson";
  title: string;
  state: "running" | "done" | "failed" | "cancelled";
  log: string[];
  error?: string;
  result?: { lesson?: string; materials?: string[]; changes?: string };
  startedAt: string;
  finishedAt?: string;
};

export type TrackState = {
  track: Track;
  plan: string;
  outline: Outline;
  notes: string;
  history: string[];
  lessons: LessonSummary[];
  materials: Material[];
  jobs: Job[];
};

export type LessonFile = { path: string; editable: boolean; role: "starter" | "test" | "support"; added?: boolean };
export type LessonState = { meta: LessonMeta; files: LessonFile[]; help: Help };

export type Prompt = { id: string; label: string; text: string; trigger: Trigger; mode: "auto" | "suggest"; builtIn: boolean };
export type PromptLibrary = { prompts: Prompt[]; triggers: Record<Trigger, string>; placeholders: Record<string, string> };

export type ProviderStatus = Partial<Record<"claude" | "codex", { ok: boolean; detail: string }>>;

/** The path prefix the app is served under ("" or "/app"), from Vite's base. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Thrown when the session is missing or has ended; the app shows the sign-in page. */
export class SignInRequired extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", "x-study-coach": "1", ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    dispatchEvent(new Event("stupen:signin"));
    throw new SignInRequired(data.error ?? "Sign in first.");
  }
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export type AuthConfig = { mode: "accounts" | "proxy"; email?: boolean; github?: boolean; passkeys?: boolean; signup?: boolean };
export type AccountInfo = {
  id: string;
  email: string | null;
  name: string;
  isAdmin: boolean;
  createdAt: number;
  github: boolean;
  identities: { provider: string; login: string; createdAt: number }[];
  passkeys: { id: string; name: string; createdAt: number; lastUsed: number }[];
  sessions: { id: string; method: string; agent: string; createdAt: number; lastUsed: number; current: boolean }[];
};

export type AdminAccount = { id: string; email: string | null; name: string; isAdmin: boolean; disabled: boolean; createdAt: number; lastSeen: number; bytes: number; tracks: number };

export const auth = {
  config: () => call<AuthConfig>("/api/auth/config"),
  email: (email: string) => call<{ ok: true }>("/api/auth/email", json("POST", { email })),
  verify: (token: string) => call<{ ok: true }>("/api/auth/email/verify", json("POST", { token })),
  passkeyOptions: () => call<any>("/api/auth/passkey/options", { method: "POST" }),
  passkeyVerify: (response: unknown) => call<{ ok: true }>("/api/auth/passkey/verify", json("POST", { response })),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  account: () => call<AccountInfo>("/api/account"),
  addPasskeyOptions: () => call<any>("/api/account/passkeys/options", { method: "POST" }),
  addPasskey: (response: unknown, name: string) => call<{ ok: true }>("/api/account/passkeys", json("POST", { response, name })),
  deletePasskey: (id: string) => call<{ ok: true }>(`/api/account/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  endOtherSessions: () => call<{ ok: true }>("/api/account/sessions/end-others", { method: "POST" }),
  usage: () => call<{ bytes: number; limitBytes: number; tracks: number; trackLimit: number }>("/api/account/usage"),
  deleteAccount: (confirm: string) => call<{ ok: true }>("/api/account", json("DELETE", { confirm })),
  adminAccounts: () => call<AdminAccount[]>("/api/admin/accounts"),
  adminSetDisabled: (id: string, disabled: boolean) => call<{ ok: true }>(`/api/admin/accounts/${encodeURIComponent(id)}`, json("POST", { disabled })),
  adminDelete: (id: string) => call<{ ok: true }>(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
const q = encodeURIComponent;
const t = (id: string) => `/api/tracks/${q(id)}`;
const l = (track: string, lesson: string) => `${t(track)}/lessons/${q(lesson)}`;

export const api = {
  me: () => call<Me>("/api/me"),
  providers: () => call<ProviderStatus>("/api/providers"),
  models: () => call<Models>("/api/models"),
  saveConnection: (c: { id?: string; kind?: string; label?: string; model?: string; baseUrl?: string; key?: string }) => call<Connection>("/api/connections", json("POST", c)),
  deleteConnection: (id: string) => call<{ ok: true }>(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listModels: (q: { id?: string; kind?: string; key?: string; baseUrl?: string }) => call<{ models: string[] }>("/api/connections/models", json("POST", q)),
  tracks: () => call<Track[]>("/api/tracks"),
  createTrack: (fields: Partial<Track>) => call<Track>("/api/tracks", json("POST", fields)),
  track: (id: string) => call<TrackState>(t(id)),
  updateTrack: (id: string, fields: Partial<Track>) => call<Track>(t(id), json("PUT", fields)),
  deleteTrack: (id: string) => call<{ ok: true }>(t(id), { method: "DELETE" }),
  savePlan: (id: string, plan: string) => call<{ ok: true }>(`${t(id)}/plan`, json("PUT", { plan })),
  restorePlan: (id: string, name: string) => call<{ ok: true }>(`${t(id)}/plan/restore`, json("POST", { name })),
  saveNotes: (id: string, notes: string) => call<{ ok: true }>(`${t(id)}/notes`, json("PUT", { notes })),
  planJob: (id: string, opts: { instruction?: string; materialIds?: string[]; web?: boolean; provider?: Provider }) => call<Job>(`${t(id)}/jobs/plan`, json("POST", opts)),
  findJob: (id: string, opts: { query?: string; count?: number; incorporate?: boolean; provider?: Provider }) => call<Job>(`${t(id)}/jobs/find`, json("POST", opts)),
  lessonJob: (id: string, opts: { outlineId?: string; topic?: string; materialIds?: string[]; web?: boolean; provider?: Provider }) => call<Job>(`${t(id)}/jobs/lesson`, json("POST", opts)),
  jobs: (track?: string) => call<Job[]>(`/api/jobs${track ? `?track=${q(track)}` : ""}`),
  cancelJob: (id: string) => call<{ ok: true }>(`/api/jobs/${q(id)}/cancel`, { method: "POST" }),
  lesson: (track: string, lesson: string) => call<LessonState>(l(track, lesson)),
  deleteLesson: (track: string, lesson: string) => call<{ ok: true }>(l(track, lesson), { method: "DELETE" }),
  readFile: (track: string, lesson: string, path: string) => call<{ content: string }>(`${l(track, lesson)}/file?path=${q(path)}`),
  writeFile: (track: string, lesson: string, path: string, content: string) => call<{ ok: true }>(`${l(track, lesson)}/file`, json("PUT", { path, content })),
  starter: (track: string, lesson: string, path: string) => call<{ content: string }>(`${l(track, lesson)}/starter?path=${q(path)}`),
  check: (track: string, lesson: string) => call<{ checks: Checks; meta: LessonMeta; firstPass: boolean }>(`${l(track, lesson)}/check`, { method: "POST" }),
  preview: (track: string, lesson: string) => call<{ html?: string; result: CheckResult }>(`${l(track, lesson)}/preview`, { method: "POST" }),
  newFile: (track: string, lesson: string, path: string, content = "") => call<{ ok: true }>(`${l(track, lesson)}/files`, json("POST", { path, content })),
  deleteFile: (track: string, lesson: string, path: string) => call<{ ok: true }>(`${l(track, lesson)}/file?path=${q(path)}`, { method: "DELETE" }),
  solution: (track: string, lesson: string) => call<{ files: { path: string; content: string }[] }>(`${l(track, lesson)}/solution`, { method: "POST" }),
  material: (track: string, id: string) => call<{ material: Material; text: string }>(`${t(track)}/materials/${q(id)}`),
  addMaterial: (track: string, body: { kind: "url" | "text" | "file"; url?: string; title?: string; text?: string; name?: string; data?: string; note?: string }) =>
    call<Material>(`${t(track)}/materials`, json("POST", body)),
  updateMaterial: (track: string, id: string, patch: { title?: string; note?: string }) => call<{ ok: true }>(`${t(track)}/materials/${q(id)}`, json("PATCH", patch)),
  deleteMaterial: (track: string, id: string) => call<{ ok: true }>(`${t(track)}/materials/${q(id)}`, { method: "DELETE" }),
  prompts: () => call<PromptLibrary>("/api/prompts"),
  savePrompts: (prompts: Prompt[]) => call<{ prompts: Prompt[] }>("/api/prompts", json("PUT", { prompts })),
  resetPrompts: () => call<{ prompts: Prompt[] }>("/api/prompts/reset", { method: "POST" }),
};

export type ChatStreamEvent =
  | { event: "thread"; data: { id: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "notice"; data: { message: string } }
  | { event: "activity"; data: { message: string } }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { assist: number | null; verdict: "pass" | "revise" | null; help: Help; aborted: boolean } };

export type ChatBody = { track: string; lesson?: string; provider: Provider; message: string; ceiling: number; threadId?: string; web: boolean; promptId?: string; material?: string };

export async function* chatStream(body: ChatBody, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-study-coach": "1" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) } as ChatStreamEvent;
    }
  }
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the page still works for this load.
  }
}
