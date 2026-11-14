import { useState } from "react";

import { api, type Job, type Material, type TrackState } from "./api.ts";
import { Md } from "./Md.tsx";
import { fileToBase64 } from "./TrackForm.tsx";
import { ConfirmButton } from "./ui.tsx";

type AddTab = "link" | "upload" | "paste" | "find";

export function Materials(props: { state: TrackState; refresh: () => Promise<void>; onJob: (j: Job) => void }) {
  const { state } = props;
  const t = state.track;
  const [tab, setTab] = useState<AddTab>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(5);
  const [buildIn, setBuildIn] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const running = state.jobs.find((j) => j.state === "running");

  const after = async (added: Material[]) => {
    await props.refresh();
    if (buildIn && added.length) props.onJob(await api.planJob(t.id, { materialIds: added.map((m) => m.id) }));
  };

  const add = async () => {
    setError(undefined);
    const added: Material[] = [];
    try {
      if (tab === "link") {
        const urls = url.split(/\s+/).filter(Boolean);
        for (const u of urls) {
          setBusy(`Fetching ${u}…`);
          added.push(await api.addMaterial(t.id, { kind: "url", url: u, ...(urls.length === 1 && title ? { title } : {}), ...(note ? { note } : {}) }));
        }
        setUrl("");
      } else if (tab === "paste") {
        setBusy("Saving…");
        added.push(await api.addMaterial(t.id, { kind: "text", title, text, ...(note ? { note } : {}) }));
        setText("");
      }
      setTitle("");
      setNote("");
      await after(added);
    } catch (e) {
      setError((e as Error).message);
      if (added.length) await props.refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const upload = async (files: File[]) => {
    setError(undefined);
    const added: Material[] = [];
    const problems: string[] = [];
    for (const f of files) {
      setBusy(`Reading ${f.name}…`);
      try {
        added.push(await api.addMaterial(t.id, { kind: "file", name: f.name, data: await fileToBase64(f) }));
      } catch (e) {
        problems.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(undefined);
    if (problems.length) setError(problems.join("; "));
    await after(added).catch((e) => setError((e as Error).message));
  };

  const job = async (p: Promise<Job>) => {
    setError(undefined);
    try {
      props.onJob(await p);
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <section className="materials">
      <div className="materials-add card">
        <h1>Materials</h1>
        <p className="muted small">
          Add what you're learning from (course pages, docs, books, your own notes) or let the coach find material on the web. Build materials into your plan, make a lesson
          from one, or attach one to a message in the coach.
        </p>
        <div className="tabs" role="tablist" aria-label="Add materials">
          {(
            [
              ["link", "Link"],
              ["upload", "Upload"],
              ["paste", "Paste text"],
              ["find", "Find on the web"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="add-body">
          {tab === "link" && (
            <>
              <textarea rows={2} value={url} placeholder="https://… (several links: one per line)" aria-label="Links" onChange={(e) => setUrl(e.target.value)} />
              <input value={title} placeholder="Title (optional)" aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
            </>
          )}
          {tab === "upload" && (
            <label className="drop">
              <input type="file" multiple accept=".pdf,.md,.markdown,.txt,.html,.htm,.docx,.odt,.epub,.ipynb,.csv,.json,.py,.ts,.js,.go,.rs,.java,.c,.cpp,.h,.sql,.sh,.rb" onChange={(e) => void upload([...(e.target.files ?? [])])} />
              <span>Choose files: PDF, Markdown, text, Word, ODT, EPUB, HTML, notebooks or code. Up to 15 MB each.</span>
            </label>
          )}
          {tab === "paste" && (
            <>
              <input value={title} placeholder="Title" aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
              <textarea rows={6} value={text} placeholder="Paste notes, an article, an exercise set, a syllabus…" aria-label="Text" onChange={(e) => setText(e.target.value)} />
            </>
          )}
          {tab === "find" && (
            <>
              <input value={query} placeholder={`What to look for (empty: materials for your next lessons in ${t.subject})`} aria-label="What to look for" onChange={(e) => setQuery(e.target.value)} />
              <label className="small">
                How many{" "}
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {(tab === "link" || tab === "paste") && <input value={note} placeholder="Why you're adding it (optional, helps the coach)" aria-label="Note" onChange={(e) => setNote(e.target.value)} />}
          <label className="check small">
            <input type="checkbox" checked={buildIn} onChange={(e) => setBuildIn(e.target.checked)} /> Build into my plan when added
          </label>
          {tab === "find" ? (
            <button type="button" className="primary" disabled={Boolean(running)} onClick={() => job(api.findJob(t.id, { ...(query ? { query } : {}), count, incorporate: buildIn }))}>
              Search the web
            </button>
          ) : tab !== "upload" ? (
            <button type="button" className="primary" disabled={Boolean(busy) || (tab === "link" ? !url.trim() : !text.trim())} onClick={() => void add()}>
              {busy ?? "Add"}
            </button>
          ) : (
            busy && <p className="small muted">{busy}</p>
          )}
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="materials-list">
        <div className="row list-actions">
          <h2>{state.materials.length ? `${state.materials.length} materials` : "No materials yet"}</h2>
          <span className="spacer" />
          {selected.length > 0 && (
            <>
              <span className="small muted">{selected.length} selected</span>
              <button type="button" disabled={Boolean(running)} onClick={() => job(api.planJob(t.id, { materialIds: selected }))}>
                Build into plan
              </button>
              <button type="button" disabled={Boolean(running)} onClick={() => job(api.lessonJob(t.id, { materialIds: selected }))}>
                Make a lesson
              </button>
            </>
          )}
        </div>
        <ul className="material-rows">
          {state.materials
            .slice()
            .reverse()
            .map((m) => (
              <MaterialRow
                key={m.id}
                m={m}
                track={t.id}
                selected={selected.includes(m.id)}
                open={open === m.id}
                toggle={() => toggle(m.id)}
                setOpen={(o) => setOpen(o ? m.id : undefined)}
                running={Boolean(running)}
                onJob={(p) => job(p)}
                refresh={props.refresh}
              />
            ))}
        </ul>
      </div>
    </section>
  );
}

function MaterialRow(props: {
  m: Material;
  track: string;
  selected: boolean;
  open: boolean;
  toggle: () => void;
  setOpen: (o: boolean) => void;
  running: boolean;
  onJob: (p: Promise<Job>) => void;
  refresh: () => Promise<void>;
}) {
  const { m } = props;
  const [text, setText] = useState<string>();
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(m.note);
  const [title, setTitle] = useState(m.title);
  const kind = { file: "File", url: "Link", text: "Text", web: "Found on the web" }[m.kind];
  const view = async () => {
    if (!props.open && text === undefined) setText((await api.material(props.track, m.id)).text);
    props.setOpen(!props.open);
  };
  return (
    <li className={`material ${props.selected ? "selected" : ""}`}>
      <div className="material-row">
        <input type="checkbox" checked={props.selected} onChange={props.toggle} aria-label={`Select ${m.title}`} />
        <div className="material-body">
          {editing ? (
            <input value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <p className="material-title">
              <strong>{m.title}</strong> <span className="pill">{kind}</span>
              {m.usedAt && <span className="pill pill-ok">in plan</span>}
            </p>
          )}
          {m.url && (
            <a className="small url" href={m.url} target="_blank" rel="noopener noreferrer">
              {m.url}
            </a>
          )}
          {editing ? (
            <textarea rows={2} value={note} aria-label="Note" onChange={(e) => setNote(e.target.value)} />
          ) : (
            m.note && <p className="small">{m.note}</p>
          )}
          <p className="small muted">
            {Math.round(m.chars / 1000)}k characters · added {new Date(m.addedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="material-actions">
          <button type="button" className="link small" aria-expanded={props.open} onClick={() => void view()}>
            {props.open ? "Hide" : "Read"}
          </button>
          {editing ? (
            <button type="button" className="link small" onClick={() => api.updateMaterial(props.track, m.id, { title, note }).then(() => (setEditing(false), props.refresh()))}>
              Save
            </button>
          ) : (
            <button type="button" className="link small" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button type="button" className="link small" disabled={props.running} onClick={() => props.onJob(api.lessonJob(props.track, { materialIds: [m.id] }))}>
            Make a lesson
          </button>
          <button type="button" className="link small" disabled={props.running} onClick={() => props.onJob(api.planJob(props.track, { materialIds: [m.id] }))}>
            Build into plan
          </button>
          <ConfirmButton className="link small" question="Delete this material?" confirmLabel="Delete" danger onConfirm={() => api.deleteMaterial(props.track, m.id).then(props.refresh)}>
            Delete
          </ConfirmButton>
        </div>
      </div>
      {props.open && text !== undefined && (
        <div className="material-text">
          <Md className="md small">{full ? text : text.slice(0, 4000)}</Md>
          {text.length > 4000 && (
            <button type="button" className="link small" onClick={() => setFull(!full)}>
              {full ? "Show less" : `Show all ${Math.round(text.length / 1000)}k characters`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
