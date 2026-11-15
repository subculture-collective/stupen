import { useEffect, useState } from "react";
import { SUBMISSION_LIMIT, type Submission } from "../../shared/submissions.ts";
import { api, type Checks } from "./api.ts";

export function Submissions({ track, lesson, attempts, latest, graded }: { track: string; lesson: string; attempts: number; latest: Checks | undefined; graded: boolean }) {
  const [entries, setEntries] = useState<Submission[]>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setEntries(undefined);
    setError(undefined);
    void api.submissions(track, lesson).then(
      (items) => { if (!cancelled) setEntries(items); },
      (e) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [track, lesson, attempts, retry]);
  const current = entries?.find((s) => s.id === selected);
  return <section aria-label="Personal submissions">
    <h3>Submissions</h3>
    <p className="muted small">Your latest {SUBMISSION_LIMIT} canonical submissions, newest first. Older entries expire. Practice runs are not recorded here. Check output may contain text printed by your code.</p>
    {graded && <p>Written answers are graded in the coach conversation.</p>}
    {error ? <div role="alert"><p>Could not load submissions: {error}</p><button type="button" onClick={() => setRetry((n) => n + 1)}>Retry submissions</button></div>
      : !entries ? <p role="status">Loading submissions…</p>
      : <>
        {!entries.length && <p>No canonical submissions recorded yet.</p>}
        <ol>{entries.map((s) => <li key={s.id}><button type="button" aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}><time dateTime={s.at}>{new Date(s.at).toLocaleString()}</time> — {s.passed ? "Passed" : "Failed"} · {s.durationMs} ms</button></li>)}</ol>
        {current && <section aria-label="Submission details"><h4>{current.passed ? "Passed" : "Failed"} submission</h4><p><time dateTime={current.at}>{new Date(current.at).toLocaleString()}</time> · {current.durationMs} ms (check execution)</p>{current.detailsTruncated && <p className="notice">Retained details truncated to the history limit.</p>}<CheckDetails checks={current.checks} /></section>}
        {!entries.length && latest && <section aria-label="Existing latest result"><h4>Existing latest result</h4><p className="muted small">Saved before submission history; no earlier attempts have been reconstructed.</p><CheckDetails checks={latest} /></section>}
      </>}
  </section>;
}

function CheckDetails({ checks }: { checks: Checks }) {
  return <>{checks.results.map((r, i) => <div key={i}><p className="small">{r.command} · {r.timedOut ? "Timed out" : `exit ${r.exitCode ?? "unknown"}`} · {r.durationMs} ms</p><pre className="check-output">{r.output || "No output."}</pre></div>)}</>;
}
