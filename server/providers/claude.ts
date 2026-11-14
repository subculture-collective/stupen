import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { config } from "../config.ts";
import { type ChatEvent, type ChatRequest, jsonLines } from "./process.ts";

/** Claude's only tools when web access is on: search and page reading, nothing that touches this machine. */
export const CLAUDE_WEB_TOOLS = ["WebSearch", "WebFetch"];

export function claudeToolArgs(web: boolean): string[] {
  return web
    ? ["--tools", CLAUDE_WEB_TOOLS.join(","), "--allowedTools", CLAUDE_WEB_TOOLS.join(",")]
    : ["--tools", ""];
}

/**
 * Claude Code in print mode on the Claude.ai subscription login. No MCP
 * servers and no user settings; tools only when the learner allows the web.
 */
export async function* claudeChat(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const cwd = join(config.dataDir, "run", "claude");
  await mkdir(cwd, { recursive: true });
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...claudeToolArgs(Boolean(req.web)),
    "--setting-sources", "",
    "--strict-mcp-config",
    "--system-prompt", req.system,
  ];
  if (req.threadId) args.push("--resume", req.threadId);
  if (config.claudeModel) args.push("--model", config.claudeModel);

  const lines = jsonLines(config.claudeBin, args, { cwd, input: req.prompt, signal: req.signal, timeoutMs: config.chatTimeoutMs });

  let failed = false;
  let next = await lines.next();
  while (!next.done) {
    const msg = next.value;
    if (typeof msg.session_id === "string" && msg.type === "system" && msg.subtype === "init") {
      yield { type: "thread", id: msg.session_id };
      if (msg.apiKeySource && msg.apiKeySource !== "none") {
        yield { type: "notice", message: `Claude is using an API key (${msg.apiKeySource}), not the subscription login.` };
      }
    } else if (msg.type === "stream_event" && msg.event?.type === "content_block_delta" && msg.event.delta?.type === "text_delta") {
      yield { type: "delta", text: msg.event.delta.text };
    } else if (msg.type === "stream_event" && msg.event?.type === "content_block_start" && msg.event.content_block?.type === "server_tool_use") {
      yield { type: "activity", message: "Searching the web…" };
    } else if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const c of msg.message.content) {
        if (c.type === "tool_use" && c.name === "WebFetch") yield { type: "activity", message: `Reading ${String(c.input?.url ?? "a page").slice(0, 120)}` };
        else if (c.type === "tool_use" && c.name === "WebSearch") yield { type: "activity", message: `Searching: ${String(c.input?.query ?? "").slice(0, 120)}` };
      }
    } else if (msg.type === "result" && msg.is_error) {
      failed = true;
      yield { type: "error", message: String(msg.result ?? msg.subtype ?? "Claude returned an error") };
    }
    next = await lines.next();
  }
  const { code, stderr } = next.value;
  if (code !== 0 && !failed && !req.signal.aborted) yield { type: "error", message: `claude exited with ${code}: ${stderr.trim().slice(-800)}` };
}
