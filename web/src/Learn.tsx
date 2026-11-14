import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { api, type Checks, type Help, type Job, type LessonFile, type LessonMeta, type LessonSummary, load, type Me, save, type TrackState } from "./api.ts";
import { go, href } from "./App.tsx";
import { Coach, fireTrigger, type PromptVars } from "./Coach.tsx";
import { Editor } from "./Editor.tsx";
import { summarize } from "./checks.ts";
import { Md } from "./Md.tsx";
import { ConfirmButton, LockIcon, RUN_KEY, StatusIcon, useMedia } from "./ui.tsx";

type Pane = "lessons" | "work" | "coach";

export function Learn(props: { me: Me; state: TrackState; lessonId: string | undefined; refresh: () => Promise<void>; onJob: (j: Job) => void }) {
  const { state } = props;
  const narrow = useMedia("(max-width: 980px)");
  const [pane, setPane] = useState<Pane>(props.lessonId ? "work" : "lessons");
  const [lesson, setLesson] = useState<{ meta: LessonMeta; files: LessonFile[]; help: Help }>();
  const [error, setError] = useState<string>();
  const workbench = useRef<WorkbenchHandle>(null);

  // Open the most recent unfinished lesson when none is chosen.
  useEffect(() => {
    if (props.lessonId || !state.lessons.length) return;
    const pick = state.lessons.find((l) => l.status !== "passed") ?? state.lessons.at(-1)!;
    location.replace(href({ page: "track", track: state.track.id, view: "learn", lesson: pick.id }));
  }, [props.lessonId, state.lessons, state.track.id]);

  const loadLesson = useCallback(async () => {
    if (!props.lessonId) return setLesson(undefined);
    try {
      setLesson(await api.lesson(state.track.id, props.lessonId));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [props.lessonId, state.track.id]);
  useEffect(() => {
    setLesson(undefined);
    void loadLesson();
    if (props.lessonId && narrow) setPane("work");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLesson]);

  const runner = props.me.runners.find((r) => r.id === state.track.runner);
  const show = (p: Pane) => !narrow || pane === p;

  return (
    <div className={`learn ${narrow ? "narrow" : ""}`}>
      {narrow && (
        <div className="pane-switch" role="tablist" aria-label="Show">
          {(["lessons", "work", "coach"] as const).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={pane === p} className={pane === p ? "on" : ""} onClick={() => setPane(p)}>
              {p === "lessons" ? "Lessons" : p === "work" ? "Lesson" : "Coach"}
            </button>
          ))}
        </div>
      )}
      {show("lessons") && <LessonNav state={state} current={props.lessonId} onJob={props.onJob} refresh={props.refresh} />}
      {show("work") && (
        <div className="work">
          {error && <p className="error">{error}</p>}
          {!props.lessonId && !state.lessons.length && <NoLessons state={state} onJob={props.onJob} />}
          {lesson && (
            <Workbench
              ref={workbench}
              key={lesson.meta.id}
              state={state}
              lesson={lesson}
              graded={runner?.graded === "coach"}
              runnerOk={runner?.ok ?? true}
              runnerDetail={runner?.detail}
              sandboxed={props.me.sandbox.sandboxed}
              onMeta={(meta) => setLesson((l) => (l ? { ...l, meta } : l))}
              onDeleted={async () => {
                await props.refresh();
                go({ page: "track", track: state.track.id, view: "learn" });
              }}
              refresh={props.refresh}
              askCoach={() => narrow && setPane("coach")}
            />
          )}
        </div>
      )}
      {show("coach") && (
        <Coach
          track={state.track}
          lesson={lesson?.meta}
          materials={state.materials}
          vars={() => workbench.current?.vars() ?? {}}
          beforeSend={() => workbench.current?.saveAll() ?? Promise.resolve()}
          onHelp={(help) => setLesson((l) => (l ? { ...l, help } : l))}
          onVerdict={() => {
            void loadLesson();
            void props.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- lesson list ----------

function LessonNav(props: { state: TrackState; current: string | undefined; onJob: (j: Job) => void; refresh: () => Promise<void> }) {
  const { state } = props;
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string>();
  const running = state.jobs.find((j) => j.state === "running");
  const byOutline = new Map(state.lessons.filter((l) => l.outlineId).map((l) => [l.outlineId!, l]));
  const extra = state.lessons.filter((l) => !l.outlineId || !state.outline.lessons.some((o) => o.id === l.outlineId));
  const nextItem = state.outline.lessons.find((o) => !byOutline.has(o.id));
  const passed = state.lessons.filter((l) => l.status === "passed").length;

  const build = async (opts: { outlineId?: string; topic?: string }) => {
    setError(undefined);
    try {
      props.onJob(await api.lessonJob(state.track.id, opts));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <nav className="lesson-nav" aria-label="Lessons">
      <div className="nav-head">
        <h2>{state.track.title}</h2>
        <p className="small muted">
          {state.outline.lessons.length ? `${passed} of ${state.outline.lessons.length} plan lessons done` : "No plan yet"}
          {extra.length ? ` · ${extra.length} extra` : ""}
        </p>
        {state.outline.lessons.length > 0 && (
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (100 * passed) / state.outline.lessons.length)}%` }} />
          </div>
        )}
      </div>
      {state.outline.lessons.length > 0 && (
        <ol className="outline">
          {state.outline.lessons.map((o) => {
            const l = byOutline.get(o.id);
            if (l) return <LessonLink key={o.id} l={l} track={state.track.id} current={props.current === l.id} />;
            const isNext = o === nextItem;
            return (
              <li key={o.id} className={`outline-item planned ${isNext ? "next" : ""}`}>
                <span className="o-title">{o.title}</span>
                {isNext ? (
                  <button type="button" className="small-button primary" disabled={Boolean(running)} onClick={() => build({ outlineId: o.id })}>
                    Build lesson
                  </button>
                ) : (
                  <button type="button" className="link small" disabled={Boolean(running)} onClick={() => build({ outlineId: o.id })} title={o.objective}>
                    Build
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {extra.length > 0 && (
        <>
          <h3 className="small nav-sub">Extra practice</h3>
          <ol className="outline">
            {extra.map((l) => (
              <LessonLink key={l.id} l={l} track={state.track.id} current={props.current === l.id} />
            ))}
          </ol>
        </>
      )}
      <form
        className="practice-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!topic.trim()) return;
          void build({ topic });
          setTopic("");
        }}
      >
        <label className="small" htmlFor="topic">
          Practise something specific
        </label>
        <div className="row">
          <input id="topic" value={topic} placeholder="A topic, an error you hit, an interview question…" onChange={(e) => setTopic(e.target.value)} />
          <button type="submit" disabled={Boolean(running) || !topic.trim()}>
            Build
          </button>
        </div>
        {!state.outline.lessons.length && (
          <button type="button" className="link small" disabled={Boolean(running)} onClick={() => build({})}>
            Or build a lesson from my level and goals
          </button>
        )}
      </form>
      {running && <p className="small muted">{running.title}… (see the bar above)</p>}
      {error && <p className="error small">{error}</p>}
    </nav>
  );
}

function LessonLink(props: { l: LessonSummary; track: string; current: boolean }) {
  const { l } = props;
  const status = l.status === "passed" ? "passed" : l.lastPassed === false ? "failed" : "unchecked";
  return (
    <li className={`outline-item ${props.current ? "current" : ""}`}>
      <a href={href({ page: "track", track: props.track, view: "learn", lesson: l.id })} aria-current={props.current ? "page" : undefined}>
        <StatusIcon status={status} />
        <span className="o-title">{l.title}</span>
        {l.status === "new" && <span className="pill">new</span>}
      </a>
    </li>
  );
}

function NoLessons(props: { state: TrackState; onJob: (j: Job) => void }) {
  const [error, setError] = useState<string>();
  const running = props.state.jobs.find((j) => j.state === "running");
  const hasPlan = props.state.outline.lessons.length > 0;
  return (
    <div className="no-lessons">
      <h2>{hasPlan ? "Ready for your first lesson" : running ? "Working on it…" : "No plan yet"}</h2>
      {running ? (
        <p className="muted">{running.title}. Progress shows in the bar above; it usually takes one to three minutes.</p>
      ) : hasPlan ? (
        <>
          <p>
            Your plan has {props.state.outline.lessons.length} lessons. The first is <strong>{props.state.outline.lessons[0]!.title}</strong>: {props.state.outline.lessons[0]!.objective}
          </p>
          <button type="button" className="primary" onClick={() => api.lessonJob(props.state.track.id, {}).then(props.onJob, (e) => setError(e.message))}>
            Build the first lesson
          </button>
        </>
      ) : (
        <>
          <p>Write a plan first, so lessons build on each other, or jump straight into a lesson sized to your level.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => api.planJob(props.state.track.id, {}).then(props.onJob, (e) => setError(e.message))}>
              Write my plan
            </button>
            <button type="button" onClick={() => api.lessonJob(props.state.track.id, {}).then(props.onJob, (e) => setError(e.message))}>
              Give me a lesson now
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- workbench ----------

export type WorkbenchHandle = { vars: () => PromptVars; saveAll: () => Promise<void> };

type FileState = { content: string; saved: string; loaded: boolean };

const startedKey = "study-coach:started-lessons";

function failingText(checks: Checks | undefined): string {
  if (!checks || checks.passed) return "";
  const bad = checks.results.find((r) => r.exitCode !== 0) ?? checks.results.at(-1);
  if (!bad) return "";
  const lines = bad.output.split("\n").filter((l) => l.trim());
  return `$ ${bad.command}\n${lines.slice(0, 40).join("\n")}`.slice(0, 3000);
}


const Workbench = forwardRef<
  WorkbenchHandle,
  {
    state: TrackState;
    lesson: { meta: LessonMeta; files: LessonFile[]; help: Help };
    graded: boolean;
    runnerOk: boolean;
    runnerDetail: string | undefined;
    sandboxed: boolean;
    onMeta: (m: LessonMeta) => void;
    onDeleted: () => Promise<void>;
    refresh: () => Promise<void>;
    askCoach: () => void;
  }
>(function Workbench(props, ref) {
  const { meta, files } = props.lesson;
  const track = props.state.track.id;
  const firstEditable = files.find((f) => f.editable)?.path;
  const [tab, setTab] = useState<string>(() => (meta.status === "new" || !firstEditable ? "brief" : load(`study-coach:tab:${track}:${meta.id}`, firstEditable)));
  const [contents, setContents] = useState<Record<string, FileState>>({});
  const [checks, setChecks] = useState<Checks | undefined>(meta.lastChecks);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();
  const [hints, setHints] = useState(0);
  const [solution, setSolution] = useState<{ path: string; content: string }[]>();
  const [outputOpen, setOutputOpen] = useState(Boolean(meta.lastChecks && !meta.lastChecks.passed));
  const selection = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;

  // Load every file once; tests are small, and the coach needs them all.
  useEffect(() => {
    let alive = true;
    for (const f of files) {
      api.readFile(track, meta.id, f.path).then(
        ({ content }) => alive && setContents((c) => ({ ...c, [f.path]: c[f.path]?.loaded ? c[f.path]! : { content, saved: content, loaded: true } })),
        (e) => alive && setError(e.message),
      );
    }
    return () => {
      alive = false;
    };
  }, [files, track, meta.id]);

  // First visit to a new lesson: offer (or send) the lesson-start prompts.
  useEffect(() => {
    const seen = load<string[]>(startedKey, []);
    const id = `${track}/${meta.id}`;
    if (meta.status !== "new" || seen.includes(id)) return;
    save(startedKey, [...seen, id].slice(-500));
    const t = setTimeout(() => fireTrigger("lesson-start"), 300);
    return () => clearTimeout(t);
  }, [track, meta.id, meta.status]);

  const saveFile = async (path: string) => {
    const f = contentsRef.current[path];
    if (!f || f.content === f.saved) return;
    setSaving("saving");
    try {
      await api.writeFile(track, meta.id, path, f.content);
      setContents((c) => ({ ...c, [path]: { ...c[path]!, saved: f.content } }));
      setSaving("saved");
    } catch (e) {
      setSaving("error");
      setError((e as Error).message);
      throw e;
    }
  };
  const saveAll = async () => {
    clearTimeout(timer.current);
    for (const f of files) if (f.editable) await saveFile(f.path);
  };

  useImperativeHandle(ref, () => ({
    vars: () => ({ file: tab === "brief" ? "" : tab, selection: selection.current, failing: failingText(checks) }),
    saveAll,
  }));

  const edit = (path: string, value: string) => {
    setContents((c) => ({ ...c, [path]: { ...c[path]!, content: value } }));
    setSaving("idle");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveFile(path).catch(() => {}), 1200);
  };

  const run = async () => {
    if (running) return;
    setError(undefined);
    if (props.graded) {
      await saveAll();
      fireTrigger("grade");
      props.askCoach();
      return;
    }
    setRunning(true);
    try {
      await saveAll();
      const r = await api.check(track, meta.id);
      setChecks(r.checks);
      props.onMeta(r.meta);
      setOutputOpen(!r.checks.passed);
      const vars = { failing: failingText(r.checks), file: tab === "brief" ? "" : tab };
      if (r.checks.passed) {
        if (r.firstPass) fireTrigger("check-pass", vars);
      } else if ((r.meta.failStreak ?? 0) >= 3 && (r.meta.failStreak ?? 0) % 3 === 0) fireTrigger("stuck", vars);
      else fireTrigger("check-fail", vars);
      void props.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const reset = async (path: string) => {
    try {
      const { content } = await api.starter(track, meta.id, path);
      edit(path, content);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selectTab = (t: string) => {
    setTab(t);
    if (t !== "brief") save(`study-coach:tab:${track}:${meta.id}`, t);
  };

  const dirty = files.some((f) => contents[f.path] && contents[f.path]!.content !== contents[f.path]!.saved);
  const current = tab === "brief" ? undefined : files.find((f) => f.path === tab);
  const summary = checks ? summarize(checks) : undefined;

  return (
    <article className="workbench" aria-label={meta.title}>
      <header className="lesson-head">
        <div>
          <h1>{meta.title}</h1>
          <p className="muted small">{meta.objective}</p>
        </div>
        <div className="lesson-badges">
          {meta.status === "passed" && <span className="pill pill-ok">done</span>}
          {!meta.verified && !props.graded && (
            <span className="pill pill-warn" title="The generated tests could not be confirmed against a reference solution. If a test looks wrong, ask the coach.">
              tests unverified
            </span>
          )}
          {props.lesson.help && props.lesson.help.turns > 0 && <span className="pill">help used: {props.lesson.help.highest}</span>}
          {meta.revealedAt && <span className="pill">solution viewed</span>}
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Lesson">
        <button type="button" role="tab" aria-selected={tab === "brief"} className={tab === "brief" ? "on" : ""} onClick={() => selectTab("brief")}>
          Brief
        </button>
        {files.map((f) => {
          const c = contents[f.path];
          const changed = c && c.content !== c.saved;
          return (
            <button key={f.path} type="button" role="tab" aria-selected={tab === f.path} className={tab === f.path ? "on" : ""} onClick={() => selectTab(f.path)}>
              {!f.editable && <LockIcon />} {f.path}
              {changed && <span className="dot" aria-label="unsaved" />}
            </button>
          );
        })}
      </div>

      <div className="tab-body">
        {tab === "brief" ? (
          <div className="brief">
            <Md className="md">{meta.brief}</Md>
            {meta.hints.length > 0 && (
              <section className="hints">
                <h3>Hints</h3>
                {meta.hints.slice(0, hints).map((h, i) => (
                  <p key={i} className="hint-card">
                    <strong>{i + 1}.</strong> {h}
                  </p>
                ))}
                {hints < meta.hints.length && (
                  <button type="button" onClick={() => setHints(hints + 1)}>
                    {hints ? "Next hint" : "Show a hint"} ({hints + 1} of {meta.hints.length})
                  </button>
                )}
              </section>
            )}
            {meta.sources.length > 0 && (
              <section className="sources">
                <h3>Reading</h3>
                <ul>
                  {meta.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                      {s.note && <span className="muted small"> — {s.note}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {firstEditable && (
              <p>
                <button type="button" className="primary" onClick={() => selectTab(firstEditable)}>
                  Start in {firstEditable}
                </button>
              </p>
            )}
            {solution && (
              <section className="solution">
                <h3>Reference solution</h3>
                {solution.map((f) => (
                  <div key={f.path}>
                    <p className="small muted">{f.path}</p>
                    <pre className="code-block">{f.content}</pre>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : current && contents[current.path]?.loaded ? (
          <Editor
            cacheKey={`${track}/${meta.id}/${current.path}`}
            path={current.path}
            value={contents[current.path]!.content}
            readOnly={!current.editable}
            label={`${current.path}${current.editable ? "" : " (read-only)"}`}
            onChange={(v) => edit(current.path, v)}
            onSave={() => void saveFile(current.path).catch(() => {})}
            onRun={() => void run()}
            onSelect={(t) => (selection.current = t)}
          />
        ) : (
          <p className="loading">Loading…</p>
        )}
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={() => void run()} disabled={running || (!props.graded && !props.runnerOk)} title={props.runnerOk ? undefined : props.runnerDetail}>
          {running ? "Running…" : props.graded ? "Submit for grading" : "Run checks"}
          {!running && <kbd>{RUN_KEY}</kbd>}
        </button>
        <span className="small muted save-state" aria-live="polite">
          {saving === "saving" ? "Saving…" : saving === "error" ? "Not saved" : dirty ? "Unsaved changes" : saving === "saved" ? "Saved" : ""}
        </span>
        {summary && (
          <button type="button" className={`check-summary ${checks!.passed ? "ok" : "bad"}`} aria-expanded={outputOpen} onClick={() => setOutputOpen(!outputOpen)}>
            <StatusIcon status={checks!.passed ? "passed" : "failed"} /> {summary}
          </button>
        )}
        <span className="spacer" />
        {current?.editable && (
          <ConfirmButton className="link small" question={`Reset ${current.path} to the starter code?`} confirmLabel="Reset" onConfirm={() => void reset(current.path)}>
            Reset file
          </ConfirmButton>
        )}
        {!solution && (
          <ConfirmButton
            className="link small"
            question="See the reference solution? It closes the attempt; try a hint or the coach first."
            confirmLabel="Show solution"
            onConfirm={() =>
              api.solution(track, meta.id).then(
                (r) => {
                  setSolution(r.files);
                  setTab("brief");
                },
                (e) => setError(e.message),
              )
            }
          >
            Solution
          </ConfirmButton>
        )}
        <ConfirmButton className="link small" question="Delete this lesson and your work in it?" confirmLabel="Delete" danger onConfirm={() => api.deleteLesson(track, meta.id).then(props.onDeleted, (e) => setError(e.message))}>
          Delete
        </ConfirmButton>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {!props.runnerOk && !props.graded && <p className="notice small">Checks can't run on this server: {props.runnerDetail}.</p>}
      {checks && outputOpen && (
        <section className="output" aria-label="Check output">
          {!checks.sandboxed && <p className="notice small">These checks ran without the sandbox.</p>}
          {checks.results.map((r, i) => (
            <div key={i} className={`result ${r.exitCode === 0 ? "ok" : "bad"}`}>
              <p className="cmd">
                <StatusIcon status={r.exitCode === 0 ? "passed" : "failed"} /> <code>{r.command}</code> <span className="muted small">{r.timedOut ? "timed out" : `${(r.durationMs / 1000).toFixed(1)}s`}</span>
              </p>
              {r.output.trim() && <pre>{r.output.trim()}</pre>}
            </div>
          ))}
        </section>
      )}
    </article>
  );
});
