import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, selectNextOccurrence } from "@codemirror/search";
import { linter, setDiagnostics } from "@codemirror/lint";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { csharp, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { crosshairCursor, Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, rectangularSelection, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { documentedCompletion, documentationHover, pythonCompletion, syntaxDiagnostics, wordCompletion } from "./editorAssistance.ts";
import { typedFile, type CodeProblem, type LanguageService, type SourceFile } from "./languageService.ts";

export function language(path: string) {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (ext === "json") return json();
  if (ext === "go") return go();
  if (ext === "py") return python();
  if (ext === "rs") return rust();
  if (ext === "java") return java();
  if (["c", "h", "cpp", "cc", "hpp", "cxx"].includes(ext)) return cpp();
  if (ext === "sql") return sql();
  if (["md", "markdown", "txt"].includes(ext)) return markdown();
  if (["xml", "csproj", "sln", "svg"].includes(ext) || path.endsWith("pom.xml")) return html();
  if (["sh", "bash", "zsh"].includes(ext)) return StreamLanguage.define(shell);
  if (ext === "toml") return StreamLanguage.define(toml);
  if (ext === "rb" || ext === "rake" || path.endsWith("Gemfile")) return StreamLanguage.define(ruby);
  if (["html", "htm", "vue", "svelte"].includes(ext)) return html();
  if (["css", "scss"].includes(ext)) return css();
  if (ext === "php") return php();
  if (ext === "cs") return StreamLanguage.define(csharp);
  if (ext === "kt" || ext === "kts") return StreamLanguage.define(kotlin);
  if (["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json"].includes(ext)) return javascript({ typescript: /^[mc]?tsx?$/.test(ext), jsx: ext.endsWith("x") });
  return [];
}

/** Token colours come from CSS variables, so the editor follows the light and dark themes. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--tok-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--tok-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--tok-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--tok-comment)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--tok-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: "var(--tok-function)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--tok-definition)" },
  { tag: [t.propertyName], color: "var(--tok-property)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--tok-punct)" },
  { tag: t.invalid, color: "var(--bad)" },
]);

/** Editor state per area and file for this page session: undo history, selection and scroll survive switching files. */
const cache = new Map<string, { state: EditorState; scroll: number }>();
const assistance = new Compartment();

export type Caret = { line: number; column: number; cursors: number };
type Handlers = { onChange: (v: string) => void; onSave: () => void; onRun: () => void; onPractice?: (() => void) | undefined; onSelect?: ((text: string) => void) | undefined; onCaret?: ((caret: Caret) => void) | undefined };

/**
 * The live callbacks for each area and file. A cached state looks its callbacks
 * up here by key, so a restored state always calls the current workbench,
 * never the component that first created it.
 */
const handlerFor = new Map<string, Handlers>();
const call = (key: string, name: "onChange" | "onSave" | "onRun" | "onPractice", arg?: string) => {
  const h = handlerFor.get(key);
  if (name === "onChange") h?.onChange(arg ?? "");
  else h?.[name]?.();
};

function reportSelection(key: string, state: EditorState) {
  const h = handlerFor.get(key);
  const r = state.selection.main;
  const line = state.doc.lineAt(r.head);
  h?.onSelect?.(r.empty ? "" : state.sliceDoc(r.from, r.to).slice(0, 8000));
  h?.onCaret?.({ line: line.number, column: r.head - line.from + 1, cursors: state.selection.ranges.length });
}

/** File syntax, independent of the track's check runner. Unknown files stay plain text. */
export function fileLanguage(path: string): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    ts: "TypeScript", mts: "TypeScript", cts: "TypeScript", tsx: "TypeScript JSX",
    js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript JSX",
    py: "Python", go: "Go", rs: "Rust", java: "Java", c: "C", h: "C/C++", cpp: "C++", cc: "C++", hpp: "C++", cxx: "C++",
    json: "JSON", sql: "SQL", md: "Markdown", markdown: "Markdown", txt: "Plain text",
    html: "HTML", htm: "HTML", vue: "Vue", svelte: "Svelte", xml: "XML", svg: "SVG", csproj: "XML",
    css: "CSS", scss: "SCSS", sh: "Shell", bash: "Bash", zsh: "Zsh", toml: "TOML", rb: "Ruby", rake: "Ruby", php: "PHP", cs: "C#", kt: "Kotlin", kts: "Kotlin",
  };
  return path.split("/").at(-1) === "Gemfile" ? "Ruby" : names[ext] ?? "Plain text";
}

/** Tells each visible line how far it is indented, so its wrapped continuation lines sit under its own code. */
function indentDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const tab = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      let cols = 0;
      for (const ch of line.text) {
        if (ch === " ") cols++;
        else if (ch === "\t") cols += tab - (cols % tab);
        else break;
      }
      if (cols) b.add(line.from, line.from, Decoration.line({ attributes: { style: `--indent: ${cols}ch` } }));
      pos = line.to + 1;
    }
  }
  return b.finish();
}
const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = indentDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = indentDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

function createState(key: string, doc: string, path: string, readOnly: boolean, label: string) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches({ highlightWordAroundCursor: true, wholeWords: true }),
      assistance.of([]),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(highlight),
      language(path),
      // Long lines wrap; each continuation sits 2ch inside the line's own indentation.
      EditorView.lineWrapping,
      hangingIndent,
      EditorState.readOnly.of(readOnly),
      // Read-only files stay focusable so the keyboard can scroll them and a caret marks a jumped-to line.
      EditorView.contentAttributes.of({
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-label": label,
        "aria-describedby": "editor-help",
      }),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (call(key, "onSave"), true) },
        { key: "Mod-Shift-Enter", preventDefault: true, run: () => (call(key, "onPractice"), true) },
        { key: "Mod-Enter", preventDefault: true, run: () => (call(key, "onRun"), true) },
        { key: "Mod-d", preventDefault: true, run: selectNextOccurrence },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) call(key, "onChange", u.state.doc.toString());
        if (u.selectionSet || u.docChanged) reportSelection(key, u.state);
      }),
    ],
  });
}

/**
 * The lesson editor. Assistance reads the learner's files, never the hidden solution.
 */
export function Editor(props: {
  cacheKey: string;
  path: string;
  value: string;
  readOnly: boolean;
  label: string;
  /** Move the cursor to this 1-based line when it changes. */
  gotoLine?: { line: number; column?: number; at: number } | undefined;
  files: SourceFile[];
  service: LanguageService;
  ready: (path?: string, content?: string) => Promise<unknown>;
  problems: CodeProblem[];
  onDiagnostics: (path: string, problems: CodeProblem[]) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onRun: () => void; onPractice?: (() => void) | undefined;
  /** Called with the selected text whenever the selection changes. */
  onSelect?: (text: string) => void;
  onCaret?: (caret: Caret) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const shown = useRef<string | null>(null);
  const jumped = useRef(false);
  const current = useRef(props);
  current.current = props;
  handlerFor.set(props.cacheKey, { onChange: props.onChange, onSave: props.onSave, onRun: props.onRun, onPractice: props.onPractice, onSelect: props.onSelect, onCaret: props.onCaret });

  // One view for the component's lifetime; its state is swapped per file.
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({ parent: host.current });
    view.current = v;
    return () => {
      if (shown.current) cache.set(shown.current, { state: v.state, scroll: v.scrollDOM.scrollTop });
      shown.current = null;
      v.destroy();
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (shown.current) cache.set(shown.current, { state: v.state, scroll: v.scrollDOM.scrollTop });
    const saved = cache.get(props.cacheKey);
    v.setState(saved?.state ?? createState(props.cacheKey, props.value, props.path, props.readOnly, props.label));
    reportSelection(props.cacheKey, v.state);
    shown.current = props.cacheKey;
    jumped.current = false;
    // Restore the file's scroll position, unless a jump to a failing line has just moved it.
    if (saved)
      requestAnimationFrame(() => {
        if (!jumped.current) v.scrollDOM.scrollTop = saved.scroll;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cacheKey]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const path = props.path;
    v.dispatch({ effects: assistance.reconfigure([
      ...(!props.readOnly ? [closeBrackets(), keymap.of([...closeBracketsKeymap, ...completionKeymap]), autocompletion({
        // Keep language completions, and add names already used in this file.
        ...(typedFile(path) ? { override: [async (context) => {
          context.addEventListener("abort", () => {}, { onDocChange: true });
          const word = context.matchBefore(/[\w$]*/);
          if (!context.explicit && !word?.text && context.state.sliceDoc(context.pos - 1, context.pos) !== ".") return null;
          const doc = context.state.doc;
          try {
            await current.current.ready(path, doc.toString());
            const options = await current.current.service.complete(path, context.pos);
            if (context.aborted) return null;
            const from = options[0]?.from ?? word?.from ?? context.pos;
            return { from, to: options[0]?.to ?? context.pos, options: options.map((o) => ({ ...o, apply: o.insert ?? o.label })), validFor: /^[\w$]*$/ };
          } catch { return wordCompletion(context); }
        }] } : {}),
      })] : []),
      documentationHover(path, () => current.current.files, props.service, () => current.current.ready()),
      linter((view) => {
        const local = typedFile(path) ? [] : path.endsWith(".json") ? jsonParseLinter()(view) : syntaxDiagnostics(view);
        current.current.onDiagnostics(path, local.map((p) => ({ path, from: p.from, to: p.to, severity: p.severity === "warning" ? "warning" : "error", message: p.message, source: p.source ?? "Syntax" })));
        return [...local, ...current.current.problems];
      }, { delay: 500 }),
      ...(!typedFile(path) ? [EditorState.languageData.of(() => [{ autocomplete: wordCompletion }, ...(path.endsWith(".go") ? [{ autocomplete: documentedCompletion }] : path.endsWith(".py") ? [{ autocomplete: pythonCompletion }] : [])])] : []),
    ]) });
  }, [props.cacheKey, props.service]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const local = typedFile(props.path) ? [] : props.path.endsWith(".json") ? jsonParseLinter()(v) : syntaxDiagnostics(v);
    const problems = props.problems.map((p) => ({ ...p, from: Math.min(p.from, v.state.doc.length), to: Math.min(p.to, v.state.doc.length) }));
    v.dispatch(setDiagnostics(v.state, [...local, ...problems]));
  }, [props.problems, props.cacheKey]);

  // Follow changes made outside the editor: a fresh load from disk or a discarded draft.
  useEffect(() => {
    const v = view.current;
    if (v && shown.current === props.cacheKey && v.state.doc.toString() !== props.value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
    }
  }, [props.value, props.cacheKey]);

  useEffect(() => {
    const v = view.current;
    const g = props.gotoLine;
    if (!v || !g || shown.current !== props.cacheKey) return;
    jumped.current = true;
    const line = v.state.doc.line(Math.min(Math.max(1, g.line), v.state.doc.lines));
    const pos = Math.min(line.to, line.from + Math.max(0, (g.column ?? 1) - 1));
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  }, [props.gotoLine, props.cacheKey]);

  return <div className={`editor ${props.readOnly ? "readonly" : ""}`} ref={host} />;
}
