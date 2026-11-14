import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type ChatEvent =
  | { type: "thread"; id: string }
  | { type: "delta"; text: string }
  | { type: "notice"; message: string }
  /** Progress the learner can see while waiting, such as a web search. */
  | { type: "activity"; message: string }
  | { type: "error"; message: string };

export type ChatRequest = {
  system: string;
  prompt: string;
  threadId?: string;
  /** Allow web search and page reading for this turn. */
  web?: boolean;
  signal: AbortSignal;
};

const KEEP = new Set(["CLAUDE_CODE_OAUTH_TOKEN"]);

/**
 * Child environment without API credentials, so both CLIs fall back to their
 * stored subscription logins (Claude.ai and ChatGPT) instead of billed API keys.
 */
export function subscriptionEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (KEEP.has(k)) env[k] = v;
    else if (/^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_API_KEY$|CLAUDECODE$)/.test(k)) continue;
    else env[k] = v;
  }
  env.NO_COLOR = "1";
  return env;
}

/** Spawn a CLI, write `input` to stdin and yield each stdout line parsed as JSON. */
export async function* jsonLines(
  bin: string,
  args: string[],
  opts: { cwd: string; input: string; signal: AbortSignal; timeoutMs: number },
): AsyncGenerator<Record<string, any>, { code: number | null; stderr: string }> {
  const child = spawn(bin, args, { cwd: opts.cwd, env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-4000);
  });
  const kill = () => child.kill("SIGTERM");
  opts.signal.addEventListener("abort", kill, { once: true });
  const timer = setTimeout(kill, opts.timeoutMs);
  const exited = new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", (err) => {
      stderr += String(err);
      resolve(null);
    });
  });
  child.stdin.on("error", () => {});
  child.stdin.end(opts.input);

  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (!line.startsWith("{")) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Ignore non-JSON log lines.
      }
    }
    return { code: await exited, stderr };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", kill);
    if (child.exitCode === null) kill();
  }
}
