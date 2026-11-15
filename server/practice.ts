import { parsePracticeJson as parse, validatePracticeValue as value } from "../shared/practiceValues.ts";
import type { Practice, PracticeSchema } from "../shared/practice.ts";
import { runner } from "./runners.ts";
import { GO_TYPES, goSchemaTypes } from "./practice-go.ts";
import { safeRel } from "./util.ts";

const extensions: Record<string, RegExp> = { typescript: /\.(ts|mts)$/, javascript: /\.(js|mjs)$/, python: /\.py$/, go: /\.go$/ };
const jsKeywords = "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield async await";
const keywords: Record<string, Set<string>> = {
  javascript: new Set(jsKeywords.split(" ")),
  typescript: new Set(`${jsKeywords} abstract as asserts declare infer is keyof module namespace readonly require type unique unknown`.split(" ")),
  python: new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ")),
  go: new Set("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(" ")),
};
const identifier = (v: unknown, runtime: string): v is string => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v) && !keywords[runtime]?.has(v) && !["__proto__", "constructor", "prototype"].includes(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function fields(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  require(object(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), "unexpected or missing fields");
}

function schema(v: unknown, depth = 1): asserts v is PracticeSchema {
  require(depth <= 8 && object(v), "schema nesting exceeds 8 or is not an object");
  switch (v.type) {
    case "boolean": case "string": case "integer": case "number": fields(v, ["type"]); break;
    case "array": fields(v, ["type", "items"]); schema(v.items, depth + 1); break;
    case "object": {
      fields(v, ["type", "properties", "required"]);
      require(object(v.properties) && Object.keys(v.properties).length <= 64, "invalid object properties");
      const names = Object.keys(v.properties);
      require(Array.isArray(v.required) && v.required.length === names.length && new Set(v.required).size === names.length && v.required.every((k) => typeof k === "string" && names.includes(k)), "every object property must be required");
      for (const child of Object.values(v.properties)) schema(child, depth + 1);
      break;
    }
    default: throw new Error("unsupported schema type");
  }
}

type File = { path: string; role: string };

/** Validate at generation and storage boundaries; never interpret source or execute it. */
export function validatePractice(input: unknown, runtime: string, files: File[]): Practice {
  const ext = extensions[runtime];
  require(ext, "runtime does not support the practice contract");
  const p = typeof input === "string" ? parse(input) : input;
  fields(p, ["version", "entry", "inputs", "output", "cases"]);
  require(bytes(p) <= 65_536 && p.version === 1, "unsupported version or oversized metadata");
  fields(p.entry, ["file", "symbol"]);
  const entryFile = p.entry.file;
  require(typeof entryFile === "string" && safeRel(entryFile) && ext.test(entryFile) && runner(runtime).editable(entryFile) && files.some((f) => f.path === entryFile && f.role === "starter"), "entry must name an editable starter file of this runtime");
  require(identifier(p.entry.symbol, runtime), "entry symbol must be a non-keyword identifier");
  require(Array.isArray(p.inputs) && p.inputs.length <= 16, "at most 16 inputs are allowed");
  const names = new Set<string>();
  const inputs: Practice["inputs"] = [];
  for (const i of p.inputs) {
    fields(i, ["name", "schema"]);
    require(identifier(i.name, runtime) && !names.has(i.name), "invalid or duplicate input name");
    names.add(i.name);
    schema(i.schema);
    inputs.push({ name: i.name, schema: i.schema });
  }
  schema(p.output);
  require(Array.isArray(p.cases) && p.cases.length >= 1 && p.cases.length <= 10, "generate 1–10 visible cases");
  const ids = new Set<string>();
  for (const c of p.cases) {
    fields(c, ["id", "name", "inputs"], ["expected"]);
    require(typeof c.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(c.id) && !c.id.startsWith("custom-") && !ids.has(c.id), "invalid or duplicate sample ID");
    ids.add(c.id);
    require(typeof c.name === "string" && c.name.trim() && c.name.length <= 80 && bytes(c) <= 32_768, "invalid or oversized case");
    fields(c.inputs, [...names]);
    for (const i of inputs) value(c.inputs[i.name], i.schema);
    if (Object.hasOwn(c, "expected")) value(c.expected, p.output);
  }
  // Every field and recursive schema/value has now been checked; no private extras survive.
  return p as Practice;
}

export function practicePrompt(runtime: string): string {
  if (!extensions[runtime]) return 'Return an empty string in "practice": this format keeps its existing checks/grading and has no callable-case contract.';
  const file = { typescript: "solution.ts", javascript: "solution.mjs", python: "solution.py", go: "solution.go" }[runtime];
  const symbol = runtime === "python" ? "two_sum" : runtime === "go" ? "TwoSum" : "twoSum";
  const example: Practice = {
    version: 1, entry: { file: file!, symbol },
    inputs: [{ name: "nums", schema: { type: "array", items: { type: "integer" } } }, { name: "target", schema: { type: "integer" } }],
    output: { type: "array", items: { type: "integer" } },
    cases: [{ id: "sample-1", name: "Distinct values", inputs: { nums: [2, 7], target: 9 }, expected: [0, 1] }],
  };
  const goNote = runtime === "go" ? ` For Go objects use deterministic types StupenPracticeInput0, StupenPracticeInput1, etc., and StupenPracticeOutput; object fields are Field0, Field1, etc. in schema property order, nested names append FieldN or Item. Include a read-only support file ${GO_TYPES} declaring these JSON-tagged types. The adapter regenerates this support from schemas, so declarations must match. Example support: ${goSchemaTypes(example)}` : "";
  return `For a compatible function exercise, return a JSON-encoded v1 metadata object as the "practice" string (otherwise an empty string). Example shape, adapted to the actual task: ${JSON.stringify(example)}${goNote}
Entry must name an editable starter file of this runtime and a named top-level synchronous function. Inputs are unique non-keyword ASCII identifiers (64 characters maximum), in positional argument order; no methods, classes, async/generators or stdin programs. Match its declared types to the schemas. State the signature, sample cases and order-sensitive array comparison in the brief. TS/JS exports the function; Python defines it at module scope; Go uses package lesson, int64 for integers, float64 for numbers, slices for arrays and named JSON-tagged structs for objects. Do not change the canonical test layout.
Schemas are closed objects: {type:"boolean"|"string"|"integer"|"number"}, {type:"array",items:schema}, or {type:"object",properties:{name:schema},required:[every property name]}. No nulls, optional properties, unions, references or recursive schemas. Maximum nesting 8, 16 inputs, 64 object properties, 1000 array items, 8192 UTF-8 bytes per string. Only finite binary64 numbers and safe integers within ±9007199254740991.
Include 1–10 visible cases with unique letter/digit/hyphen IDs (64 characters, no custom- prefix), names of 1–80 characters, exact named inputs and optional expected output matching the output schema. Prefer expected outputs for worked examples; absence means observation only, never a pass. False, zero, empty strings/arrays/objects are real expected values. Maximum 32 KiB per case, 64 KiB metadata. No duplicate keys or extra fields. Only public worked examples: never include reference source or private metadata. Omit practice if the lesson cannot meet this contract; autocomplete and canonical checking still work.`;
}

/** Invalid/unsupported metadata cannot break an otherwise usable canonical lesson. */
export function publishedPractice(input: unknown, runtime: string, files: File[], verified: boolean, warn: (message: string) => void = () => {}): Practice | undefined {
  if (input === undefined || input === "") return;
  try {
    require(verified, "canonical reference/starter verification did not pass");
    return validatePractice(input, runtime, files);
  } catch (e) {
    warn(`Practice metadata omitted: ${(e as Error).message}. Canonical checks are unchanged.`);
    return;
  }
}
