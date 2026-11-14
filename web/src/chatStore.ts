import { useSyncExternalStore } from "react";

import { type ChatBody, chatStream, type Help, load, type Provider, save } from "./api.ts";

export type Message = {
  role: "learner" | "coach" | "note";
  text: string;
  provider?: Provider;
  ceiling?: number;
  assist?: number | null;
  verdict?: "pass" | "revise" | null;
  /** The library prompt this message came from, and whether a trigger sent it. */
  prompt?: { id: string; label: string; auto: boolean };
  web?: boolean;
  /** Progress lines shown while waiting (web searches). */
  activity?: string[];
  state?: "streaming" | "stopped" | "failed" | undefined;
  error?: string;
};
export type Saved = { threadId?: string; messages: Message[] };

/**
 * Conversations live outside the chat component, so a reply keeps streaming
 * when the learner moves to another lesson and is there on return.
 */
const convos = new Map<string, Saved>();
const running = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

/** One conversation per lesson (or per track when no lesson is open) and provider. */
export const chatKey = (track: string, lesson: string | undefined, provider: Provider) => `study-coach:chat:${track}:${lesson ?? "-"}:${provider}`;

function get(key: string): Saved {
  let c = convos.get(key);
  if (!c) {
    const raw = load<Saved>(key, { messages: [] });
    c = { ...raw, messages: raw.messages.map((m) => (m.state === "streaming" && !running.has(key) ? { ...m, state: "stopped" } : m)) };
    convos.set(key, c);
  }
  return c;
}

function set(key: string, fn: (c: Saved) => Saved) {
  const next = fn(get(key));
  convos.set(key, next);
  save(key, next);
  emit();
}

export type SendResult = { ok: boolean; assist?: number | null; verdict?: "pass" | "revise" | null; help?: Help; error?: string };

export const chatStore = {
  get,
  clear: (key: string) => set(key, () => ({ messages: [] })),
  note: (key: string, text: string) => set(key, (c) => ({ ...c, messages: [...c.messages, { role: "note", text }] })),
  busy: (key: string) => running.has(key),
  stop: (key: string) => running.get(key)?.abort(),

  async send(key: string, body: Omit<ChatBody, "threadId">, extra: { prompt?: Message["prompt"]; retryIndex?: number; beforeSend?: () => Promise<void> } = {}): Promise<SendResult> {
    if (running.has(key)) return { ok: false };
    const ctrl = new AbortController();
    running.set(key, ctrl);
    const patchLast = (fn: (m: Message) => Message) => set(key, (c) => ({ ...c, messages: [...c.messages.slice(0, -1), fn(c.messages.at(-1)!)] }));
    set(key, (c) => {
      const base = extra.retryIndex === undefined ? c.messages : c.messages.slice(0, extra.retryIndex);
      return {
        ...c,
        messages: [
          ...base,
          { role: "learner", text: body.message, ceiling: body.ceiling, web: body.web, ...(extra.prompt ? { prompt: extra.prompt } : {}) },
          { role: "coach", text: "", provider: body.provider, state: "streaming" },
        ],
      };
    });
    let result: SendResult = { ok: false };
    let finished = false;
    try {
      await extra.beforeSend?.();
      const threadId = get(key).threadId;
      for await (const ev of chatStream({ ...body, ...(threadId ? { threadId } : {}) }, ctrl.signal)) {
        if (ev.event === "thread") set(key, (c) => ({ ...c, threadId: ev.data.id }));
        else if (ev.event === "delta") patchLast((m) => ({ ...m, text: m.text + ev.data.text }));
        else if (ev.event === "activity") patchLast((m) => ({ ...m, activity: [...(m.activity ?? []), ev.data.message].slice(-6) }));
        else if (ev.event === "notice") patchLast((m) => ({ ...m, text: `${m.text}\n\n> ${ev.data.message}` }));
        else if (ev.event === "error") {
          patchLast((m) => ({ ...m, state: "failed", error: ev.data.message }));
          result = { ok: false, error: ev.data.message };
        } else if (ev.event === "done") {
          finished = true;
          patchLast((m) => ({ ...m, assist: ev.data.assist, verdict: ev.data.verdict, state: ev.data.aborted ? "stopped" : m.state === "failed" ? "failed" : undefined }));
          if (!result.error) result = { ok: !ev.data.aborted, assist: ev.data.assist, verdict: ev.data.verdict, help: ev.data.help };
        }
      }
      if (!finished && !result.error) {
        patchLast((m) => ({ ...m, state: "failed", error: "the connection closed before the reply finished" }));
        result = { ok: false, error: "the connection closed before the reply finished" };
      }
    } catch (e) {
      if (ctrl.signal.aborted) patchLast((m) => ({ ...m, state: "stopped" }));
      else {
        patchLast((m) => ({ ...m, state: "failed", error: (e as Error).message }));
        result = { ok: false, error: (e as Error).message };
      }
    } finally {
      running.delete(key);
      emit();
    }
    return result;
  },
};

export function useChats(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
