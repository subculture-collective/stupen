import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount, jsonSchema, type LanguageModel, type ModelMessage, Output, streamText, type ToolSet } from "ai";
import { Agent, fetch as undiciFetch } from "undici";

import { config } from "../config.ts";
import type { ConnectionWithKey, Kind } from "../connections.ts";
import { safeLookup } from "../fetch.ts";
import { userDir } from "../store.ts";
import { HttpError } from "../util.ts";
import type { ChatEvent, ChatRequest } from "./process.ts";

/** A fetch that refuses private, loopback and tailnet addresses at connect time, for user-supplied base URLs. */
const publicOnly = new Agent({ connect: { lookup: safeLookup as any }, headersTimeout: 120_000, bodyTimeout: 600_000 });
const guardedFetch = ((url: any, init: any) => (config.allowPrivateEndpoints ? fetch(url, init) : undiciFetch(url, { ...init, dispatcher: publicOnly }))) as unknown as typeof fetch;

type Built = { model: LanguageModel; tools?: ToolSet };

function build(c: ConnectionWithKey, web: boolean): Built {
  const apiKey = c.key;
  switch (c.kind) {
    case "anthropic": {
      const p = createAnthropic({ apiKey });
      return { model: p(c.model), ...(web ? { tools: { web_search: p.tools.webSearch_20250305({ maxUses: 5 }), web_fetch: p.tools.webFetch_20250910({ maxUses: 5 }) } as ToolSet } : {}) };
    }
    case "openai": {
      const p = createOpenAI({ apiKey });
      return { model: p(c.model), ...(web ? { tools: { web_search: p.tools.webSearch({}) } as ToolSet } : {}) };
    }
    case "google": {
      const p = createGoogleGenerativeAI({ apiKey });
      return { model: p(c.model), ...(web ? { tools: { google_search: p.tools.googleSearch({}) } as ToolSet } : {}) };
    }
    case "openrouter": {
      const p = createOpenRouter({ apiKey, appName: "Stupen", appUrl: "https://stupen.subcult.tv" } as any);
      return { model: p(c.model, web ? ({ plugins: [{ id: "web", max_results: 5 }] } as any) : undefined) as unknown as LanguageModel };
    }
    case "mistral":
      return { model: createMistral({ apiKey })(c.model) };
    case "groq":
      return { model: createGroq({ apiKey })(c.model) };
    case "deepseek":
      return { model: createDeepSeek({ apiKey })(c.model) };
    case "xai":
      return { model: createXai({ apiKey })(c.model) };
    case "compatible":
      return { model: createOpenAICompatible({ name: "custom", baseURL: c.baseUrl, apiKey, fetch: guardedFetch, supportsStructuredOutputs: true })(c.model) };
  }
}

function message(e: unknown): string {
  const err = e as any;
  const status = err?.statusCode ?? err?.status;
  const body = typeof err?.responseBody === "string" ? err.responseBody : "";
  const detail = /"message"\s*:\s*"([^"]{1,300})"/.exec(body)?.[1] ?? err?.message ?? String(e);
  if (status === 401 || status === 403) return `The provider refused the API key (${status}). Check it on the Models page.`;
  if (status === 429) return `The provider is rate-limiting this key (429): ${detail}`;
  return String(detail).slice(0, 500);
}

// ---- conversation threads (the CLIs keep their own; API models need the history sent each turn) ----

const MAX_HISTORY_CHARS = 120_000;
const threadFile = (user: string, id: string) => join(userDir(user), "threads", `${id}.json`);

async function loadThread(user: string, id: string | undefined): Promise<ModelMessage[]> {
  if (!id) return [];
  return JSON.parse(await readFile(threadFile(user, id), "utf8").catch(() => "[]")) as ModelMessage[];
}

async function saveThread(user: string, id: string, messages: ModelMessage[]) {
  // Keep the most recent turns that fit; the system prompt carries the lasting context.
  let kept = messages;
  while (kept.length > 2 && JSON.stringify(kept).length > MAX_HISTORY_CHARS) kept = kept.slice(2);
  await mkdir(join(userDir(user), "threads"), { recursive: true });
  await writeFile(threadFile(user, id), JSON.stringify(kept));
}

export async function* apiChat(user: string, c: ConnectionWithKey, req: ChatRequest): AsyncGenerator<ChatEvent> {
  const webOk = Boolean(req.web) && ["anthropic", "openai", "google", "openrouter"].includes(c.kind);
  if (req.web && !webOk) yield { type: "notice", message: `${c.label} has no web search here; answering without it.` };
  const thread = req.threadId && /^t[a-f0-9]{16}$/.test(req.threadId) ? req.threadId : `t${randomBytes(8).toString("hex")}`;
  yield { type: "thread", id: thread };
  const history = await loadThread(user, req.threadId === thread ? thread : undefined);
  const messages: ModelMessage[] = [...history, { role: "user", content: req.prompt }];
  const { model, tools } = build(c, webOk);
  let text = "";
  try {
    const result = streamText({ model, system: req.system, messages, ...(tools ? { tools, stopWhen: isStepCount(6) } : {}), abortSignal: req.signal, maxRetries: 1 });
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.text;
        yield { type: "delta", text: part.text };
      } else if (part.type === "tool-call") {
        const input = (part as any).input ?? {};
        yield { type: "activity", message: input.query ? `Searching: ${String(input.query).slice(0, 120)}` : input.url ? `Reading ${String(input.url).slice(0, 120)}` : "Searching the web…" };
      } else if (part.type === "error") {
        yield { type: "error", message: message(part.error) };
        return;
      }
    }
  } catch (e) {
    if (!req.signal.aborted) yield { type: "error", message: message(e) };
    return;
  }
  if (text) await saveThread(user, thread, [...messages, { role: "assistant", content: text }]);
}

export async function apiStructured<T>(
  c: ConnectionWithKey,
  opts: { system: string; prompt: string; schema: object; web?: boolean; signal?: AbortSignal; onActivity?: (m: string) => void },
): Promise<T> {
  const webOk = Boolean(opts.web) && ["anthropic", "openai", "google", "openrouter"].includes(c.kind);
  if (opts.web && !webOk) opts.onActivity?.(`${c.label} has no web search here; working from what it knows.`);
  const { model, tools } = build(c, webOk);
  try {
    const r = await generateText({
      model,
      system: opts.system,
      prompt: opts.prompt,
      output: Output.object({ schema: jsonSchema(opts.schema as any) }),
      ...(tools ? { tools, stopWhen: isStepCount(12) } : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
      maxRetries: 1,
      onStepFinish: (step: any) => {
        for (const call of step.toolCalls ?? []) {
          const input = call.input ?? {};
          opts.onActivity?.(input.query ? `Searching the web: ${String(input.query).slice(0, 140)}` : input.url ? `Reading ${String(input.url).slice(0, 160)}` : "Searching the web…");
        }
      },
    } as any);
    return (r as any).output as T;
  } catch (e) {
    throw new HttpError(502, message(e));
  }
}

// ---- model lists: also the "test this key" check ----

export async function listModels(kind: Kind, key: string, baseUrl = ""): Promise<string[]> {
  const get = async (url: string, headers: Record<string, string>, f: typeof fetch = fetch) => {
    const r = await f(url, { headers, signal: AbortSignal.timeout(15_000) } as any);
    if (r.status === 401 || r.status === 403) throw new HttpError(400, `The provider refused this key (${r.status}).`);
    if (!r.ok) throw new HttpError(502, `The provider's model list returned ${r.status}.`);
    return (await r.json()) as any;
  };
  const bearer = { authorization: `Bearer ${key}` };
  let ids: string[];
  switch (kind) {
    case "anthropic":
      ids = (await get("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key, "anthropic-version": "2023-06-01" })).data.map((m: any) => m.id);
      break;
    case "google":
      ids = (await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {})).models
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""));
      break;
    case "openrouter":
      await get("https://openrouter.ai/api/v1/key", bearer);
      ids = (await get("https://openrouter.ai/api/v1/models", {})).data.map((m: any) => m.id);
      break;
    case "compatible":
      ids = (await get(`${baseUrl}/models`, bearer, guardedFetch)).data.map((m: any) => m.id);
      break;
    default: {
      const base: Record<string, string> = {
        openai: "https://api.openai.com/v1",
        mistral: "https://api.mistral.ai/v1",
        groq: "https://api.groq.com/openai/v1",
        deepseek: "https://api.deepseek.com",
        xai: "https://api.x.ai/v1",
      };
      ids = (await get(`${base[kind]}/models`, bearer)).data.map((m: any) => m.id);
    }
  }
  const chatty = ids.filter((id) => !/embed|whisper|tts|dall-e|image|moderation|audio|transcribe|realtime|rerank|ocr|guard/i.test(id));
  return [...new Set(chatty)].sort().slice(0, 400);
}
