import type { Practice, PracticeCase } from "./practice.ts";
import { parsePracticeJson, validatePracticeValue } from "./practiceValues.ts";

/** Draft text is data, including unfinished JSON. It is never an execution request. */
export type CaseDraft = { id: string; name: string; inputs: Record<string, string>; expected?: string };
export type CaseDrafts = { version: 1; selected: string; cases: CaseDraft[] };
export const CASE_LIMIT = 20;
export const CASE_BYTES = 32_768;
// Encoding JSON as draft text escapes it again; every valid 32 KiB sample must fit.
export const DRAFT_CASE_BYTES = 65_536;
export const DRAFT_BYTES = 262_144;
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function sampleDraft(c: PracticeCase): CaseDraft {
  return { id: c.id, name: c.name, inputs: Object.fromEntries(Object.entries(c.inputs).map(([k, v]) => [k, JSON.stringify(v)])), ...(Object.hasOwn(c, "expected") ? { expected: JSON.stringify(c.expected) } : {}) };
}

export function initialCaseDrafts(practice: Practice): CaseDrafts {
  return { version: 1, selected: practice.cases[0]!.id, cases: practice.cases.map(sampleDraft) };
}

function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function fields(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  require(v !== null && typeof v === "object" && !Array.isArray(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), "Unexpected or missing draft fields.");
}

/** Strict storage envelope. Invalid input JSON can be saved, but cannot become runnable cases. */
export function validateCaseDrafts(input: unknown, practice: Practice): CaseDrafts {
  fields(input, ["version", "selected", "cases"]);
  require(input.version === 1 && jsonBytes(input) <= DRAFT_BYTES, "Drafts must be version 1 and at most 256 KiB.");
  require(Array.isArray(input.cases) && input.cases.length >= practice.cases.length && input.cases.length <= CASE_LIMIT, "Keep all samples and at most 20 total cases.");
  const ids = new Set<string>();
  for (const c of input.cases) {
    fields(c, ["id", "name", "inputs"], ["expected"]);
    require(typeof c.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(c.id) && !ids.has(c.id), "Invalid or duplicate case ID.");
    ids.add(c.id);
    const sample = practice.cases.find((s) => s.id === c.id);
    require(sample || /^custom-[A-Za-z0-9-]+$/.test(c.id), "Unknown sample ID.");
    require(typeof c.name === "string" && c.name.trim() && c.name.length <= 80 && (!sample || sample.name === c.name), "Case names must be 1–80 characters; sample names are fixed.");
    fields(c.inputs, practice.inputs.map((i) => i.name));
    require(Object.values(c.inputs).every((v) => typeof v === "string") && (!Object.hasOwn(c, "expected") || typeof c.expected === "string"), "Input drafts must be text.");
    require(jsonBytes(c) <= DRAFT_CASE_BYTES, "Each case draft must be at most 64 KiB of raw text (32 KiB parsed).");
  }
  require(practice.cases.every((s) => ids.has(s.id)), "Generated samples cannot be removed.");
  require(typeof input.selected === "string" && ids.has(input.selected), "Select an existing case.");
  return input as CaseDrafts;
}

/** All-or-nothing parsing: callers get no executable cases when any field is invalid. */
export function parseCaseDrafts(draft: CaseDrafts, practice: Practice): { cases?: PracticeCase[]; errors: Record<string, Record<string, string>>; error?: string } {
  const errors: Record<string, Record<string, string>> = Object.create(null);
  try { validateCaseDrafts(draft, practice); }
  catch (e) { return { errors, error: (e as Error).message }; }
  const cases: PracticeCase[] = [];
  for (const c of draft.cases) {
    const issues: Record<string, string> = {};
    const read = (key: string, text: string, schema: Practice["output"]) => {
      try {
        const v = parsePracticeJson(text, CASE_BYTES);
        validatePracticeValue(v, schema);
        return v;
      } catch (e) { issues[key] = (e as Error).message; return undefined; }
    };
    const inputs = Object.fromEntries(practice.inputs.map((i) => [i.name, read(`inputs.${i.name}`, c.inputs[i.name]!, i.schema)]));
    const expected = c.expected === undefined ? {} : { expected: read("expected", c.expected, practice.output) };
    if (Object.keys(issues).length) errors[c.id] = issues;
    else {
      const parsed = { id: c.id, name: c.name, inputs, ...expected } as PracticeCase;
      if (jsonBytes(parsed) > CASE_BYTES) return { errors, error: "Each parsed case must be at most 32 KiB." };
      cases.push(parsed);
    }
  }
  return Object.keys(errors).length ? { errors } : { cases, errors };
}
