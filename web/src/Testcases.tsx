import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CASE_LIMIT, jsonBytes, parseCaseDrafts, sampleDraft, validateCaseDrafts, type CaseDraft, type CaseDrafts } from "../../shared/cases.ts";
import type { PracticeRun } from "../../shared/practiceRun.ts";
import type { Practice } from "../../shared/practice.ts";
import { api } from "./api.ts";
import { tabKeys } from "./ui.tsx";

// A quick return to a lesson must read after its previous instance's queued writes.
// Only promises live here; learner drafts are not cached across accounts.
const pendingSaves = new Map<string, Promise<void>>();

export type CaseControls = { enabled: boolean; reason: string };
export type TestcasesHandle = { run: () => void };
export const Testcases = forwardRef<TestcasesHandle, { track: string; lesson: string; practice: Practice | undefined; codeVersion: string; beforeRun: () => Promise<string>; acquire: () => boolean; release: () => void; onState: (state: CaseControls) => void; reportError: (message: string | undefined) => void }>(function Testcases({ track, lesson, practice, codeVersion, beforeRun, acquire, release, onState, reportError }, ref) {
  const [capability, setCapability] = useState<{ enabled: boolean; reason: string }>();
  const [run, setRun] = useState<{ result: PracticeRun; code: string; input: string }>();
  const [runError, setRunError] = useState<string>();
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!practice) return;
    let active = true;
    api.practiceAvailability(track, lesson).then((c) => { if (active) setCapability(c); }).catch((e) => { if (active) setCapability({ enabled: false, reason: e.message }); });
    return () => { active = false; };
  }, [track, lesson, practice]);
  const [draft, setDraft] = useState<CaseDrafts>();
  const [loadingError, setLoadingError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [status, setStatus] = useState("Loading cases…");
  const [reload, setReload] = useState(0);
  const pending = useRef<CaseDrafts | undefined>(undefined);
  const saving = useRef(false);
  const latest = useRef<CaseDrafts | undefined>(undefined);
  const saved = useRef<CaseDrafts | undefined>(undefined);
  const executeRef = useRef<(() => void) | undefined>(undefined);
  useImperativeHandle(ref, () => ({ run: () => executeRef.current?.() }));
  useEffect(() => {
    const valid = draft && practice && parseCaseDrafts(draft, practice).cases;
    const reason = !practice ? "Run needs compatible generated case metadata. Submit still uses the original checks." : !draft ? "Loading practice inputs…" : !valid ? "Fix invalid case inputs before Run. Submit still uses the original checks." : !capability?.enabled ? capability?.reason ?? "Checking practice runner…" : "";
    onState({ enabled: Boolean(valid && capability?.enabled), reason });
  }, [draft, practice, capability, onState]);
  const metadata = JSON.stringify(practice);
  const saveKey = `${track}/${lesson}`;
  useEffect(() => {
    if (!practice) return;
    let active = true;
    setLoadingError(undefined);
    void (async () => {
      await pendingSaves.get(saveKey);
      return api.caseDrafts(track, lesson);
    })().then((d) => {
      validateCaseDrafts(d, practice);
      if (active) { latest.current = saved.current = d; setDraft(d); setStatus("Cases saved"); }
    }).catch((e) => { if (active) setLoadingError(e.message); });
    return () => { active = false; };
  }, [track, lesson, metadata, reload]);

  executeRef.current = undefined;
  if (!practice) return <p className="small muted">Editable cases need compatible generated sample metadata. This lesson keeps its ordinary checks or coach grading.</p>;
  if (!draft) return <div role="status">{loadingError ? <><p className="error">{loadingError}</p><button type="button" onClick={() => setReload(reload + 1)}>Retry loading cases</button></> : "Loading cases…"}</div>;

  // Drain edits in order, coalescing changes made during an in-flight save. The queue
  // also finishes after unmount, using this lesson's endpoint, never the next lesson.
  const persist = () => {
    if (saving.current) return;
    saving.current = true;
    setSaveError(undefined);
    const work = (async () => {
      try {
        while (pending.current) {
          const next = pending.current;
          setStatus("Saving cases…");
          await api.saveCaseDrafts(track, lesson, next);
          saved.current = next;
          if (pending.current === next) pending.current = undefined;
        }
        setStatus(saved.current === latest.current ? "Cases saved" : "Cases not saved");
      } catch (e) { setSaveError((e as Error).message); setStatus("Cases not saved"); }
      finally { saving.current = false; }
    })();
    pendingSaves.set(saveKey, work);
    void work.finally(() => { if (pendingSaves.get(saveKey) === work) pendingSaves.delete(saveKey); });
  };
  const update = (next: CaseDrafts) => {
    latest.current = next;
    setDraft(next);
    setStatus("Cases not saved");
    try {
      validateCaseDrafts(next, practice);
      pending.current = next;
      void persist();
    } catch (e) { pending.current = undefined; setSaveError((e as Error).message); }
  };
  const current = draft.cases.find((c) => c.id === draft.selected)!;
  const change = (fields: Partial<CaseDraft>) => update({ ...draft, cases: draft.cases.map((c) => c.id === current.id ? { ...c, ...fields } : c) });
  const validation = parseCaseDrafts(draft, practice);
  const errors = validation.errors[current.id] ?? {};
  const sample = practice.cases.find((c) => c.id === current.id);
  const add = () => {
    const custom: CaseDraft = { id: `custom-${crypto.randomUUID()}`, name: `Custom case ${draft.cases.filter((c) => c.id.startsWith("custom-")).length + 1}`, inputs: { ...current.inputs } };
    update({ ...draft, selected: custom.id, cases: [...draft.cases, custom] });
  };
  const remove = () => {
    const index = draft.cases.indexOf(current);
    const cases = draft.cases.filter((c) => c.id !== current.id);
    update({ ...draft, cases, selected: cases[Math.max(0, index - 1)]!.id });
  };
  const selected = validation.cases?.find((c) => c.id === current.id);
  const inputVersion = JSON.stringify(selected ?? current);
  const execute = async () => {
    if (inFlight.current || !selected || !capability?.enabled || !acquire()) return;
    inFlight.current = true;
    setRunning(true);
    setRunError(undefined);
    reportError(undefined);
    try {
      const code = await beforeRun();
      const result = await api.runCase(track, lesson, { version: 1, cases: [selected] });
      setRun({ result, code, input: inputVersion });
    } catch (e) { const message = (e as Error).message; setRunError(message); reportError(message); }
    finally { inFlight.current = false; setRunning(false); release(); }
  };
  executeRef.current = () => { void execute(); };
  return <>
    <div className="case-controls">
      <div role="tablist" aria-label="Test cases" className="case-tabs">
        {draft.cases.map((c, i) => <button type="button" role="tab" key={c.id} id={`case-${c.id}`} aria-controls="case-body" aria-selected={c.id === draft.selected} tabIndex={c.id === draft.selected ? 0 : -1} onClick={() => update({ ...draft, selected: c.id })} onKeyDown={(e) => tabKeys(e, draft.cases.map((c) => c.id), draft.selected, (selected) => update({ ...draft, selected }))} title={c.name}>
          {c.id.startsWith("custom-") ? "Custom" : "Sample"} {i + 1}{validation.errors[c.id] ? " (invalid)" : ""}
        </button>)}
      </div>
      <button type="button" className="small-button" onClick={add} disabled={draft.cases.length >= CASE_LIMIT}>Add custom case</button>
    </div>
    <div id="case-body" role="tabpanel" aria-labelledby={`case-${current.id}`}>
      <div className="case-heading"><strong>{sample ? `Generated sample: ${current.name}` : "Your custom case"}</strong>
        {sample ? <button type="button" className="link small" onClick={() => update({ ...draft, cases: draft.cases.map((c) => c.id === current.id ? sampleDraft(sample) : c) })}>Reset sample</button> : <button type="button" className="link small" onClick={remove}>Remove custom case</button>}
      </div>
      {!sample && <label>Case name<input value={current.name} maxLength={80} onChange={(e) => change({ name: e.target.value })} /></label>}
      {practice.inputs.map((input, i) => <label key={input.name} htmlFor={`case-input-${i}`}>
        {input.name} <span className="muted small">{input.schema.type} (JSON)</span>
        <textarea id={`case-input-${i}`} value={current.inputs[input.name]} rows={2} spellCheck={false} aria-invalid={Boolean(errors[`inputs.${input.name}`])} aria-describedby={`case-input-help-${i}`} onChange={(e) => change({ inputs: { ...current.inputs, [input.name]: e.target.value } })} />
        <span id={`case-input-help-${i}`} className={errors[`inputs.${input.name}`] ? "error small" : "small muted"}>{errors[`inputs.${input.name}`] ?? `Schema: ${JSON.stringify(input.schema)}`}</span>
      </label>)}
      {!practice.inputs.length && <p className="small muted">This function takes no inputs.</p>}
      <label className="case-compare"><input type="checkbox" checked={current.expected !== undefined} onChange={(e) => {
        if (e.target.checked) change({ expected: sample ? sampleDraft(sample).expected ?? "" : "" });
        else { const { expected: _expected, ...without } = current; update({ ...draft, cases: draft.cases.map((c) => c.id === current.id ? without : c) }); }
      }} />Compare expected output</label>
      {current.expected !== undefined ? <label>Expected output <span className="muted small">{practice.output.type} (JSON)</span>
        <textarea rows={2} spellCheck={false} value={current.expected} aria-invalid={Boolean(errors.expected)} aria-describedby="case-expected-help" onChange={(e) => change({ expected: e.target.value })} />
        <span id="case-expected-help" className={errors.expected ? "error small" : "small muted"}>{errors.expected ?? `Schema: ${JSON.stringify(practice.output)}`}</span>
      </label> : <p className="small muted">No expected output: runs show actual output without a pass/fail comparison.</p>}
      <p className="small muted">{draft.cases.length}/{CASE_LIMIT} cases; {jsonBytes(current)}/65536 raw draft bytes (32 KiB parsed per case). Limits: 256 KiB total, 1000 items/array, 8192 bytes/string, safe numbers, 8 levels.</p>
      {validation.error && <p className="error small" role="alert">{validation.error}</p>}
      <p className="small" role="status">{status}. {!validation.cases && "Invalid inputs cannot run."}</p>
      {saveError && <div className="error small" role="alert">{saveError} <button type="button" onClick={() => update(draft)}>Retry saving cases</button></div>}
      {running && <p role="status">Running selected case…</p>}
      {!capability?.enabled && <p className="small muted">{capability?.reason ?? "Checking practice runner…"}</p>}
      <p className="small muted">Practice runs do not grade the lesson. Submit uses the lesson’s original tests.</p>
      {runError && <p className="error small" role="alert">{runError}</p>}
      {run && <div aria-label="Practice result" role="region" aria-live="polite">
        {(run.code !== codeVersion || run.input !== inputVersion) && <p className="notice small">This practice result is from before your latest code or case edits.</p>}
        {run.result.results.map((r) => <div key={r.id}>
          <p><strong>Practice: {r.status.replaceAll("_", " ")}</strong> <span className="small muted">{r.durationMs} ms</span></p>
          {Object.hasOwn(r, "actual") && <><span className="small">Actual output</span><pre>{JSON.stringify(r.actual, null, 2)}</pre></>}
          {r.stdout && <><span className="small">stdout</span><pre>{r.stdout}</pre></>}
          {r.stderr && <><span className="small">stderr</span><pre>{r.stderr}</pre></>}
          {r.outputTruncated && <p className="small muted">Output was truncated at the practice limit.</p>}
        </div>)}
      </div>}
    </div>
  </>;
});
