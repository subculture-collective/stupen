import { useState } from "react";

import { api, type Level, type Me, type Provider, type Track, type TrackState } from "./api.ts";
import { ProviderToggle } from "./ProviderToggle.tsx";
import { ConfirmButton } from "./ui.tsx";
import { LADDER } from "./ladder.ts";

const STYLES = ["Explain first, then practise", "Practice first, explain when I'm stuck", "Lots of small examples", "Short and terse", "Ask me questions (Socratic)", "Relate it to real projects"];

/** Guess a practice format from what the learner typed. */
export function guessRunner(subject: string): string | undefined {
  const s = subject.toLowerCase();
  const table: [RegExp, string][] = [
    [/typescript|\bts\b|deno/, "typescript"],
    [/javascript|\bjs\b|node(\.js)?\b|react/, "javascript"],
    [/python|django|flask|pandas|numpy/, "python"],
    [/\bgo\b|golang/, "go"],
    [/rust/, "rust"],
    [/java\b|spring|jvm/, "java"],
    [/c\+\+|cpp/, "cpp"],
    [/\bc\b(?!#|\+)|\bc language/, "c"],
    [/sql|sqlite|postgres|mysql|database quer/, "sql"],
    [/bash|shell script|\bsh\b|linux command/, "bash"],
  ];
  return table.find(([re]) => re.test(s))?.[1];
}

export function TrackForm(props: {
  me: Me;
  track?: Track;
  state?: TrackState;
  first?: boolean;
  onSaved: (t: Track, opts: { plan: boolean }) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
}) {
  const t = props.track;
  const [subject, setSubject] = useState(t?.subject ?? "");
  const [title, setTitle] = useState(t?.title ?? "");
  const [level, setLevel] = useState<Level>(t?.level ?? "beginner");
  const [runnerId, setRunnerId] = useState(t?.runner ?? "");
  const [runnerTouched, setRunnerTouched] = useState(Boolean(t));
  const [customCommand, setCustomCommand] = useState(t?.customCommand ?? "");
  const [goals, setGoals] = useState(t?.goals ?? "");
  const [background, setBackground] = useState(t?.background ?? "");
  const [style, setStyle] = useState(t?.style ?? "");
  const [minutes, setMinutes] = useState(t?.sessionMinutes ?? 30);
  const [ceiling, setCeiling] = useState(t?.defaultCeiling ?? 4);
  const [provider, setProvider] = useState<Provider>(t?.provider ?? "claude");
  const [web, setWeb] = useState(t?.web ?? true);
  const [writePlan, setWritePlan] = useState(true);
  const [findMaterials, setFindMaterials] = useState(false);
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const effectiveRunner = runnerId || guessRunner(subject) || "written";
  const runner = props.me.runners.find((r) => r.id === effectiveRunner);

  const submit = async () => {
    setError(undefined);
    setSaved(false);
    const fields: Partial<Track> = {
      subject,
      title: title || subject,
      level,
      runner: effectiveRunner,
      ...(effectiveRunner === "custom" ? { customCommand } : {}),
      goals,
      background,
      style,
      sessionMinutes: minutes,
      defaultCeiling: ceiling,
      provider,
      web,
    };
    try {
      if (t) {
        setBusy("Saving…");
        const updated = await api.updateTrack(t.id, fields);
        setSaved(true);
        await props.onSaved(updated, { plan: false });
        return;
      }
      setBusy("Creating the track…");
      const created = await api.createTrack(fields);
      const materialIds: string[] = [];
      const problems: string[] = [];
      for (const url of links.split(/\s+/).filter((u) => /^https?:\/\//.test(u))) {
        setBusy(`Fetching ${url}…`);
        await api.addMaterial(created.id, { kind: "url", url }).then((m) => materialIds.push(m.id), (e) => problems.push(`${url}: ${e.message}`));
      }
      for (const f of files) {
        setBusy(`Reading ${f.name}…`);
        await fileToBase64(f)
          .then((data) => api.addMaterial(created.id, { kind: "file", name: f.name, data }))
          .then((m) => materialIds.push(m.id), (e) => problems.push(`${f.name}: ${e.message}`));
      }
      if (problems.length) setError(`Some materials were not added: ${problems.join("; ")}`);
      if (findMaterials) {
        setBusy("Starting the search…");
        // The search job builds what it finds into the plan, so it writes the plan itself.
        await api.findJob(created.id, { incorporate: writePlan, provider });
      }
      if (writePlan && !findMaterials) await api.planJob(created.id, { ...(materialIds.length ? { materialIds } : {}), web, provider });
      await props.onSaved(created, { plan: writePlan || findMaterials });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <form
      className="track-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {t ? (
        <h1>Track settings</h1>
      ) : (
        <>
          <h1>{props.first ? "What do you want to learn?" : "New track"}</h1>
          <p className="muted lede">
            Tell the coach where you are and where you want to get to. It writes a plan sized to you, builds lessons one at a time with real exercises, and helps in chat as much or as
            little as you allow.
          </p>
        </>
      )}

      <label className="field">
        <span>Subject</span>
        <input
          required
          value={subject}
          placeholder="For example: Rust, SQL joins, data structures in Python, Spanish past tenses"
          onChange={(e) => {
            setSubject(e.target.value);
            if (!runnerTouched) setRunnerId("");
          }}
        />
      </label>

      <fieldset className="field">
        <legend>Your level</legend>
        <div className="level-cards">
          {props.me.levels.map((l) => (
            <label key={l.id} className={`level-card ${level === l.id ? "on" : ""}`}>
              <input type="radio" name="level" value={l.id} checked={level === l.id} onChange={() => setLevel(l.id)} />
              <strong>{l.label.split(":")[0]}</strong>
              <span className="small muted">{l.label.split(":")[1]?.trim() ?? ""}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>Goals</span>
        <textarea rows={3} value={goals} placeholder="What you want to be able to do, and by when if it matters. A job interview, a project idea, an exam…" onChange={(e) => setGoals(e.target.value)} />
      </label>

      <label className="field">
        <span>
          Background <span className="muted">(optional)</span>
        </span>
        <textarea rows={2} value={background} placeholder="Languages or subjects you already know, what you have tried before" onChange={(e) => setBackground(e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>
          How you like to learn <span className="muted">(optional)</span>
        </legend>
        <div className="chips">
          {STYLES.map((s) => {
            const on = style.includes(s);
            return (
              <button
                type="button"
                key={s}
                className={`chip ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() => setStyle(on ? style.replace(s, "").replace(/^[;,\s]+|[;,\s]+$/g, "").replace(/;\s*;/g, ";") : style ? `${style}; ${s}` : s)}
              >
                {s}
              </button>
            );
          })}
        </div>
        <input value={style} aria-label="How you like to learn, in your words" placeholder="Or describe it in your own words" onChange={(e) => setStyle(e.target.value)} />
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>Practice format</span>
          <select
            value={effectiveRunner}
            onChange={(e) => {
              setRunnerId(e.target.value);
              setRunnerTouched(true);
            }}
          >
            {props.me.runners.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.ok && r.id !== t?.runner}>
                {r.label}
                {r.ok ? "" : ` (not installed: ${r.detail})`}
              </option>
            ))}
          </select>
          {runner && <span className="small muted">{runner.graded ? "You write answers; the coach grades them." : runner.id === "custom" ? "You give the command that checks your work." : "Exercises come with tests that run in a sandbox."}</span>}
        </label>
        <label className="field narrow">
          <span>Minutes per session</span>
          <input type="number" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      </div>
      {effectiveRunner === "custom" && (
        <label className="field">
          <span>Check command</span>
          <input value={customCommand} placeholder="For example: ruby -Itest test/solution_test.rb" onChange={(e) => setCustomCommand(e.target.value)} />
          <span className="small muted">Runs with bash in a sandboxed copy of each lesson folder, with no network. The tools it needs must be installed on the server.</span>
        </label>
      )}

      <label className="field">
        <span>
          Default help limit: <strong>{ceiling}</strong>
        </span>
        <input type="range" min={0} max={6} value={ceiling} onChange={(e) => setCeiling(Number(e.target.value))} />
        <span className="small muted">{LADDER[ceiling]}</span>
      </label>

      <div className="field-row">
        <div className="field">
          <span>Model for plans and lessons</span>
          <ProviderToggle value={provider} onChange={setProvider} label="Model for plans and lessons" />
        </div>
        <label className="check">
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
          <span>
            Let the coach search and read the web
            <span className="small muted block">For sources, current documentation and fact-checking. Pages it reads are treated as reference only.</span>
          </span>
        </label>
      </div>

      {!t && (
        <fieldset className="field materials-start">
          <legend>
            Materials you already have <span className="muted">(optional)</span>
          </legend>
          <textarea rows={2} value={links} placeholder="Links, one per line: course pages, docs, articles, exercise sets" onChange={(e) => setLinks(e.target.value)} />
          <input type="file" multiple aria-label="Files to add" accept=".pdf,.md,.txt,.html,.htm,.docx,.odt,.epub,.ipynb,.csv,.json,.py,.ts,.js,.go,.rs,.java,.c,.cpp,.h,.sql,.sh" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          <span className="small muted">PDF, Markdown, text, Word, EPUB, notebooks and code files. The plan is built around them.</span>
          <label className="check">
            <input type="checkbox" checked={writePlan} onChange={(e) => setWritePlan(e.target.checked)} />
            <span>Write my learning plan now</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={findMaterials} disabled={!web} onChange={(e) => setFindMaterials(e.target.checked)} />
            <span>Search the web for good materials first, then write the plan from them</span>
          </label>
        </fieldset>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={Boolean(busy) || !subject.trim()}>
          {busy ?? (t ? "Save settings" : writePlan || findMaterials ? "Create track and plan" : "Create track")}
        </button>
        {saved && !busy && <span className="ok small">Saved.</span>}
        {t && props.onDeleted && (
          <>
            <span className="spacer" />
            <ConfirmButton
              question={`Delete “${t.title}” with its plan, ${props.state?.lessons.length ?? 0} lessons and ${props.state?.materials.length ?? 0} materials?`}
              confirmLabel="Delete track"
              danger
              onConfirm={() => api.deleteTrack(t.id).then(() => props.onDeleted?.(), (e) => setError(e.message))}
            >
              Delete track
            </ConfirmButton>
          </>
        )}
      </div>
    </form>
  );
}

export function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error(`could not read ${f.name}`));
    r.readAsDataURL(f);
  });
}
