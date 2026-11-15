import { dirname } from "node:path";
import type { Practice, PracticeSchema } from "../shared/practice.ts";

/** Canonical support filename; the runner regenerates it from validated schemas. */
export const GO_RESULT_BYTES = 65_536 * 6;
export const GO_TYPES = "stupen_practice_types.go";

/** Deterministic names also used by generated canonical starter/support code. */
export function goSchemaTypes(p: Practice): string {
  const declarations: string[] = [];
  let objects = false;
  const type = (s: PracticeSchema, name: string): string => {
    if (s.type === "object") {
      objects = true;
      const properties = Object.entries(s.properties);
      const fields = properties.map(([key, child], n) => ({ key, field: `Field${n}`, type: type(child, `${name}Field${n}`) }));
      declarations.push(`type ${name} struct {\n${fields.map(f => `${f.field} ${f.type} ${JSON.stringify(`json:${JSON.stringify(f.key)}`)}`).join("\n")}\n}`);
      // Explicit keys also handle JSON property names that encoding/json tags
      // cannot represent (commas, quotes, or empty names). No type inference.
      declarations.push(`func (v *${name}) UnmarshalJSON(data []byte) error {
        var fields map[string]json.RawMessage
        if err := json.Unmarshal(data, &fields); err != nil { return err }
        ${fields.map(f => `if err := json.Unmarshal(fields[${JSON.stringify(f.key)}], &v.${f.field}); err != nil { return err }`).join("\n")}
        return nil
      }
      func (v ${name}) MarshalJSON() ([]byte, error) {
        return json.Marshal(map[string]any{${fields.map(f => `${JSON.stringify(f.key)}:v.${f.field}`).join(",")}})
      }`);
      return name;
    }
    if (s.type === "array") return `[]${type(s.items, `${name}Item`)}`;
    return { integer: "int64", number: "float64", string: "string", boolean: "bool" }[s.type];
  };
  p.inputs.forEach((input, n) => { const name = `StupenPracticeInput${n}`; const t = type(input.schema, name); if (t !== name) declarations.push(`type ${name} = ${t}`); });
  const output = type(p.output, "StupenPracticeOutput");
  if (output !== "StupenPracticeOutput") declarations.push(`type StupenPracticeOutput = ${output}`);
  return `package lesson\n${objects ? 'import "encoding/json"\n' : ""}${declarations.join("\n")}\n`;
}

export function goHarness(p: Practice): Record<string, string> {
  const dir = dirname(p.entry.file);
  const path = (name: string) => dir === "." ? name : `${dir}/${name}`;
  return {
    [path(GO_TYPES)]: goSchemaTypes(p),
    [path("stupen_practice_harness.go")]: `package lesson
import ("encoding/json"; "fmt"; "os")
// StupenPracticeMain calls only the declared learner function.
func StupenPracticeMain() {
  data, err := os.ReadFile("__stupen_practice_input.json")
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  var input struct { Args []json.RawMessage }
  if err := json.Unmarshal(data, &input); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  ${p.inputs.map((_, n) => `var a${n} StupenPracticeInput${n}\nif err := json.Unmarshal(input.Args[${n}], &a${n}); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }`).join("\n")}
  var actual StupenPracticeOutput = ${p.entry.symbol}(${p.inputs.map((_, n) => `a${n}`).join(",")})
  output, err := json.Marshal(struct { Actual StupenPracticeOutput ${JSON.stringify('json:"actual"')} }{Actual:actual})
  if err != nil || len(output) > ${GO_RESULT_BYTES} {
    fmt.Fprintln(os.Stderr, "Return a JSON-compatible value within 64 KiB:", err)
    output = []byte("{\\"invalid\\":true}")
  }
  if err := os.WriteFile("__stupen_practice_result.json", output, 0600); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
`,
    "__stupen_practice_cmd/main.go": `package main\nimport target ${JSON.stringify(dir === "." ? "lesson" : `lesson/${dir}`)}\nfunc main() { target.StupenPracticeMain() }\n`,
  };
}
