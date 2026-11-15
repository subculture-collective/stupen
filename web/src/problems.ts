import type { Checks } from "./api.ts";
import type { CodeProblem, SourceFile } from "./languageService.ts";

export function position(content: string, line: number, column = 1): number {
  const lines = content.split("\n");
  const index = Math.min(lines.length - 1, Math.max(0, line - 1));
  return lines.slice(0, index).reduce((n, s) => n + s.length + 1, 0) + Math.min(lines[index]!.length, Math.max(0, column - 1));
}

export function location(content: string, offset: number) {
  const before = content.slice(0, offset).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

/** Resolve only visible lesson files, never a hidden reference or an arbitrary filesystem path. */
export function checkProblems(checks: Checks | undefined, files: SourceFile[]): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const result of checks?.results ?? []) {
    const output = result.output.replace(/\x1b\[[0-9;]*m/g, "");
    let lastMessage = "";
    let python: { path: string; line: number } | undefined;
    for (const line of output.split("\n")) {
      if (/^(?:(?:\w*Error|\w*Exception):|(?:error|warning)(?:\[.*?\])?:)/.test(line)) lastMessage = line;
      const py = /File "([^"]+)", line (\d+)/.exec(line);
      if (py) python = { path: py[1]!, line: Number(py[2]) };
      const match = /(?:^|\s|\()((?:file:\/\/)?[^\s()]+?)\((\d+),(\d+)\):\s*(.*)/.exec(line)
        ?? /(?:^|\s|\()((?:file:\/\/)?[^\s():]+):(\d+)(?::(\d+))?(?:\)?(?::\s*|\s+))?(.*)/.exec(line);
      let path = match?.[1];
      let row = Number(match?.[2]);
      const column = Number(match?.[3] ?? 1);
      let message = match?.[4]?.trim() || lastMessage;
      if (!match && python && /^\w*(?:Error|Exception):/.test(line)) {
        path = python.path;
        row = python.line;
        message = line;
      }
      if (!path || !row) continue;
      path = path.replace(/^file:\/\//, "").replace(/^\.\//, "");
      if (/(?:^|\/)\.(?:reference|meta)(?:\/|$)/.test(path)) continue;
      const file = files.find((f) => f.path === path) ?? files.find((f) => path!.endsWith(`/${f.path}`));
      if (!file) continue;
      if (!message || /^[-^~\s]+$/.test(message)) continue;
      const from = position(file.content, row, column);
      const rest = file.content.slice(from).match(/^\w+/)?.[0].length ?? 1;
      const problem: CodeProblem = { path: file.path, from, to: Math.min(file.content.length, from + rest), message, severity: /\bwarning\b/i.test(message) ? "warning" : "error", source: "Checks" };
      if (!problems.some((p) => p.path === problem.path && p.from === problem.from && p.message === problem.message)) problems.push(problem);
    }
    if (result.exitCode !== 0 && !problems.some((p) => output.includes(p.message))) problems.push({ path: "", from: 0, to: 0, message: result.timedOut ? `${result.command}: timed out` : `${result.command}: failed. See check output for details.`, severity: "error", source: "Checks" });
  }
  return problems;
}
