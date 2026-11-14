import { join } from "node:path";

import { userDir } from "./store.ts";
import { HttpError, readJson, slugify, writeJson } from "./util.ts";

/** When a prompt is offered to the coach without the learner typing it. */
export const TRIGGERS = {
  manual: "Only when I pick it",
  "lesson-start": "When I open a lesson for the first time",
  "check-fail": "When my checks fail",
  stuck: "When my checks fail three times in a row",
  "check-pass": "When my checks pass",
  grade: "When I submit a written answer",
} as const;
export type Trigger = keyof typeof TRIGGERS;

export type Prompt = {
  id: string;
  label: string;
  text: string;
  trigger: Trigger;
  /** "auto" sends the prompt as soon as its trigger fires; "suggest" highlights it above the message box. */
  mode: "auto" | "suggest";
  builtIn: boolean;
};

export const PLACEHOLDERS: Record<string, string> = {
  subject: "What the track teaches",
  level: "Your level for the track",
  lesson: "The lesson title",
  objective: "What the lesson teaches",
  file: "The file open in the editor",
  selection: "Text selected in the editor (empty when nothing is selected)",
  failing: "The first lines of the failing check output",
};

export const DEFAULT_PROMPTS: Prompt[] = [
  {
    id: "intro",
    label: "Explain the idea first",
    text: "Before I start: explain the main idea of this lesson ({{objective}}) in a few short paragraphs at my level, with one small example that is not the exercise. End with the one thing I should keep in mind while I work.",
    trigger: "lesson-start",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "hint",
    label: "Give me a hint",
    text: "Give me the smallest hint that gets me moving on this lesson. Don't solve it for me.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "explain-failure",
    label: "Explain the failure",
    text: "My checks failed:\n\n```\n{{failing}}\n```\n\nExplain what this output means and where I should look, without fixing the code for me.",
    trigger: "check-fail",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "stuck",
    label: "I'm stuck",
    text: "I've failed the checks several times in a row and I'm stuck. First ask me what I think is wrong, then give me one targeted hint.",
    trigger: "stuck",
    mode: "auto",
    builtIn: true,
  },
  {
    id: "review",
    label: "Review my solution",
    text: "My checks pass. Review my solution the way an experienced {{subject}} practitioner would, at my level ({{level}}): correctness and edge cases, readability, and idiomatic style. Name the single most valuable improvement, then ask me one question that checks I understand why my solution works.",
    trigger: "check-pass",
    mode: "auto",
    builtIn: true,
  },
  {
    id: "grade",
    label: "Grade my answer",
    text: "Please grade my answer in the answer file against the lesson brief. Say what is right, what is missing or wrong, and whether it passes.",
    trigger: "grade",
    mode: "auto",
    builtIn: true,
  },
  {
    id: "explain-selection",
    label: "Explain the selection",
    text: "Explain this part of {{file}} step by step:\n\n```\n{{selection}}\n```",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "simpler",
    label: "Explain it more simply",
    text: "That was too much for me. Explain the idea again more simply, with an everyday analogy and a smaller example.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "example",
    label: "Show another example",
    text: "Show me a different, small worked example of the idea in this lesson. It must not solve the exercise.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "quiz",
    label: "Quiz me",
    text: "Quiz me on this lesson: ask three short questions, one at a time, and wait for my answer before asking the next. Tell me after each answer whether I was right.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "deeper",
    label: "Go deeper",
    text: "What would an expert know about this topic that the lesson skipped? Cover edge cases, performance and trade-offs briefly, and say which matter at my level.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "real-world",
    label: "Where is this used?",
    text: "Where does this idea show up in real {{subject}} projects? Give two concrete situations and what goes wrong when people get it wrong.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
  {
    id: "next",
    label: "What should I practise next?",
    text: "Based on how this lesson went, what should I practise next, and why? Keep it to three suggestions.",
    trigger: "manual",
    mode: "suggest",
    builtIn: true,
  },
];

type Stored = { prompts: Prompt[]; removed: string[] };
const path = (user: string) => join(userDir(user), "prompts.json");

/** The learner's prompt library: their edits and additions, plus any built-in prompt they have not removed. */
export async function listPrompts(user: string): Promise<Prompt[]> {
  const s = await readJson<Stored>(path(user), { prompts: [], removed: [] });
  const have = new Set(s.prompts.map((p) => p.id));
  const missing = DEFAULT_PROMPTS.filter((p) => !have.has(p.id) && !s.removed.includes(p.id));
  return [...s.prompts, ...missing];
}

function clean(input: any, index: number): Prompt {
  const label = String(input?.label ?? "").trim().slice(0, 60);
  const text = String(input?.text ?? "").trim().slice(0, 4000);
  if (!label || !text) throw new HttpError(400, `prompt ${index + 1} needs a label and text`);
  const trigger = (Object.keys(TRIGGERS) as Trigger[]).includes(input.trigger) ? (input.trigger as Trigger) : "manual";
  const id = typeof input.id === "string" && /^[a-z0-9-]{1,48}$/.test(input.id) ? input.id : `${slugify(label, 30)}-${Date.now().toString(36)}`;
  const builtIn = DEFAULT_PROMPTS.some((p) => p.id === id);
  return { id, label, text, trigger, mode: input.mode === "auto" ? "auto" : "suggest", builtIn };
}

export async function savePrompts(user: string, input: unknown): Promise<Prompt[]> {
  if (!Array.isArray(input) || input.length > 100) throw new HttpError(400, "send a list of up to 100 prompts");
  const prompts = input.map(clean);
  const ids = new Set<string>();
  for (const p of prompts) {
    if (ids.has(p.id)) throw new HttpError(400, `duplicate prompt id ${p.id}`);
    ids.add(p.id);
  }
  const removed = DEFAULT_PROMPTS.filter((p) => !ids.has(p.id)).map((p) => p.id);
  await writeJson(path(user), { prompts, removed } satisfies Stored);
  return listPrompts(user);
}

export async function resetPrompts(user: string): Promise<Prompt[]> {
  await writeJson(path(user), { prompts: [], removed: [] } satisfies Stored);
  return listPrompts(user);
}
