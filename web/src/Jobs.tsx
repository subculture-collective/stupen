import { useState } from "react";

import { api, type Job, load, save } from "./api.ts";
import { href } from "./App.tsx";

const DISMISSED = "study-coach:dismissed-jobs";

/** Background work for the track: running jobs with their live log, and recent results until dismissed. */
export function JobStrip(props: { jobs: Job[]; track: string; onChange: () => void }) {
  const [dismissed, setDismissed] = useState<string[]>(() => load(DISMISSED, []));
  const [open, setOpen] = useState<string>();
  const recent = (j: Job) => !j.finishedAt || Date.now() - Date.parse(j.finishedAt) < 30 * 60_000;
  const shown = props.jobs.filter((j) => (j.state === "running" || recent(j)) && !dismissed.includes(j.id)).slice(-3);
  if (!shown.length) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    save(DISMISSED, next);
  };
  return (
    <section className="jobs" aria-label="Background work">
      {shown.map((j) => (
        <div key={j.id} className={`job job-${j.state}`} aria-live={j.state === "running" ? "polite" : undefined}>
          <div className="job-row">
            {j.state === "running" ? <span className="spinner" aria-hidden="true" /> : <span className={`job-mark job-mark-${j.state}`} aria-hidden="true" />}
            <strong>{j.title}</strong>
            <span className="muted small job-last">{j.state === "failed" ? j.error : j.state === "cancelled" ? "Cancelled" : (j.log.at(-1)?.replace(/^\S+ /, "") ?? "Starting…")}</span>
            <span className="spacer" />
            {j.state === "done" && j.result?.lesson && (
              <a className="button primary small-button" href={href({ page: "track", track: props.track, view: "learn", lesson: j.result.lesson })} onClick={() => dismiss(j.id)}>
                Open lesson
              </a>
            )}
            {j.state === "done" && j.kind === "plan" && (
              <a className="button small-button" href={href({ page: "track", track: props.track, view: "plan" })}>
                View plan
              </a>
            )}
            {j.state === "done" && j.result?.materials && (
              <a className="button small-button" href={href({ page: "track", track: props.track, view: "materials" })}>
                View materials
              </a>
            )}
            <button type="button" className="link small" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? undefined : j.id)}>
              {open === j.id ? "Hide log" : "Log"}
            </button>
            {j.state === "running" ? (
              <button type="button" className="link small" onClick={() => api.cancelJob(j.id).then(props.onChange)}>
                Cancel
              </button>
            ) : (
              <button type="button" className="link small" onClick={() => dismiss(j.id)}>
                Dismiss
              </button>
            )}
          </div>
          {j.state === "done" && j.result?.changes && open !== j.id && <p className="small job-changes">{j.result.changes.slice(0, 400)}</p>}
          {open === j.id && <pre className="job-log">{j.log.join("\n") || "No output yet."}</pre>}
        </div>
      ))}
    </section>
  );
}
