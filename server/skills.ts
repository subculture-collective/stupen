import { readFileSync } from "node:fs";
import { join } from "node:path";

/** What a prompt is for; each skill lists the purposes it applies to. */
export type Purpose = "coach" | "plan" | "build";

type Skill = { name: string; use: Purpose[]; runner?: string; note?: string; files: string[] };

/**
 * Skills shipped with the app, so every model it calls gets the same guidance.
 * Third-party texts keep their licence notices in each skill's notices/ folder.
 */
const SKILLS: Skill[] = [
  { name: "learning-coach", use: ["coach", "plan", "build"], files: ["SKILL.md"] },
  { name: "write-plainly", use: ["coach", "plan", "build"], files: ["SKILL.md", "references/base-workflow.md", "references/modes/plain-restate/guide.md"] },
  {
    name: "typescript-idioms",
    runner: "typescript",
    use: ["coach", "build"],
    note: "Apply only rules that fit a small exercise.",
    files: ["guide.md"],
  },
  {
    name: "go-idioms",
    runner: "go",
    use: ["coach", "build"],
    note: "Written for services: ignore context propagation, linters, profiling, coverage targets and project layout for small exercises.",
    files: ["SKILL.md"],
  },
  {
    name: "python-idioms",
    runner: "python",
    use: ["coach", "build"],
    note: "Ignore tooling, packaging and documentation-standard advice for small exercises.",
    files: ["python-anti-patterns.md", "python-code-style.md"],
  },
];

const DIR = join(import.meta.dirname, "..", "skills");
const strip = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
const cache = new Map<string, string>();
const read = (rel: string) => {
  if (!cache.has(rel)) cache.set(rel, strip(readFileSync(join(DIR, rel), "utf8")));
  return cache.get(rel)!;
};

/** The skills block appended to a system prompt for one purpose and runner. */
export function skillPrompt(purpose: Purpose, runner: string): string {
  const parts = SKILLS.filter((s) => s.use.includes(purpose) && (!s.runner || s.runner === runner)).map((s) => {
    const body = s.files.map((f, i) => (i === 0 ? read(join(s.name, f)) : `#### ${f}\n\n${read(join(s.name, f))}`)).join("\n\n");
    return `<skill name="${s.name}">\n${s.note ? `${s.note}\n\n` : ""}${body}\n</skill>`;
  });
  return `## Skills\n\nYou are running inside the Study Coach app. You cannot read or write files or run commands; the app sends what you need with each request. Where a skill mentions files or checks, the app or the learner handles them.\n\n${parts.join("\n\n")}`;
}

export const skillNames = () => SKILLS.map((s) => s.name);
