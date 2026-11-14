import { useEffect, useMemo, useRef, useState } from "react";

import { api, type Help, type LessonMeta, load, type Material, type Prompt, type Provider, save, type Track, type Trigger } from "./api.ts";
import { chatKey, type Message, chatStore, useChats } from "./chatStore.ts";
import { LADDER } from "./ladder.ts";
import { Md } from "./Md.tsx";
import { choiceLabel, ModelPicker, useModels } from "./ModelPicker.tsx";
import { fill } from "./text.ts";

/** Values a prompt template can use; the workbench keeps them current. */
export type PromptVars = { file?: string; selection?: string; failing?: string };

type Fire = (trigger: Trigger, vars?: PromptVars) => void;
const firers = new Set<Fire>();
/** A trigger that fired while the coach was not on screen (phones show one pane at a time). */
let pending: { trigger: Trigger; vars?: PromptVars | undefined; at: number } | undefined;
/** Tell the coach that something happened (checks failed, lesson opened); it sends or suggests the matching prompts. */
export function fireTrigger(trigger: Trigger, vars?: PromptVars) {
  if (!firers.size) {
    pending = { trigger, vars, at: Date.now() };
    return;
  }
  for (const f of firers) f(trigger, vars);
}

let promptCache: Promise<Prompt[]> | undefined;
export function loadPrompts(force = false): Promise<Prompt[]> {
  if (force || !promptCache) promptCache = api.prompts().then((p) => p.prompts);
  return promptCache;
}

const LEVEL_WORD: Record<string, string> = { new: "brand new", beginner: "beginner", intermediate: "intermediate", advanced: "advanced", expert: "expert" };

export function Coach(props: {
  track: Track;
  lesson?: LessonMeta | undefined;
  materials: Material[];
  vars: () => PromptVars;
  /** Save open edits before the coach reads the files. */
  beforeSend: () => Promise<void>;
  onHelp?: (h: Help) => void;
  onVerdict?: (v: "pass" | "revise") => void;
}) {
  useChats();
  const { track, lesson } = props;
  const [provider, setProvider] = useState<Provider>(() => load(`study-coach:provider:${track.id}`, track.provider));
  const ceilingKey = `study-coach:ceiling:${track.id}:${lesson?.id ?? "-"}`;
  const [ceiling, setCeiling] = useState<number>(() => load(ceilingKey, track.defaultCeiling));
  const [web, setWeb] = useState<boolean>(() => load(`study-coach:web:${track.id}`, false));
  const coachModels = useModels();
  const canSearch = coachModels?.choices.find((c) => c.id === provider)?.web ?? true;
  const [auto, setAuto] = useState<boolean>(() => load("study-coach:auto-prompts", true));
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const key = chatKey(track.id, lesson?.id, provider);
  const convo = chatStore.get(key);
  const busy = chatStore.busy(key);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadPrompts().then(setPrompts, () => {});
  }, []);
  useEffect(() => setCeiling(load(ceilingKey, track.defaultCeiling)), [ceilingKey, track.defaultCeiling]);
  useEffect(() => setSuggested([]), [lesson?.id]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [convo.messages.length, convo.messages.at(-1)?.text.length]);

  const baseVars = () => ({ subject: track.subject, level: LEVEL_WORD[track.level] ?? track.level, lesson: lesson?.title ?? "", objective: lesson?.objective ?? "", ...props.vars() });

  const send = async (text: string, prompt?: Prompt, isAuto = false) => {
    const message = text.trim();
    if (!message || chatStore.busy(key)) return;
    const material = attach || undefined;
    setAttach("");
    const r = await chatStore.send(
      key,
      { track: track.id, ...(lesson ? { lesson: lesson.id } : {}), provider, message, ceiling, web: web && canSearch, ...(prompt ? { promptId: prompt.id } : {}), ...(material ? { material } : {}) },
      { ...(prompt ? { prompt: { id: prompt.id, label: prompt.label, auto: isAuto } } : {}), beforeSend: props.beforeSend },
    );
    if (r.help !== undefined) props.onHelp?.(r.help);
    if (r.verdict) props.onVerdict?.(r.verdict);
  };

  const usePrompt = (p: Prompt, isAuto = false) => {
    setSuggested((s) => s.filter((id) => id !== p.id));
    void send(fill(p.text, baseVars()), p, isAuto);
  };

  // Triggers from the workbench: send the first automatic prompt, suggest the rest.
  const live = useRef({ auto, baseVars });
  live.current = { auto, baseVars };
  useEffect(() => {
    const onFire: Fire = (trigger, vars) => {
      void loadPrompts().then((all) => {
        const { auto } = live.current;
        const matching = all.filter((p) => p.trigger === trigger);
        if (!matching.length) return;
        const autoOne = trigger === "grade" ? matching[0] : auto ? matching.find((p) => p.mode === "auto") : undefined;
        if (autoOne) void send(fill(autoOne.text, { ...live.current.baseVars(), ...vars }), autoOne, true);
        setSuggested(matching.filter((p) => p !== autoOne).map((p) => p.id));
      });
    };
    firers.add(onFire);
    if (pending && Date.now() - pending.at < 10 * 60_000) {
      const p = pending;
      pending = undefined;
      onFire(p.trigger, p.vars);
    }
    return () => {
      firers.delete(onFire);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ceiling, web, attach]);

  const chips = useMemo(() => {
    const manual = prompts.filter((p) => p.trigger !== "grade");
    const sugg = suggested.map((id) => prompts.find((p) => p.id === id)).filter((p): p is Prompt => Boolean(p));
    const rest = manual.filter((p) => !suggested.includes(p.id) && (p.trigger === "manual" || p.trigger === "lesson-start"));
    return { sugg, top: rest.slice(0, sugg.length ? 2 : 4), more: manual.filter((p) => !sugg.includes(p)) };
  }, [prompts, suggested]);

  const setLimit = (n: number) => {
    setCeiling(n);
    save(ceilingKey, n);
    chatStore.note(key, `Help limit set to ${n} (${LADDER[n]!.split("·")[1]!.split(":")[0]!.trim()})`);
  };

  return (
    <section className="coach" aria-label="Coach">
      <div className="coach-head">
        <h2>Coach</h2>
        <ModelPicker
          value={provider}
          disabled={busy}
          label="Coach model"
          onChange={(p) => {
            setProvider(p);
            save(`study-coach:provider:${track.id}`, p);
          }}
        />
        <span className="spacer" />
        <button type="button" className="link small" onClick={() => chatStore.clear(key)} disabled={busy || !convo.messages.length}>
          New chat
        </button>
      </div>
      <div className="coach-controls">
        <label className="limit" title={LADDER[ceiling]}>
          <span className="small">Help limit</span>
          <select value={ceiling} onChange={(e) => setLimit(Number(e.target.value))} aria-describedby="limit-desc">
            {LADDER.map((l, i) => (
              <option key={i} value={i}>
                {l.split(":")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle small" title={canSearch ? "The coach may search and read web pages for its replies" : "This model has no web search in Stupen"}>
          <input
            type="checkbox"
            disabled={!canSearch}
            checked={web && canSearch}
            onChange={(e) => {
              setWeb(e.target.checked);
              save(`study-coach:web:${track.id}`, e.target.checked);
            }}
          />
          Web
        </label>
        <label className="toggle small" title="Send prompts automatically when checks pass or fail, or when you open a new lesson">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              save("study-coach:auto-prompts", e.target.checked);
            }}
          />
          Auto prompts
        </label>
      </div>
      <p id="limit-desc" className="small muted limit-desc">
        {LADDER[ceiling]}
      </p>

      <div className="messages" ref={list} aria-live="polite">
        {!convo.messages.length && (
          <div className="empty-chat muted small">
            <p>{lesson ? "Ask anything about this lesson, or pick a prompt below." : "No lesson open. Ask about the track, the plan, or anything you're learning."}</p>
            <p>The coach sees the lesson files and your latest checks with every message, and stays within your help limit.</p>
          </div>
        )}
        {convo.messages.map((m, i) => (
          <MessageView key={i} m={m} retry={m.state === "failed" && m.role === "coach" ? () => void retry(i) : undefined} />
        ))}
      </div>

      <div className="prompt-chips" role="group" aria-label="Prompts">
        {chips.sugg.map((p) => (
          <button key={p.id} type="button" className="chip suggested" disabled={busy} onClick={() => usePrompt(p)} title={p.text}>
            <span className="sugg-label">Suggested</span> {p.label}
          </button>
        ))}
        {chips.top.map((p) => (
          <button key={p.id} type="button" className="chip" disabled={busy} onClick={() => usePrompt(p)} title={p.text}>
            {p.label}
          </button>
        ))}
        <div className="more-prompts">
          <button type="button" className="chip" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            All prompts…
          </button>
          {moreOpen && (
            <div className="prompt-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setMoreOpen(false)}>
              {chips.more.map((p) => (
                <div key={p.id} className="prompt-menu-row">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => {
                      setMoreOpen(false);
                      usePrompt(p);
                    }}
                  >
                    {p.label}
                  </button>
                  <button
                    type="button"
                    className="link small"
                    aria-label={`Edit “${p.label}” before sending`}
                    onClick={() => {
                      setMoreOpen(false);
                      setDraft(fill(p.text, baseVars()));
                      requestAnimationFrame(() => composer.current?.focus());
                    }}
                  >
                    Edit first
                  </button>
                </div>
              ))}
              <a className="small" href="#/prompts">
                Manage prompts and triggers
              </a>
            </div>
          )}
        </div>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft;
          setDraft("");
          void send(text);
        }}
      >
        <textarea
          ref={composer}
          value={draft}
          rows={3}
          aria-label="Message to the coach"
          placeholder={lesson ? "Ask the coach…  (Enter sends, Shift+Enter for a new line)" : "Ask about the track…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const text = draft;
              setDraft("");
              void send(text);
            }
          }}
        />
        <div className="composer-row">
          {props.materials.length > 0 && (
            <select className="attach" value={attach} aria-label="Attach a material to the next message" onChange={(e) => setAttach(e.target.value)}>
              <option value="">Attach material…</option>
              {props.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title.slice(0, 50)}
                </option>
              ))}
            </select>
          )}
          <span className="spacer" />
          {busy ? (
            <button type="button" onClick={() => chatStore.stop(key)}>
              Stop
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );

  async function retry(index: number) {
    const learner = convo.messages[index - 1];
    if (!learner || learner.role !== "learner") return;
    await chatStore.send(
      key,
      { track: track.id, ...(lesson ? { lesson: lesson.id } : {}), provider, message: learner.text, ceiling, web, ...(learner.prompt ? { promptId: learner.prompt.id } : {}) },
      { ...(learner.prompt ? { prompt: learner.prompt } : {}), retryIndex: index - 1, beforeSend: props.beforeSend },
    );
  }
}

function MessageView(props: { m: Message; retry?: (() => void) | undefined }) {
  const { m } = props;
  const models = useModels();
  if (m.role === "note") return <p className="note small muted">{m.text}</p>;
  if (m.role === "learner")
    return (
      <div className="msg learner">
        {m.prompt && <span className="msg-tag small">{m.prompt.auto ? `Sent automatically: ${m.prompt.label}` : m.prompt.label}</span>}
        <Md>{m.text}</Md>
      </div>
    );
  return (
    <div className={`msg coach-msg ${m.state ?? ""}`}>
      {m.state === "streaming" && !m.text && (
        <p className="muted small thinking">
          <span className="spinner" aria-hidden="true" /> {m.activity?.at(-1) ?? "Thinking…"}
        </p>
      )}
      {m.text && <Md>{m.text}</Md>}
      <div className="msg-meta small muted">
        {choiceLabel(models?.choices, m.provider)}
        {typeof m.assist === "number" && <span className="pill">help {m.assist}</span>}
        {m.verdict === "pass" && <span className="pill pill-ok">passed</span>}
        {m.verdict === "revise" && <span className="pill pill-warn">revise</span>}
        {m.state === "stopped" && <span>stopped</span>}
        {m.activity && m.activity.length > 0 && m.state !== "streaming" && <span title={m.activity.join("\n")}>used the web</span>}
      </div>
      {m.state === "failed" && (
        <p className="error small">
          {m.error}{" "}
          {props.retry && (
            <button type="button" className="link" onClick={props.retry}>
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
