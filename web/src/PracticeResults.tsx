import { useEffect, useState } from "react";
import type { PracticeCase } from "../../shared/practice.ts";
import type { PracticeResult, PracticeRun } from "../../shared/practiceRun.ts";
import type { CodeProblem, SourceFile } from "./languageService.ts";
import { checkProblems, location } from "./problems.ts";
import { tabKeys } from "./ui.tsx";

export type PracticeOutcome = { result: PracticeRun; code: string; input: string; cases: PracticeCase[]; selected: string };
const labels: Record<PracticeResult["status"], string> = {
  passed: "Matches expected output — practice only",
  failed: "Does not match expected output",
  completed: "Completed — no expected output; ungraded",
  compile_error: "Compile error", runtime_error: "Runtime error", timeout: "Timed out",
  invalid_output: "Invalid output — return a value matching the output schema within the result limit",
  skipped: "Skipped — batch budget exhausted",
};

export function PracticeResults({ outcome, busy, error, reason, codeVersion, inputVersion, files, onProblem }: {
  outcome: PracticeOutcome | undefined; busy: boolean; error: string | undefined; reason: string;
  codeVersion: string; inputVersion: string; files: SourceFile[]; onProblem: (problem: CodeProblem) => void;
}) {
  const [selected, setSelected] = useState<string>();
  useEffect(() => setSelected(outcome?.selected), [outcome]);
  const r = outcome?.result.results.find((r) => r.id === selected) ?? outcome?.result.results[0];
  const c = outcome?.cases.find((c) => c.id === r?.id);
  const problems = r ? checkProblems({ at: "", sandboxed: true, passed: ["passed", "completed"].includes(r.status), results: [{ command: "Practice", exitCode: ["passed", "completed"].includes(r.status) ? 0 : 1, output: `${r.stdout}\n${r.stderr}`, durationMs: r.durationMs, timedOut: r.status === "timeout" }] }, files).filter((p) => p.path) : [];
  return <div role="region" aria-label="Practice result" aria-live="polite">
    {busy && <p role="status">Running practice cases…</p>}
    {error && <p className="error small" role="alert">Practice run unavailable: {error}</p>}
    {!outcome && !busy && !error && <p className="small muted">No practice results yet. Run tries your sample and custom cases without grading. {reason}</p>}
    {outcome && <>
      {(outcome.code !== codeVersion || outcome.input !== inputVersion) && <p className="notice small">This practice result is from before your latest code or case edits.</p>}
      <div role="tablist" aria-label="Case results" className="case-tabs">
        {outcome.result.results.map((result, n) => <button key={result.id} type="button" role="tab" aria-selected={result.id === r?.id} tabIndex={result.id === r?.id ? 0 : -1} aria-controls="practice-case-result" onClick={() => setSelected(result.id)} onKeyDown={(event) => tabKeys(event, outcome.result.results.map((r) => r.id), r?.id ?? "", setSelected)}>Case {n + 1}: {result.status.replaceAll("_", " ")}</button>)}
      </div>
      {r && c && <div id="practice-case-result" role="tabpanel" aria-label={c.name}>
        <p><strong>{labels[r.status]}</strong> <span className="small muted">{r.durationMs} ms</span></p>
        <p className="small muted">Practice does not change your graded lesson status.</p>
        {Object.entries(c.inputs).map(([name, value]) => <div key={name}><span className="small">Input: {name}</span><pre>{JSON.stringify(value, null, 2)}</pre></div>)}
        {Object.hasOwn(c, "expected") && <><span className="small">Expected output</span><pre>{JSON.stringify(c.expected, null, 2)}</pre></>}
        {Object.hasOwn(r, "actual") && <><span className="small">Actual output</span><pre>{JSON.stringify(r.actual, null, 2)}</pre></>}
        {r.stdout && <><span className="small">stdout</span><pre>{r.stdout}</pre></>}
        {r.stderr && <><span className="small">stderr</span><pre>{r.stderr}</pre></>}
        {r.outputTruncated && <p className="small muted">Output was truncated at the practice limit.</p>}
        {problems.map((p, n) => <button key={n} type="button" className="problem error" onClick={() => onProblem(p)}>{p.path}:{location(files.find((f) => f.path === p.path)!.content, p.from).line}: {p.message}</button>)}
      </div>}
    </>}
  </div>;
}
