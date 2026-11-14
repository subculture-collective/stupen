import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { createTransport } from "nodemailer";

import { config } from "./config.ts";
import { database } from "./db.ts";
import { HttpError } from "./util.ts";

export type Account = { id: string; email: string | null; name: string; isAdmin: boolean; disabled: boolean; createdAt: number };

const COOKIE = "stupen_session";
const now = () => Date.now();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
const secure = () => config.publicOrigin.startsWith("https://");
const rpID = () => new URL(config.publicOrigin).hostname;

function row(r: any): Account {
  return { id: r.id, email: r.email ?? null, name: r.name ?? "", isAdmin: Boolean(r.is_admin), disabled: Boolean(r.disabled), createdAt: r.created_at };
}

export function getAccount(id: string): Account | undefined {
  const r = database().prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  return r ? row(r) : undefined;
}

export function normalEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Enter a valid email address.");
  return e;
}

/** Folder-safe, unguessable account id; it is also the learner's data folder name. */
function newAccountId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = randomBytes(14);
  return "u" + [...b].map((x) => alphabet[x % 36]).join("");
}

function createAccount(email: string | null, name = ""): Account {
  const legacy = email ? config.legacyUsers.get(email) : undefined;
  const id = legacy && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(legacy) && !getAccount(legacy) ? legacy : newAccountId();
  const admin = email ? config.adminEmails.has(email) : false;
  if (!admin && !config.openSignup) throw new HttpError(403, "Sign-up is closed.");
  database()
    .prepare("INSERT INTO accounts (id, email, name, created_at, is_admin) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, name.slice(0, 120), now(), admin ? 1 : 0);
  return getAccount(id)!;
}

function accountByEmail(email: string): Account | undefined {
  const r = database().prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  return r ? row(r) : undefined;
}

function usable(a: Account): Account {
  if (a.disabled) throw new HttpError(403, "This account is disabled.");
  // Admin rights follow ADMIN_EMAILS, so they can be granted or removed by configuration.
  const admin = a.email ? config.adminEmails.has(a.email) : false;
  if (admin !== a.isAdmin) {
    database().prepare("UPDATE accounts SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, a.id);
    a.isAdmin = admin;
  }
  return a;
}

// ---- sessions --------------------------------------------------------------

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(secure() ? ["Secure"] : []),
  ].join("; ");
}

/** Creates a session and returns its Set-Cookie header. */
export function startSession(accountId: string, method: string, req: IncomingMessage): string {
  const t = token();
  const ttl = config.sessionDays * 86_400_000;
  database()
    .prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_used, expires_at, method, agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(hash(t), accountId, now(), now(), now() + ttl, method, String(req.headers["user-agent"] ?? "").slice(0, 200));
  database().prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").run(now(), accountId);
  return cookie(COOKIE, t, ttl / 1000);
}

export function endSession(req: IncomingMessage): string {
  const t = cookies(req)[COOKIE];
  if (t) database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(t));
  return cookie(COOKIE, "", 0);
}

/** The signed-in account, or undefined. Sessions slide: use within the lifetime extends them. */
export function sessionAccount(req: IncomingMessage): Account | undefined {
  const t = cookies(req)[COOKIE];
  if (!t || t.length > 100) return undefined;
  const d = database();
  const s = d.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash(t)) as any;
  if (!s) return undefined;
  if (s.expires_at < now()) {
    d.prepare("DELETE FROM sessions WHERE token_hash = ?").run(s.token_hash);
    return undefined;
  }
  const a = getAccount(s.account_id);
  if (!a || a.disabled) return undefined;
  if (now() - s.last_used > 10 * 60_000) {
    d.prepare("UPDATE sessions SET last_used = ?, expires_at = ? WHERE token_hash = ?").run(now(), now() + config.sessionDays * 86_400_000, s.token_hash);
    d.prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").run(now(), a.id);
  }
  return usable(a);
}

export function listSessions(accountId: string, req: IncomingMessage) {
  const current = cookies(req)[COOKIE];
  const currentHash = current ? hash(current) : "";
  return (database().prepare("SELECT * FROM sessions WHERE account_id = ? ORDER BY last_used DESC").all(accountId) as any[]).map((s) => ({
    id: s.token_hash.slice(0, 16),
    method: s.method,
    agent: s.agent,
    createdAt: s.created_at,
    lastUsed: s.last_used,
    current: s.token_hash === currentHash,
  }));
}

export function endOtherSessions(accountId: string, req: IncomingMessage) {
  const current = cookies(req)[COOKIE];
  database().prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash != ?").run(accountId, current ? hash(current) : "");
}

// ---- rate limits -----------------------------------------------------------

const buckets = new Map<string, number[]>();
/** At most `max` events per `windowMs` for `key`; throws 429 otherwise. */
export function limit(key: string, max: number, windowMs: number) {
  const t = now();
  const hits = (buckets.get(key) ?? []).filter((x) => t - x < windowMs);
  if (hits.length >= max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  hits.push(t);
  buckets.set(key, hits);
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (!v.some((x) => t - x < 3_600_000)) buckets.delete(k);
}

export function clientIp(req: IncomingMessage): string {
  const h = config.clientIpHeader ? req.headers[config.clientIpHeader] : undefined;
  const v = Array.isArray(h) ? h[0] : h;
  return (v?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown").slice(0, 64);
}

// ---- email sign-in links -----------------------------------------------------

const LINK_MINUTES = 15;
let mailer: ReturnType<typeof createTransport> | undefined;

export async function sendSignInLink(rawEmail: unknown, req: IncomingMessage): Promise<void> {
  const email = normalEmail(rawEmail);
  limit(`mail-ip:${clientIp(req)}`, 10, 3_600_000);
  limit(`mail-to:${email}`, 5, 3_600_000);
  if (!config.openSignup && !accountByEmail(email) && !config.adminEmails.has(email)) return; // say nothing about who has an account
  const t = token();
  database()
    .prepare("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hash(t), email, now(), now() + LINK_MINUTES * 60_000);
  const link = `${config.publicOrigin}${config.basePath}/#/verify/${t}`;
  const text = [
    "Here is your link to sign in to Stupen:",
    "",
    link,
    "",
    `It works once and expires in ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email; nothing changes without the link.`,
    "",
    "Stupen, a practice coach by SUBCULT. https://stupen.subcult.tv",
  ].join("\n");
  if (!config.smtpUrl || config.smtpUrl === "log") {
    if (config.production && config.smtpUrl !== "log") throw new HttpError(503, "Email sign-in is not set up on this server.");
    console.log(`[dev] sign-in link for ${email}: ${link}`);
    return;
  }
  mailer ??= createTransport(config.smtpUrl);
  await mailer.sendMail({ from: config.mailFrom, to: email, subject: "Your Stupen sign-in link", text });
}

/** Consumes a sign-in link token and returns the account, creating it on first sign-in. */
export function useSignInLink(raw: unknown, req: IncomingMessage): Account {
  limit(`verify-ip:${clientIp(req)}`, 30, 3_600_000);
  const t = String(raw ?? "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t)) throw new HttpError(400, "This sign-in link is not valid.");
  const d = database();
  const r = d.prepare("SELECT * FROM login_tokens WHERE token_hash = ?").get(hash(t)) as any;
  if (!r || r.used_at || r.expires_at < now()) throw new HttpError(400, "This sign-in link has expired or was already used. Ask for a new one.");
  d.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ?").run(now(), r.token_hash);
  d.prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(now() - 86_400_000);
  return usable(accountByEmail(r.email) ?? createAccount(r.email));
}

// ---- GitHub ------------------------------------------------------------------

export const githubEnabled = () => Boolean(config.githubClientId && config.githubClientSecret);

export function githubStart(req: IncomingMessage): { location: string; setCookie: string } {
  if (!githubEnabled()) throw new HttpError(404, "GitHub sign-in is not set up.");
  limit(`gh-ip:${clientIp(req)}`, 30, 3_600_000);
  const state = token(24);
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", config.githubClientId!);
  u.searchParams.set("redirect_uri", `${config.publicOrigin}${config.basePath}/auth/github/callback`);
  u.searchParams.set("scope", "read:user user:email");
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return { location: u.toString(), setCookie: cookie("stupen_gh_state", state, 600) };
}

export async function githubCallback(req: IncomingMessage, url: URL): Promise<Account> {
  if (!githubEnabled()) throw new HttpError(404, "GitHub sign-in is not set up.");
  const state = url.searchParams.get("state") ?? "";
  const want = cookies(req).stupen_gh_state ?? "";
  if (!state || state.length !== want.length || !timingSafeEqual(Buffer.from(state), Buffer.from(want))) throw new HttpError(400, "GitHub sign-in expired. Try again.");
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "GitHub did not return a sign-in code.");
  const tok = (await (
    await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: config.githubClientId, client_secret: config.githubClientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    })
  ).json()) as { access_token?: string; error_description?: string };
  if (!tok.access_token) throw new HttpError(400, `GitHub sign-in failed: ${tok.error_description ?? "no token"}`);
  const gh = async (path: string) => {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "stupen" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new HttpError(502, `GitHub returned ${r.status}`);
    return r.json() as Promise<any>;
  };
  const user = await gh("/user");
  const emails = (await gh("/user/emails")) as { email: string; primary: boolean; verified: boolean }[];
  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  const subject = String(user.id);
  const d = database();
  const linked = d.prepare("SELECT account_id FROM identities WHERE provider = 'github' AND subject = ?").get(subject) as any;
  let account: Account | undefined = linked ? getAccount(linked.account_id) : undefined;
  if (!account) {
    // Linking an extra sign-in method to the account that is already signed in.
    account = sessionAccount(req);
    if (!account && primary) account = accountByEmail(primary.email.toLowerCase());
    account ??= createAccount(primary ? primary.email.toLowerCase() : null, String(user.name ?? user.login ?? ""));
    d.prepare("INSERT INTO identities (provider, subject, account_id, login, created_at) VALUES ('github', ?, ?, ?, ?)").run(subject, account.id, String(user.login ?? ""), now());
  }
  return usable(account);
}

export function identities(accountId: string) {
  return (database().prepare("SELECT provider, login, created_at FROM identities WHERE account_id = ?").all(accountId) as any[]).map((r) => ({
    provider: r.provider,
    login: r.login,
    createdAt: r.created_at,
  }));
}

// ---- passkeys ----------------------------------------------------------------

const challenges = new Map<string, { value: string; expires: number }>();
function remember(key: string, value: string) {
  const t = now();
  for (const [k, v] of challenges) if (v.expires < t) challenges.delete(k);
  challenges.set(key, { value, expires: t + 5 * 60_000 });
}
function recall(key: string): string | undefined {
  const c = challenges.get(key);
  challenges.delete(key);
  return c && c.expires > now() ? c.value : undefined;
}

export function listPasskeys(accountId: string) {
  return (database().prepare("SELECT id, name, created_at, last_used FROM passkeys WHERE account_id = ? ORDER BY created_at").all(accountId) as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsed: r.last_used,
  }));
}

export function deletePasskey(accountId: string, id: string) {
  database().prepare("DELETE FROM passkeys WHERE account_id = ? AND id = ?").run(accountId, id);
}

export async function passkeyRegisterOptions(account: Account) {
  const existing = database().prepare("SELECT id, transports FROM passkeys WHERE account_id = ?").all(account.id) as any[];
  const options = await generateRegistrationOptions({
    rpName: "Stupen",
    rpID: rpID(),
    userName: account.email ?? account.name ?? account.id,
    userID: new TextEncoder().encode(account.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: JSON.parse(p.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  remember(`reg:${account.id}`, options.challenge);
  return options;
}

export async function passkeyRegister(account: Account, response: any, name: unknown) {
  const expected = recall(`reg:${account.id}`);
  if (!expected) throw new HttpError(400, "Passkey setup expired. Try again.");
  const v = await verifyRegistrationResponse({ response, expectedChallenge: expected, expectedOrigin: config.publicOrigin, expectedRPID: rpID() });
  if (!v.verified) throw new HttpError(400, "The passkey could not be verified.");
  const c = v.registrationInfo.credential;
  database()
    .prepare("INSERT INTO passkeys (id, account_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(c.id, account.id, c.publicKey, c.counter, JSON.stringify(c.transports ?? []), String(name ?? "Passkey").slice(0, 60) || "Passkey", now());
  return { ok: true };
}

export async function passkeyLoginOptions(req: IncomingMessage) {
  limit(`pk-ip:${clientIp(req)}`, 60, 3_600_000);
  const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: "preferred" });
  remember(`auth:${options.challenge}`, options.challenge);
  return options;
}

export async function passkeyLogin(response: any): Promise<Account> {
  const id = String(response?.id ?? "");
  const r = database().prepare("SELECT * FROM passkeys WHERE id = ?").get(id) as any;
  if (!r) throw new HttpError(400, "This passkey is not registered with Stupen.");
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: (c) => recall(`auth:${c}`) === c,
    expectedOrigin: config.publicOrigin,
    expectedRPID: rpID(),
    credential: { id: r.id, publicKey: new Uint8Array(r.public_key), counter: r.counter, transports: JSON.parse(r.transports) },
  });
  if (!v.verified) throw new HttpError(400, "The passkey could not be verified.");
  database().prepare("UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?").run(v.authenticationInfo.newCounter, now(), r.id);
  const a = getAccount(r.account_id);
  if (!a) throw new HttpError(400, "This passkey's account no longer exists.");
  return usable(a);
}

// ---- administration and deletion ---------------------------------------------

export function listAccounts() {
  return (database().prepare("SELECT * FROM accounts ORDER BY created_at DESC").all() as any[]).map((r) => ({ ...row(r), lastSeen: r.last_seen as number }));
}

export function setDisabled(id: string, disabled: boolean) {
  database().prepare("UPDATE accounts SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  if (disabled) database().prepare("DELETE FROM sessions WHERE account_id = ?").run(id);
}

/** Removes the account and everything tied to it in the database (sessions, passkeys, sign-in methods, model connections). */
export function deleteAccountRows(id: string) {
  const d = database();
  d.prepare("DELETE FROM connections WHERE owner = ?").run(id);
  d.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}
