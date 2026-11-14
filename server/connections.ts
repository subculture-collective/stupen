import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAccount } from "./auth.ts";
import { config } from "./config.ts";
import { database } from "./db.ts";
import { HttpError } from "./util.ts";

/**
 * A learner's own model connections: their API keys for Anthropic, OpenAI,
 * Google and others, or an OpenRouter account. Keys are encrypted at rest
 * (AES-256-GCM with a server key) and never sent back to the browser.
 */
export type Kind = "anthropic" | "openai" | "google" | "mistral" | "groq" | "deepseek" | "xai" | "openrouter" | "compatible";

export type KindInfo = {
  id: Kind;
  label: string;
  keyUrl: string;
  /** A sensible model to start with; the model list from the provider replaces it. */
  model: string;
  web: boolean;
  baseUrl?: boolean;
  oauth?: boolean;
};

export const KINDS: KindInfo[] = [
  { id: "anthropic", label: "Anthropic (Claude)", keyUrl: "https://console.anthropic.com/settings/keys", model: "claude-sonnet-5-5", web: true },
  { id: "openai", label: "OpenAI (GPT)", keyUrl: "https://platform.openai.com/api-keys", model: "", web: true },
  { id: "google", label: "Google (Gemini)", keyUrl: "https://aistudio.google.com/apikey", model: "", web: true },
  { id: "openrouter", label: "OpenRouter (many models)", keyUrl: "https://openrouter.ai/settings/keys", model: "openrouter/auto", web: true, oauth: true },
  { id: "mistral", label: "Mistral", keyUrl: "https://console.mistral.ai/api-keys", model: "", web: false },
  { id: "groq", label: "Groq", keyUrl: "https://console.groq.com/keys", model: "", web: false },
  { id: "deepseek", label: "DeepSeek", keyUrl: "https://platform.deepseek.com/api_keys", model: "deepseek-chat", web: false },
  { id: "xai", label: "xAI (Grok)", keyUrl: "https://console.x.ai", model: "", web: false },
  { id: "compatible", label: "Other OpenAI-compatible API", keyUrl: "", model: "", web: false, baseUrl: true },
];
export const kindInfo = (k: string) => KINDS.find((x) => x.id === k);

/** The server's subscription logins, offered only to permitted accounts. */
export const CLI_PROVIDERS = [
  { id: "claude", label: "Claude (server subscription)" },
  { id: "codex", label: "ChatGPT (server subscription)" },
] as const;

export type Connection = { id: string; kind: Kind; label: string; model: string; baseUrl: string; web: boolean; createdAt: number; keyHint: string };
export type ConnectionWithKey = Connection & { key: string };


// ---- encryption --------------------------------------------------------------

let serverKey: Buffer | undefined;
function key(): Buffer {
  if (serverKey) return serverKey;
  const file = process.env.SECRET_KEY_FILE ?? join(config.dataDir, "secret.key");
  if (!existsSync(file)) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  serverKey = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (serverKey.length !== 32) throw new Error(`${file} must hold 32 bytes, base64-encoded`);
  return serverKey;
}

/** Encrypt with AES-256-GCM; the connection id is bound in as associated data. */
export function seal(plain: string, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
}

export function open(sealed: Uint8Array, aad: string): string {
  const b = Buffer.from(sealed);
  if (b[0] !== 1) throw new Error("unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8");
}

// ---- storage -----------------------------------------------------------------

function fromRow(r: any): Connection {
  const info = kindInfo(r.kind);
  return { id: r.id, kind: r.kind, label: r.label, model: r.model, baseUrl: r.base_url, web: Boolean(info?.web), createdAt: r.created_at, keyHint: r.key_hint };
}

export function listConnections(owner: string): Connection[] {
  return (database().prepare("SELECT * FROM connections WHERE owner = ? ORDER BY created_at").all(owner) as any[]).map(fromRow);
}

export function getConnection(owner: string, id: string): ConnectionWithKey | undefined {
  const r = database().prepare("SELECT * FROM connections WHERE owner = ? AND id = ?").get(owner, id) as any;
  return r ? { ...fromRow(r), key: open(r.secret, `${owner}:${r.id}`) } : undefined;
}

export function checkBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "Enter the API's base URL, such as https://example.com/v1.");
  }
  if (u.protocol !== "https:" && !(config.allowPrivateEndpoints && u.protocol === "http:")) throw new HttpError(400, "The base URL must use https.");
  if (u.username || u.password || u.search || u.hash) throw new HttpError(400, "Put the key in the key field, not in the URL.");
  return u.toString().replace(/\/+$/, "");
}

export function saveConnection(
  owner: string,
  input: { id?: unknown; kind?: unknown; label?: unknown; model?: unknown; baseUrl?: unknown; key?: unknown },
): Connection {
  const d = database();
  const existing = typeof input.id === "string" ? (d.prepare("SELECT * FROM connections WHERE owner = ? AND id = ?").get(owner, input.id) as any) : undefined;
  if (typeof input.id === "string" && !existing) throw new HttpError(404, "no such connection");
  const kind = (existing?.kind ?? input.kind) as Kind;
  const info = kindInfo(kind);
  if (!info) throw new HttpError(400, "Choose a provider.");
  const model = String(input.model ?? existing?.model ?? "").trim().slice(0, 120);
  if (!model) throw new HttpError(400, "Choose a model.");
  if (!/^[\w.:/@+-]+$/.test(model)) throw new HttpError(400, "That model name has characters providers do not use.");
  const baseUrl = info.baseUrl ? checkBaseUrl(String(input.baseUrl ?? existing?.base_url ?? "")) : "";
  const label = String(input.label ?? "").trim().slice(0, 60) || existing?.label || info.label.replace(/ \(.*\)$/, "");
  const rawKey = typeof input.key === "string" ? input.key.trim() : "";
  if (!existing && !rawKey) throw new HttpError(400, "Paste your API key.");
  if (rawKey && (rawKey.length > 400 || /\s/.test(rawKey))) throw new HttpError(400, "That does not look like an API key.");
  if (!existing && (d.prepare("SELECT COUNT(*) AS n FROM connections WHERE owner = ?").get(owner) as any).n >= 20) throw new HttpError(400, "You have 20 connections; remove one first.");
  const id = existing?.id ?? `c${randomBytes(6).toString("hex")}`;
  const hint = rawKey ? `…${rawKey.slice(-4)}` : existing.key_hint;
  if (existing) {
    d.prepare("UPDATE connections SET label = ?, model = ?, base_url = ?, key_hint = ? WHERE id = ?").run(label, model, baseUrl, hint, id);
    if (rawKey) d.prepare("UPDATE connections SET secret = ? WHERE id = ?").run(seal(rawKey, `${owner}:${id}`), id);
  } else {
    d.prepare("INSERT INTO connections (id, owner, kind, label, model, base_url, secret, key_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, owner, kind, label, model, baseUrl, seal(rawKey, `${owner}:${id}`), hint, Date.now(),
    );
  }
  return listConnections(owner).find((c) => c.id === id)!;
}

export function deleteConnection(owner: string, id: string) {
  database().prepare("DELETE FROM connections WHERE owner = ? AND id = ?").run(owner, id);
}

/** Whether this user may use the server's own subscription logins. */
export function mayUseServerLogins(user: string): boolean {
  if (config.authMode !== "accounts") return config.subscriptionAccounts?.has(user) ?? true;
  const account = getAccount(user);
  if (!account || account.disabled) return false;
  return config.subscriptionAccounts ? config.subscriptionAccounts.has(account.id) : account.isAdmin;
}

/** Every model choice this user has: their connections, plus any permitted server logins. */
export function providerChoices(user: string) {
  const own = listConnections(user).map((c) => ({ id: c.id, label: c.label, model: c.model, kind: c.kind, web: c.web }));
  const cli = mayUseServerLogins(user) ? CLI_PROVIDERS.map((p) => ({ id: p.id, label: p.label, model: "", kind: p.id, web: true })) : [];
  return [...own, ...cli];
}

/** A short name for logs and job progress: "Claude", or the connection's label and model. */
export function providerLabel(user: string, id: string): string {
  if (id === "claude") return "Claude";
  if (id === "codex") return "ChatGPT";
  const c = listConnections(user).find((x) => x.id === id);
  return c ? `${c.label} (${c.model})` : "a removed model";
}
