import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { cookie } from "./auth.ts";
import { config } from "./config.ts";
import { saveConnection } from "./connections.ts";
import { HttpError } from "./util.ts";

/**
 * OpenRouter's PKCE flow: the learner signs in at openrouter.ai and approves
 * Stupen, and OpenRouter issues a key for their own account. No key pasting.
 * https://openrouter.ai/docs/use-cases/oauth-pkce
 */
const COOKIE = "stupen_or_pkce";

export function openrouterStart(): { location: string; setCookie: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const u = new URL("https://openrouter.ai/auth");
  u.searchParams.set("callback_url", `${config.publicOrigin}${config.basePath}/auth/openrouter/callback`);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return { location: u.toString(), setCookie: cookie(COOKIE, verifier, 900) };
}

export async function openrouterCallback(user: string, req: IncomingMessage, url: URL) {
  const code = url.searchParams.get("code");
  if (!code || code.length > 500) throw new HttpError(400, "OpenRouter did not return a code.");
  const verifier = /(?:^|;\s*)stupen_or_pkce=([A-Za-z0-9_-]{20,100})/.exec(req.headers.cookie ?? "")?.[1];
  if (!verifier) throw new HttpError(400, "The OpenRouter connection expired. Try again.");
  const r = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await r.json().catch(() => ({}))) as { key?: string; error?: { message?: string } };
  if (!r.ok || !data.key) throw new HttpError(502, `OpenRouter refused the connection: ${data.error?.message ?? r.status}`);
  return saveConnection(user, { kind: "openrouter", label: "OpenRouter", model: "openrouter/auto", key: data.key });
}

export const clearPkce = () => cookie(COOKIE, "", 0);
