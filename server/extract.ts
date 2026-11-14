import { extname } from "node:path";

import { htmlToText } from "./fetch.ts";
import { sandboxed } from "./exec.ts";
import { HttpError } from "./util.ts";

const TEXT_EXT = /^\.(md|markdown|txt|text|rst|adoc|org|csv|tsv|json|ya?ml|toml|ini|xml|tex|py|ts|tsx|js|mjs|cjs|jsx|go|rs|java|kt|c|h|cc|cpp|hpp|cs|rb|php|swift|sql|sh|bash|zsh|lua|r|scala|hs|ex|exs|clj|dart|vue|svelte|css|scss|ipynb)$/i;

/** Pulls the text out of a .docx, .odt or .epub (zip archives of XML) with the Python standard library. */
const ZIP_TEXT = `
import re, sys, zipfile, html
z = zipfile.ZipFile("in.bin")
names = [n for n in z.namelist() if re.search(r"(word/document|content|\\.x?html?)$|\\.xhtml$|\\.html?$", n) or n.endswith("content.xml")]
out = []
for n in sorted(names):
    t = z.read(n).decode("utf-8", "replace")
    t = re.sub(r"</(w:p|text:p|p|h[1-6]|li|div)>", "\\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    out.append(html.unescape(t))
sys.stdout.write(re.sub(r"\\n{3,}", "\\n\\n", "\\n".join(out)))
`;

/** Text from an uploaded file. Binary formats are parsed inside the sandbox. */
export async function extractText(name: string, data: Buffer): Promise<string> {
  const ext = extname(name).toLowerCase();
  if (ext === ".pdf" || data.subarray(0, 5).toString() === "%PDF-") {
    const r = await sandboxed({ "in.pdf": data }, ["pdftotext", "-layout", "-enc", "UTF-8", "in.pdf", "-"]);
    if (r.exitCode !== 0) throw new HttpError(422, `could not read the PDF: ${r.output.slice(-300)}`);
    return r.output;
  }
  if ([".docx", ".odt", ".epub"].includes(ext)) {
    const r = await sandboxed({ "in.bin": data, "x.py": ZIP_TEXT }, ["@python", "x.py"]);
    if (r.exitCode !== 0) throw new HttpError(422, `could not read ${ext}: ${r.output.slice(-300)}`);
    return r.output;
  }
  if (ext === ".html" || ext === ".htm") return htmlToText(data.toString("utf8")).text;
  if (ext === ".ipynb") {
    try {
      const nb = JSON.parse(data.toString("utf8"));
      return (nb.cells ?? [])
        .map((c: any) => {
          const src = Array.isArray(c.source) ? c.source.join("") : String(c.source ?? "");
          return c.cell_type === "code" ? `\`\`\`\n${src}\n\`\`\`` : src;
        })
        .join("\n\n");
    } catch {
      throw new HttpError(422, "could not read the notebook");
    }
  }
  if (TEXT_EXT.test(ext) || !data.subarray(0, 8000).includes(0)) {
    const text = data.toString("utf8");
    if (text.includes("���")) throw new HttpError(415, "that file does not look like text");
    return text;
  }
  throw new HttpError(415, `can't read ${ext || "this kind of"} files; use text, Markdown, code, PDF, DOCX, ODT, EPUB, HTML or a notebook`);
}
