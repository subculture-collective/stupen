import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { config } from "../config.ts";
import { type ChatEvent, type ChatRequest, jsonLines } from "./process.ts";

/**
 * Codex CLI `exec` on the ChatGPT subscription login, read-only sandbox in an
 * empty folder, ignoring the user's config and rules. `--search` adds the
 * hosted web search tool when the learner allows the web.
 */
export async function* codexChat(req: ChatRequest): AsyncGenerator<ChatEvent> {
  const cwd = join(config.dataDir, "run", "codex");
  await mkdir(cwd, { recursive: true });
  const shared = [
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-c", 'sandbox_mode="read-only"',
    "-c", 'approval_policy="never"',
    "-c", `developer_instructions=${JSON.stringify(req.system)}`,
  ];
  if (config.codexModel) shared.push("-m", config.codexModel);
  // --search is a top-level flag, so it comes before the subcommand.
  const top = req.web ? ["--search"] : [];
  const args = req.threadId ? [...top, "exec", "resume", req.threadId, ...shared, "-"] : [...top, "exec", ...shared, "-"];

  const lines = jsonLines(config.codexBin, args, { cwd, input: req.prompt, signal: req.signal, timeoutMs: config.chatTimeoutMs });

  let messages = 0;
  let failed = false;
  let next = await lines.next();
  while (!next.done) {
    const msg = next.value;
    if (msg.type === "thread.started" && typeof msg.thread_id === "string") {
      yield { type: "thread", id: msg.thread_id };
    } else if (msg.type === "item.started" && msg.item?.type === "web_search") {
      yield { type: "activity", message: `Searching: ${String(msg.item.query ?? "").slice(0, 120)}` };
    } else if (msg.type === "item.completed" && msg.item?.type === "agent_message" && typeof msg.item.text === "string") {
      yield { type: "delta", text: (messages++ ? "\n\n" : "") + msg.item.text };
    } else if (msg.type === "turn.failed" || msg.type === "error") {
      failed = true;
      yield { type: "error", message: String(msg.error?.message ?? msg.message ?? "Codex turn failed") };
    }
    next = await lines.next();
  }
  const { code, stderr } = next.value;
  if (code !== 0 && !failed && !req.signal.aborted) yield { type: "error", message: `codex exited with ${code}: ${stderr.trim().slice(-800)}` };
}
