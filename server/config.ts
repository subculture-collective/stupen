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
  /**
   * "proxy": the signed-in user comes from `userHeader` (Authelia). "accounts":
   * Stupen's own accounts, with email sign-in links, GitHub and passkeys.
   */
  authMode: (env.AUTH_MODE === "accounts" ? "accounts" : "proxy") as "accounts" | "proxy",
  /** Where browsers reach the app, scheme and host only, e.g. https://stupen.subcult.tv. */
  publicOrigin: (env.PUBLIC_ORIGIN ?? `http://localhost:${env.WEB_PORT ?? 5184}`).replace(/\/+$/, ""),
  /** Path prefix the app is served under, e.g. /app; empty for the root. */
  basePath: (env.BASE_PATH ?? "").replace(/\/+$/, ""),
  /** Anyone may create an account; "closed" allows only existing accounts and ADMIN_EMAILS. */
  openSignup: env.SIGNUP !== "closed",
  /** Accounts with these email addresses are admins. */
  adminEmails: new Set((env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  /** email=folder pairs: a new account for that email keeps an existing users/<folder>. */
  legacyUsers: new Map(
    (env.LEGACY_USERS ?? "")
      .split(",")
      .map((p) => p.split("=").map((x) => x.trim()))
      .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]) && Boolean(p[1]))
      .map(([e, d]) => [e.toLowerCase(), d] as [string, string]),
  ),
  /** SMTP URL for sign-in links, e.g. smtps://user:pass@smtp-relay.brevo.com:465. "log" (or unset outside production) prints links to the log instead, for local testing. */
  smtpUrl: env.SMTP_URL || undefined,
  mailFrom: env.MAIL_FROM ?? "Stupen <info@subcult.tv>",
  /**
   * Let "Other OpenAI-compatible API" connections use http and private or
   * loopback addresses, such as Ollama on the same machine. Only for a
   * self-hosted copy whose users you trust: it lets them reach your network.
   */
  allowPrivateEndpoints: env.ALLOW_PRIVATE_ENDPOINTS === "1",
  githubClientId: env.GITHUB_CLIENT_ID || undefined,
  githubClientSecret: env.GITHUB_CLIENT_SECRET || undefined,
  /** Header with the client's address, set by a trusted proxy (e.g. cf-connecting-ip). */
  clientIpHeader: (env.CLIENT_IP_HEADER ?? "").toLowerCase() || undefined,
  sessionDays: Number(env.SESSION_DAYS ?? 30),
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
