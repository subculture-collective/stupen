import ts from "typescript-language-service";
import type { CodeCompletion, CodeHover, CodeProblem, SourceFile } from "./languageService.ts";

/** In-memory language service shared by the worker and its conformance tests. */
export function typescriptService(libs: Record<string, string>) {
  let files = new Map<string, string>();
  let version = 0;
  const normalize = (path: string) => path.replace(/^\/?(?:work\/)?/, "/work/");
  const read = (path: string) => files.get(path) ?? libs[path];
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, allowJs: true, checkJs: true, allowImportingTsExtensions: true, noEmit: true,
      noUncheckedIndexedAccess: true, erasableSyntaxOnly: true,
      jsx: ts.JsxEmit.Preserve, skipLibCheck: true,
      types: Object.keys(libs).some((path) => path.startsWith("/node_modules/@types/node/")) ? ["node"] : [],
      typeRoots: ["/node_modules/@types"],
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => String(version),
    getScriptSnapshot: (path) => { const text = read(path); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => "/work",
    getDefaultLibFileName: () => "/lib/lib.es2023.full.d.ts",
    fileExists: (path) => read(path) !== undefined,
    readFile: read,
    readDirectory: () => [],
  });
  return {
    sync(sources: SourceFile[]): CodeProblem[] {
      files = new Map(sources.map((f) => [normalize(f.path), f.content]));
      version++;
      return [...files.keys()].flatMap((file) => [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)]
        // Installed dependency types live in the runner, rather than this browser worker.
        .filter((d) => ![2307, 2688, 2792].includes(d.code))
        .map((d) => ({
          path: file.slice("/work/".length), from: d.start ?? 0, to: (d.start ?? 0) + (d.length ?? 0),
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          severity: d.category === ts.DiagnosticCategory.Warning ? "warning" as const : "error" as const,
          source: `TypeScript ${d.code}`,
        })));
    },
    complete(path: string, pos: number): CodeCompletion[] {
      const file = normalize(path);
      const result = service.getCompletionsAtPosition(file, pos, {});
      return (result?.entries ?? []).map((entry) => {
        const details = service.getCompletionEntryDetails(file, pos, entry.name, {}, entry.source, {}, entry.data);
        return {
          label: entry.name, type: /function|method/.test(entry.kind) ? "function" : /class|interface|type/.test(entry.kind) ? "type" : entry.kind === "keyword" ? "keyword" : "variable",
          detail: ts.displayPartsToString(details?.displayParts), info: ts.displayPartsToString(details?.documentation),
          ...(entry.replacementSpan ? { from: entry.replacementSpan.start, to: entry.replacementSpan.start + entry.replacementSpan.length } : {}),
          ...(entry.insertText ? { insert: entry.insertText } : {}),
        };
      });
    },
    hover(path: string, pos: number): CodeHover | null {
      const info = service.getQuickInfoAtPosition(normalize(path), pos);
      return info ? {
        from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length,
        signature: ts.displayPartsToString(info.displayParts), documentation: ts.displayPartsToString(info.documentation),
      } : null;
    },
  };
}
