/** Refresh the bundled Go and Python hover docs from the local toolchains. No learner code is run. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const root = new URL("../web/src/", import.meta.url);
const python = execFileSync("python3", ["-c", `
import builtins, inspect, json
print(json.dumps({name: inspect.getdoc(value) for name, value in vars(builtins).items()
  if not name.startswith('_') and (inspect.isbuiltin(value) or (isinstance(value, type) and not issubclass(value, BaseException)))}))
`], { encoding: "utf8" });
writeFileSync(new URL("pythonDocs.json", root), JSON.stringify(JSON.parse(python), null, 2) + "\n");

type Entry = { signature: string; documentation: string; type: string };
const packages = ["builtin", "fmt", "strings", "strconv", "sort", "slices", "maps", "math", "math/rand", "errors", "bytes", "io", "bufio", "os", "path/filepath", "encoding/json", "regexp", "unicode", "unicode/utf8", "time", "context", "sync", "net/http", "testing"];
const docs: Record<string, Record<string, Entry>> = {};
for (const path of packages) {
  const text = execFileSync("go", ["doc", "-all", path], { encoding: "utf8", maxBuffer: 4_000_000 });
  const declarations = [...text.matchAll(/^(func|type|const|var) (?:\(([^\n)]+)\) )?(\w+)[^\n]*/gm)];
  docs[path] = {};
  for (let i = 0; i < declarations.length; i++) {
    const match = declarations[i]!;
    const receiver = match[2]?.split(/\s+/).at(-1)?.replace(/^\*/, "").replace(/\[.*\]/, "");
    const name = receiver ? `${receiver}.${match[3]}` : match[3]!;
    const body = text.slice(match.index! + match[0].length, declarations[i + 1]?.index ?? text.length);
    // go doc indents documentation by four spaces; type bodies use tabs.
    const documentation = body.split("\n").filter((line) => /^ {4}/.test(line) || !line.trim()).map((line) => line.replace(/^ {4}/, "")).join("\n").trim();
    docs[path]![name] = { signature: match[0], documentation, type: match[1] === "func" ? "function" : match[1] === "type" ? "type" : "constant" };
  }
  for (const group of text.matchAll(/^(const|var) \(\n([\s\S]*?)^\)/gm)) {
    for (const item of group[2]!.matchAll(/^\t([A-Z]\w*)[^\n]*/gm)) {
      docs[path]![item[1]!] = { signature: `${group[1]} ${item[0].trim()}`, documentation: "", type: group[1] === "const" ? "constant" : "variable" };
    }
  }
}
writeFileSync(new URL("goDocs.json", root), JSON.stringify(docs) + "\n");
console.log(`Updated Python builtin docs and ${packages.length} Go packages.`);
