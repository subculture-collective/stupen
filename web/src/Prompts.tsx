import { useEffect, useState } from "react";

import { api, type Prompt, type PromptLibrary, type Trigger } from "./api.ts";
import { loadPrompts } from "./Coach.tsx";
import { ConfirmButton } from "./ui.tsx";

/** The prompt library: what the coach buttons send, and which ones fire on their own. */
export function Prompts() {
  const [lib, setLib] = useState<PromptLibrary>();
  const [list, setList] = useState<Prompt[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.prompts().then(
      (l) => {
        setLib(l);
        setList(l.prompts);
      },
      (e) => setError(e.message),
    );
  }, []);

  if (!lib) return <p className="loading">{error ?? "Loading…"}</p>;

  const patch = (i: number, p: Partial<Prompt>) => {
    setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setDirty(true);
    setStatus(undefined);
  };
  const move = (i: number, d: -1 | 1) => {
    setList((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
    setDirty(true);
  };
  const saveAll = async () => {
    setError(undefined);
    try {
      const r = await api.savePrompts(list);
      setList(r.prompts);
      setDirty(false);
      setStatus("Saved.");
      void loadPrompts(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="prompts-page">
      <div className="prompts-head">
        <div>
          <h1>Prompts</h1>
          <p className="muted">
            These are the buttons above the coach's message box. A trigger lets a prompt fire on its own: <strong>Send automatically</strong> sends it as soon as the event happens,
            and <strong>Suggest</strong> highlights it so you can choose. You can switch automatic prompts off in the coach panel.
          </p>
        </div>
        <div className="row">
          <button type="button" className="primary" disabled={!dirty} onClick={() => void saveAll()}>
            Save changes
          </button>
          <button
            type="button"
            onClick={() => {
              setList([
                ...list,
                { id: "", label: "New prompt", text: "", trigger: "manual", mode: "suggest", builtIn: false },
              ]);
              setDirty(true);
            }}
          >
            Add prompt
          </button>
          <ConfirmButton
            question="Reset every prompt to the built-in set? Your own prompts are removed."
            confirmLabel="Reset"
            danger
            onConfirm={() =>
              api.resetPrompts().then((r) => {
                setList(r.prompts);
                setDirty(false);
                setStatus("Reset to the built-in prompts.");
                void loadPrompts(true);
              })
            }
          >
            Reset to defaults
          </ConfirmButton>
          {status && <span className="ok small">{status}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <details className="placeholders card">
        <summary>Placeholders you can use in a prompt</summary>
        <ul>
          {Object.entries(lib.placeholders).map(([k, v]) => (
            <li key={k}>
              <code>{`{{${k}}}`}</code> {v}
            </li>
          ))}
        </ul>
        <p className="small muted">Every message also carries the lesson files and your latest check output, so prompts rarely need to repeat them.</p>
      </details>

      <ol className="prompt-list">
        {list.map((p, i) => (
          <li key={p.id || `new-${i}`} className="card prompt-card">
            <div className="row">
              <input className="prompt-label" value={p.label} aria-label="Button label" onChange={(e) => patch(i, { label: e.target.value })} />
              {p.builtIn && <span className="pill">built in</span>}
              <span className="spacer" />
              <button type="button" className="link small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.label} up`}>
                Up
              </button>
              <button type="button" className="link small" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.label} down`}>
                Down
              </button>
              <button
                type="button"
                className="link small"
                onClick={() => {
                  setList(list.filter((_, j) => j !== i));
                  setDirty(true);
                }}
              >
                Remove
              </button>
            </div>
            <textarea rows={3} value={p.text} aria-label={`Text of ${p.label}`} placeholder="What to send to the coach" onChange={(e) => patch(i, { text: e.target.value })} />
            <div className="row wrap">
              <label className="small">
                Trigger{" "}
                <select value={p.trigger} onChange={(e) => patch(i, { trigger: e.target.value as Trigger })}>
                  {(Object.entries(lib.triggers) as [Trigger, string][]).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {p.trigger !== "manual" && p.trigger !== "grade" && (
                <div className="segmented small" role="group" aria-label="When the trigger fires">
                  {(["suggest", "auto"] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={p.mode === m} className={p.mode === m ? "on" : ""} onClick={() => patch(i, { mode: m })}>
                      {m === "auto" ? "Send automatically" : "Suggest"}
                    </button>
                  ))}
                </div>
              )}
              {p.trigger === "grade" && <span className="small muted">Sent when you press Submit for grading in a written-answer lesson.</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
