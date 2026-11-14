import { useState } from "react";

import { api, type Job, type TrackState } from "./api.ts";
import { href } from "./App.tsx";
import { Md } from "./Md.tsx";
import { ConfirmButton, StatusIcon } from "./ui.tsx";

const QUICK = ["Make it faster-paced", "Go slower and add more practice", "Add a small project at the end", "Focus more on real-world use", "Prepare me for interviews"];

export function Plan(props: { state: TrackState; refresh: () => Promise<void>; onJob: (j: Job) => void }) {
  const { state } = props;
  const t = state.track;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.plan);
  const [instruction, setInstruction] = useState("");
  const [web, setWeb] = useState(t.web);
  const [notes, setNotes] = useState(state.notes);
  const [notesEditing, setNotesEditing] = useState(false);
  const [error, setError] = useState<string>();
  const running = state.jobs.find((j) => j.state === "running");
  const byOutline = new Map(state.lessons.filter((l) => l.outlineId).map((l) => [l.outlineId!, l]));

  const job = async (p: Promise<Job>) => {
    setError(undefined);
    try {
      props.onJob(await p);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!state.plan.trim() && !editing) {
    return (
      <section className="plan empty-plan">
        <h1>Learning plan</h1>
        {running ? (
          <p className="muted">{running.title}… Progress shows in the bar above.</p>
        ) : (
          <>
            <p>No plan yet. The coach writes one from your level, goals and any materials you added{t.web ? ", and searches the web for good sources" : ""}.</p>
            <div className="row">
              <button type="button" className="primary" onClick={() => job(api.planJob(t.id, { web }))}>
                Write my plan
              </button>
              <button type="button" onClick={() => setEditing(true)}>
                Write it myself
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="plan">
      <div className="plan-main">
        <div className="plan-head">
          <h1>Learning plan</h1>
          <span className="spacer" />
          {editing ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  api.savePlan(t.id, draft).then(
                    () => {
                      setEditing(false);
                      void props.refresh();
                    },
                    (e) => setError(e.message),
                  )
                }
              >
                Save plan
              </button>
              <button type="button" onClick={() => (setEditing(false), setDraft(state.plan))}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => (setDraft(state.plan), setEditing(true))}>
              Edit
            </button>
          )}
        </div>
        {state.outline.summary && !editing && <p className="lede">{state.outline.summary}</p>}
        {editing ? (
          <textarea className="plan-editor" value={draft} aria-label="Plan in Markdown" onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <Md className="md plan-md">{state.plan}</Md>
        )}
      </div>

      <aside className="plan-side">
        <section className="card">
          <h2>Change the plan</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!instruction.trim()) return;
              void job(api.planJob(t.id, { instruction, web }));
              setInstruction("");
            }}
          >
            <textarea rows={3} value={instruction} placeholder="Tell the coach what to change: pace, focus, a new goal, topics to add or drop…" aria-label="How to change the plan" onChange={(e) => setInstruction(e.target.value)} />
            <div className="chips">
              {QUICK.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => setInstruction(q)}>
                  {q}
                </button>
              ))}
            </div>
            <label className="check small">
              <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Search the web while revising
            </label>
            <div className="row">
              <button type="submit" className="primary" disabled={Boolean(running) || !instruction.trim()}>
                Revise plan
              </button>
              <button type="button" disabled={Boolean(running)} onClick={() => job(api.planJob(t.id, { web }))} title="Re-plan the remaining lessons from how the finished ones went">
                Adapt to my progress
              </button>
            </div>
          </form>
          {error && <p className="error small">{error}</p>}
        </section>

        <section className="card">
          <h2>Lessons</h2>
          <ol className="plan-outline">
            {state.outline.lessons.map((o) => {
              const l = byOutline.get(o.id);
              return (
                <li key={o.id}>
                  <div className="row">
                    {l ? <StatusIcon status={l.status === "passed" ? "passed" : l.lastPassed === false ? "failed" : "unchecked"} /> : <span className="bullet" aria-hidden="true" />}
                    {l ? <a href={href({ page: "track", track: t.id, view: "learn", lesson: l.id })}>{o.title}</a> : <strong>{o.title}</strong>}
                    <span className="spacer" />
                    {!l && (
                      <button type="button" className="link small" disabled={Boolean(running)} onClick={() => job(api.lessonJob(t.id, { outlineId: o.id }))}>
                        Build
                      </button>
                    )}
                  </div>
                  <p className="small muted">{o.objective}</p>
                </li>
              );
            })}
          </ol>
        </section>

        {state.outline.sources.length > 0 && (
          <section className="card">
            <h2>Sources</h2>
            <ul className="sources-list">
              {state.outline.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                  {s.note && <p className="small muted">{s.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <div className="row">
            <h2>Progress notes</h2>
            <span className="spacer" />
            <button type="button" className="link small" onClick={() => (notesEditing ? api.saveNotes(t.id, notes).then(() => (setNotesEditing(false), props.refresh())) : setNotesEditing(true))}>
              {notesEditing ? "Save" : "Edit"}
            </button>
          </div>
          <p className="small muted">What the coach has learned about you. It reads these when it builds lessons and replies, and updates them as you go.</p>
          {notesEditing ? <textarea rows={8} value={notes} aria-label="Progress notes" onChange={(e) => setNotes(e.target.value)} /> : <Md className="md small" fallback="_Nothing yet: notes appear after a few lessons._">{state.notes}</Md>}
        </section>

        {state.history.length > 0 && (
          <section className="card">
            <h2>Earlier versions</h2>
            <ul className="history">
              {state.history.slice(0, 10).map((h) => (
                <li key={h} className="row">
                  <span className="small">{historyLabel(h)}</span>
                  <span className="spacer" />
                  <ConfirmButton className="link small" question="Restore this version? The current plan is kept in history." confirmLabel="Restore" onConfirm={() => api.restorePlan(t.id, h).then(props.refresh, (e) => setError(e.message))}>
                    Restore
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </section>
  );
}

function historyLabel(name: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)-\d+Z-(.*)\.md$/.exec(name);
  if (!m) return name;
  const when = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  const why: Record<string, string> = { revision: "before a revision", "first-plan": "before the first plan", materials: "before adding materials", "manual-edit": "before your edit", "before-restore": "before a restore" };
  return `${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${why[m[7]!] ?? m[7]}`;
}
