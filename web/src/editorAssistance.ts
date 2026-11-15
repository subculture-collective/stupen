import { completeAnyWord, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import { hoverTooltip, type EditorView } from "@codemirror/view";
import pythonDocs from "./pythonDocs.json" with { type: "json" };
import { typedFile, type LanguageService, type SourceFile } from "./languageService.ts";

export const documentedCompletion: CompletionSource = async (context) => {
  const word = context.matchBefore(/[\w$]*/);
  if (!word || (!word.text && !context.explicit && context.state.sliceDoc(context.pos - 1, context.pos) !== ".")) return null;
  if (/Comment|String/.test(syntaxTree(context.state).resolveInner(context.pos, -1).name)) return null;
  const code = context.state.doc.toString();
  const qualifier = /([\w]+)\.$/.exec(code.slice(0, word.from))?.[1];
  const { goCompletions } = await import("./goAssistance.ts");
  return { from: word.from, options: await goCompletions(code, qualifier), validFor: /^\w*$/ };
};

export const pythonCompletion: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (!word.text && !context.explicit)) return null;
  if (/Comment|String/.test(syntaxTree(context.state).resolveInner(context.pos, -1).name)) return null;
  return { from: word.from, options: Object.entries(pythonDocs).map(([label, info]) => ({ label, type: "function", info, detail: info.split("\n")[0] ?? "", boost: 1 })), validFor: /^\w*$/ };
};

export function syntaxDiagnostics(view: EditorView): Diagnostic[] {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50) ?? syntaxTree(view.state);
  const result: Diagnostic[] = [];
  tree.iterate({ enter(node) {
    if (node.type.isError) result.push({ from: node.from, to: node.to, severity: "error", source: "Syntax", message: "Unexpected or incomplete syntax." });
  } });
  return result;
}

export const wordCompletion: CompletionSource = (context: CompletionContext) => {
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (/Comment|String/.test(node.name)) return null;
  return completeAnyWord(context);
};

/** Show docstrings and documented declarations from the lesson, plus Python's builtins. */
export function localDocumentation(word: string, path: string, files: SourceFile[]): { signature: string; documentation: string } | null {
  for (const file of files.filter((f) => f.path === path)) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const name = /(?:^|\s)(?:async\s+)?(?:def|class|function|func|fn|const|let|var|interface|type)\s+(\w+)/.exec(line)?.[1];
      if (name !== word) continue;
      let documentation = "";
      const after = lines.slice(i + 1).join("\n").trimStart();
      const docstring = /^(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(after);
      if (path.endsWith(".py") && docstring) documentation = docstring[1]!.trim();
      else {
        const comments: string[] = [];
        for (let j = i - 1; j >= 0 && /^\s*(?:\/\/|#|\/\*|\*|\*\/)/.test(lines[j]!); j--) comments.unshift(lines[j]!.replace(/^\s*(?:\/\/|#|\/\*\*?|\*\/|\*)\s?/, "").replace(/\*\/$/, ""));
        documentation = comments.join("\n").trim();
      }
      return { signature: line.trim(), documentation };
    }
  }
  if (path.endsWith(".py") && Object.hasOwn(pythonDocs, word)) return { signature: word, documentation: (pythonDocs as Record<string, string>)[word]! };
  return null;
}

export function documentationHover(path: string, files: () => SourceFile[], service: LanguageService, ready: () => Promise<unknown>) {
  return hoverTooltip(async (view, pos, side) => {
    const word = view.state.wordAt(pos);
    if (!word || (pos === word.from && side < 0) || (pos === word.to && side > 0)) return null;
    const state = view.state;
    let info;
    try {
      if (typedFile(path)) { await ready(); info = await service.hover(path, pos); }
      else {
        const name = state.sliceDoc(word.from, word.to);
        const qualifier = /([\w]+)\.$/.exec(state.sliceDoc(0, word.from))?.[1];
        let doc = localDocumentation(name, path, files());
        if (path.endsWith(".go")) {
          const { goDocumentation } = await import("./goAssistance.ts");
          doc = await goDocumentation(name, qualifier, state.doc.toString()) ?? doc;
        }
        info = doc ? { from: word.from, to: word.to, ...doc } : null;
      }
    } catch { return null; }
    if (!info || view.state.doc !== state.doc) return null;
    return { pos: info.from, end: info.to, above: true, create() {
      const dom = document.createElement("div");
      dom.className = "code-documentation";
      const signature = dom.appendChild(document.createElement("pre"));
      signature.textContent = info.signature;
      if (info.documentation) { const detail = dom.appendChild(document.createElement("div")); detail.textContent = info.documentation; }
      return { dom };
    } };
  }, { hoverTime: 350 });
}
