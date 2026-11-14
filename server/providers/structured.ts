import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "../config.ts";
import { claudeToolArgs } from "./claude.ts";
import { jsonLines } from "./process.ts";

export type Provider = "claude" | "codex";

/**
 * One request that must return JSON matching `schema`, on the same
 * subscription logins as the coach. With `web`, the model may search and read
 * pages (Claude: WebSearch and WebFetch only; Codex: hosted web search).
 * `onActivity` receives searches and page reads as they happen.
 */
export async function structured<T>(opts: {
  provider: Provider;
  system: string;
  prompt: string;
  schema: object;
  web?: boolean;
  signal?: AbortSignal;
  onActivity?: (message: string) => void;
}): Promise<T> {
  const base = join(config.dataDir, "run", "generate");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, `${opts.provider}-`));
  const signal = opts.signal ?? new AbortController().signal;
  const note = opts.onActivity ?? (() => {});
  try {
    if (opts.provider === "claude") {
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        ...claudeToolArgs(Boolean(opts.web)),
        "--setting-sources", "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--system-prompt", opts.system,
        "--json-schema", JSON.stringify(opts.schema),
      ];
      if (config.claudeModel) args.push("--model", config.claudeModel);
      const lines = jsonLines(config.claudeBin, args, { cwd: dir, input: opts.prompt, signal, timeoutMs: config.generateTimeoutMs });
      let result: any;
      let next = await lines.next();
      while (!next.done) {
        const msg = next.value;
        if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
          for (const c of msg.message.content) {
            if (c.type === "tool_use" && c.name === "WebSearch") note(`Searching the web: ${String(c.input?.query ?? "").slice(0, 140)}`);
            else if (c.type === "tool_use" && c.name === "WebFetch") note(`Reading ${String(c.input?.url ?? "").slice(0, 160)}`);
            else if (c.type === "server_tool_use") note(`Searching the web: ${String(c.input?.query ?? "").slice(0, 140)}`);
          }
        } else if (msg.type === "result") result = msg;
        next = await lines.next();
      }
      const { code, stderr } = next.value;
      if (!result) throw new Error(`claude returned no result (exit ${code}): ${stderr.trim().slice(-500)}`);
      if (result.is_error || !result.structured_output) {
        throw new Error(`claude failed: ${String(result.result ?? result.subtype ?? "no structured output").slice(0, 500)}`);
      }
      return result.structured_output as T;
    }

    const schemaPath = join(dir, "schema.json");
    const outPath = join(dir, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(opts.schema));
    const args = [
      ...(opts.web ? ["--search"] : []),
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "-c", 'sandbox_mode="read-only"',
      "-c", 'approval_policy="never"',
      "-c", `developer_instructions=${JSON.stringify(opts.system)}`,
      "--output-schema", schemaPath,
      "-o", outPath,
      "-",
    ];
    if (config.codexModel) args.splice(args.indexOf("exec") + 1, 0, "-m", config.codexModel);
    const lines = jsonLines(config.codexBin, args, { cwd: dir, input: opts.prompt, signal, timeoutMs: config.generateTimeoutMs });
    let failure: string | undefined;
    let next = await lines.next();
    while (!next.done) {
      const msg = next.value;
      if ((msg.type === "item.started" || msg.type === "item.completed") && msg.item?.type === "web_search" && msg.item.query) {
        if (msg.type === "item.started") note(`Searching the web: ${String(msg.item.query).slice(0, 140)}`);
      } else if (msg.type === "turn.failed" || msg.type === "error") failure = String(msg.error?.message ?? msg.message ?? "Codex turn failed");
      next = await lines.next();
    }
    const { code, stderr } = next.value;
    const text = await readFile(outPath, "utf8").catch(() => "");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(failure ?? `codex returned no JSON (exit ${code}): ${stderr.trim().slice(-500)}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Codex requires closed objects with every property listed as required; Claude accepts the same shape. */
export function obj(properties: Record<string, object>): object {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}
export const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
export const arr = (items: object, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });
export const enm = (values: string[], description?: string) => ({ type: "string", enum: values, ...(description ? { description } : {}) });
