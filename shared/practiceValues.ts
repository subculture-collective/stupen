import type { PracticeSchema } from "./practice.ts";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function fields(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  require(object(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k)), "unexpected or missing fields");
}

/** Keep duplicate keys from silently changing the JSON input. */
export function parsePracticeJson(text: string, maxBytes = 65_536): unknown {
  require(new TextEncoder().encode(text).length <= maxBytes, `JSON exceeds ${maxBytes / 1024} KiB`);
  const value: unknown = JSON.parse(text);
  const keys: Set<string>[] = [];
  for (const m of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}]/g)) {
    if (m[0] === "{") keys.push(new Set());
    else if (m[0] === "}") keys.pop();
    else if (/^\s*:/.test(text.slice(m.index + m[0].length))) {
      const name = JSON.parse(m[0]) as string;
      require(!keys.at(-1)?.has(name), "duplicate JSON key");
      keys.at(-1)?.add(name);
    }
  }
  return value;
}

export function validatePracticeValue(v: unknown, s: PracticeSchema, depth = 1): void {
  require(depth <= 8, "value nesting exceeds 8");
  switch (s.type) {
    case "boolean": require(typeof v === "boolean", "expected boolean"); break;
    case "string": require(typeof v === "string" && new TextEncoder().encode(v).length <= 8192, "expected string of at most 8192 bytes"); break;
    case "integer": require(typeof v === "number" && Number.isSafeInteger(v), "expected safe integer"); break;
    case "number": require(typeof v === "number" && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)), "expected finite safe number"); break;
    case "array":
      require(Array.isArray(v) && v.length <= 1000, "expected array of at most 1000 elements");
      for (const item of v) validatePracticeValue(item, s.items, depth + 1);
      break;
    case "object":
      fields(v, Object.keys(s.properties));
      for (const [name, child] of Object.entries(s.properties)) validatePracticeValue(v[name], child, depth + 1);
      break;
  }
}
