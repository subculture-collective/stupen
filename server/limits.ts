import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { limit } from "./auth.ts";
import { userDir } from "./store.ts";
import { HttpError } from "./util.ts";

/**
 * Per-account limits for a public server: how often the costly things may
 * happen (they use the code runner, the web or the server's disk; model calls
 * are on each person's own key) and how much each account may store.
 * Admins are not limited. Numbers are per account.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RULES: { method: string; pattern: RegExp; kind: string; max: number; windowMs: number }[] = [
  { method: "POST", pattern: /^\/api\/tracks\/[^/]+\/lessons\/[^/]+\/check$/, kind: "checks", max: 150, windowMs: HOUR },
  { method: "POST", pattern: /^\/api\/tracks\/[^/]+\/lessons\/[^/]+\/preview$/, kind: "previews", max: 60, windowMs: HOUR },
  { method: "POST", pattern: /^\/api\/tracks\/[^/]+\/jobs\//, kind: "generation jobs", max: 60, windowMs: DAY },
  { method: "POST", pattern: /^\/api\/tracks\/[^/]+\/materials$/, kind: "new materials", max: 60, windowMs: DAY },
  { method: "POST", pattern: /^\/api\/chat$/, kind: "coach messages", max: 400, windowMs: DAY },
  { method: "POST", pattern: /^\/api\/tracks$/, kind: "new tracks", max: 20, windowMs: DAY },
  { method: "POST", pattern: /^\/api\/connections\/models$/, kind: "key checks", max: 60, windowMs: HOUR },
];

export const STORAGE_LIMIT_BYTES = 300 * 1024 * 1024;
export const TRACK_LIMIT = 40;

/** Throws 429 when this request would go over a rate limit for the account. */
export function checkRate(user: string, method: string, path: string) {
  for (const r of RULES) {
    if (r.method !== method || !r.pattern.test(path)) continue;
    try {
      limit(`quota:${r.kind}:${user}`, r.max, r.windowMs);
    } catch {
      throw new HttpError(429, `You have reached the limit of ${r.max} ${r.kind} per ${r.windowMs === HOUR ? "hour" : "day"}. Try again later.`);
    }
  }
}

const sizes = new Map<string, { at: number; bytes: number }>();
async function du(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name);
    if (e.isDirectory()) total += await du(full);
    else if (e.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Bytes stored for an account, cached for a minute. */
export async function storageUsed(user: string): Promise<number> {
  const c = sizes.get(user);
  if (c && Date.now() - c.at < 60_000) return c.bytes;
  const bytes = await du(userDir(user));
  sizes.set(user, { at: Date.now(), bytes });
  return bytes;
}

/** Throws 413 when an account that writes is already over its storage limit. */
export async function checkStorage(user: string, method: string) {
  if (method === "GET" || method === "DELETE") return;
  if ((await storageUsed(user)) > STORAGE_LIMIT_BYTES) {
    throw new HttpError(413, `Your account uses more than ${STORAGE_LIMIT_BYTES / 1024 / 1024} MB. Delete materials, lessons or tracks to make room.`);
  }
}

export const forgetStorage = (user: string) => sizes.delete(user);
