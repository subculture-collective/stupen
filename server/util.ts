import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Resolve `rel` under `root`, refusing anything that escapes it. */
export function inside(root: string, rel: string): string {
  const full = resolve(root, rel);
  const back = relative(root, full);
  if (back === "" || back.startsWith("..") || isAbsolute(back)) throw new HttpError(400, "path outside its folder");
  return full;
}

/** A relative path made of safe segments: letters, digits, dot, dash, underscore; no dot-files. */
export function safeRel(rel: string): boolean {
  if (rel.length > 160 || rel.startsWith("/") || rel.includes("\\")) return false;
  const parts = rel.split("/");
  return parts.length <= 5 && parts.every((p) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(p) && p !== "." && p !== "..");
}

export async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  return readFile(path, "utf8").then((t) => JSON.parse(t) as T, () => fallback);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function slugify(text: string, max = 40): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  // Cut long slugs at a word boundary.
  const cut = s.length > max ? s.slice(0, max + 1).replace(/-[^-]*$/, "") || s.slice(0, max) : s;
  return cut.replace(/-$/, "") || "item";
}

export function newId(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${t}${r}`;
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[cut ${s.length - n} characters]` : s);
