import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
const env = process.env;
const xdgData = env.XDG_DATA_HOME ?? join(home, ".local/share");

export const config = {
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 5183),
  /** Listen on this Unix socket instead of a TCP port; its folder is made private (mode 700). */
  socket: env.SOCKET || undefined,
  production: env.NODE_ENV === "production",
  /** Every learner's tracks, lessons, materials and prompts live here, one folder per user. */
  dataDir: resolve(env.STUDY_DATA_DIR ?? join(xdgData, "study-coach")),
  /** Toolchains installed once for sandboxed checks (a Python venv with pytest). */
  toolsDir: resolve(env.STUDY_TOOLS_DIR ?? join(xdgData, "study-coach-tools")),
  appDir: resolve(import.meta.dirname, ".."),
  /**
   * The signed-in user's name, set by the reverse proxy after authentication
   * (Authelia's Remote-User). Without it everyone is the single "local" user.
   */
  userHeader: (env.USER_HEADER ?? "remote-user").toLowerCase(),
  /** When set, requests must carry this header value; the proxy adds it after authentication. */
  edgeSecretHeader: (env.EDGE_SECRET_HEADER ?? "x-edge-secret").toLowerCase(),
  edgeSecret: env.EDGE_SECRET || undefined,
  /** Run learner and generated code in bubblewrap with no network and no home folder. */
  sandbox: env.STUDY_SANDBOX !== "0",
  claudeBin: env.CLAUDE_BIN ?? "claude",
  codexBin: env.CODEX_BIN ?? "codex",
  claudeModel: env.CLAUDE_MODEL || undefined,
  codexModel: env.CODEX_MODEL || undefined,
  checkTimeoutMs: Number(env.CHECK_TIMEOUT_MS ?? 120_000),
  chatTimeoutMs: 600_000,
  generateTimeoutMs: 1_200_000,
};
