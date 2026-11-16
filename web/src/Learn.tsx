import { createPortal } from "react-dom";
import { CommandPicker, closeOutside, type WorkspaceCommand } from "./CommandPicker.tsx";
import { PaneIcon } from "./PaneTools.tsx";
import { useHoverPane } from "./useHoverPane.ts";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { api, type Checks, type Help, type Job, type LessonFile, type LessonMeta, type LessonSummary, load, type Me, save, type TrackState } from "./api.ts";
import { go, href } from "./App.tsx";
import { Coach, fireTrigger, type PromptVars } from "./Coach.tsx";
import { type Caret, Editor, fileLanguage } from "./Editor.tsx";
import { summarize } from "./checks.ts";
import { PracticeResults, type PracticeOutcome } from "./PracticeResults.tsx";
import { Submissions } from "./Submissions.tsx";
import { Testcases, type CaseControls, type TestcasesHandle } from "./Testcases.tsx";
import { Md } from "./Md.tsx";
import { ConfirmButton, ConfirmDialogButton, LockIcon, RUN_KEY, PRACTICE_KEY, StatusIcon, tabKeys, useMedia } from "./ui.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { LanguageService, typedFile, type CodeProblem } from "./languageService.ts";
import { checkProblems, location as problemLocation } from "./problems.ts";

function usePanelSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const stored = load<number>(key, initial);
    return Number.isFinite(stored) ? Math.max(min, Math.min(max, stored)) : initial;
  });
  useEffect(() => save(key, size), [key, size]);
  return [size, setSize] as const;
}

type Pane = "reading" | "code" | "coach";
type WorkspaceLayout = "split" | "reading" | "code" | "results";

export function Learn(props: { me: Me; state: TrackState; lessonId: string | undefined; refresh: () => Promise<void>; onJob: (j: Job) => void }) {
  const { state } = props;
  const narrow = useMedia("(max-width: 980px)");
  const [pane, setPane] = useState<Pane>("code");
  const [layout, setLayout] = useState<WorkspaceLayout>("split");
  const [readingClosed, setReadingClosed] = useState(() => load("study-coach:reading-closed", false));
  const [readingFloating, setReadingFloating] = useState(() => load("study-coach:reading-floating", false));
  const [coachFloating, setCoachFloating] = useState(() => load("study-coach:coach-floating", false));
  const readingPeek = useHoverPane(!narrow && readingFloating && layout === "split");
  const coachPeek = useHoverPane(!narrow && coachFloating && layout === "split");
  useEffect(() => { save("study-coach:reading-closed", readingClosed); save("study-coach:reading-floating", readingFloating); save("study-coach:coach-floating", coachFloating); }, [readingClosed, readingFloating, coachFloating]);
  const layoutSelect = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const changeLayout = (next: WorkspaceLayout) => {
    if (next === layout) return;
    if (layout === "split") returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (next === "reading") setReadingClosed(false);
    setLayout(next);
    if (next === "split") requestAnimationFrame(() => {
      const target = returnFocus.current;
      (target?.isConnected && target.getClientRects().length ? target : document.querySelector<HTMLElement>('.appearance-menu > summary'))?.focus();
    });
  };
  const [lesson, setLesson] = useState<{ meta: LessonMeta; files: LessonFile[]; help: Help }>();
  const [error, setError] = useState<string>();
  const contextKey = `${state.track.id}/${props.lessonId ?? ""}`;
  const activeLesson = useRef(contextKey);
  activeLesson.current = contextKey;
  const workbench = useRef<WorkbenchHandle>(null);
  const problemList = useRef<HTMLDialogElement>(null);
  const [coachWidth, setCoachWidth] = usePanelSize("study-coach:coach-width", 400, 260, 600);
  const [coachClosed, setCoachClosed] = useState(() => load("study-coach:coach-closed", true));
  useEffect(() => save("study-coach:coach-closed", coachClosed), [coachClosed]);

  // Open the most recent unfinished lesson when none is chosen.
  useEffect(() => {
    if (props.lessonId || !state.lessons.length) return;
    const pick = state.lessons.find((l) => l.status !== "passed") ?? state.lessons.at(-1)!;
    location.replace(href({ page: "track", track: state.track.id, view: "learn", lesson: pick.id }));
  }, [props.lessonId, state.lessons, state.track.id]);

  const loadLesson = useCallback(async () => {
    if (activeLesson.current !== contextKey) return;
    if (!props.lessonId) return setLesson(undefined);
    try {
      const loaded = await api.lesson(state.track.id, props.lessonId);
      if (activeLesson.current !== contextKey) return;
      setLesson(loaded);
      setError(undefined);
    } catch (e) {
      if (activeLesson.current === contextKey) setError((e as Error).message);
    }
  }, [props.lessonId, state.track.id, contextKey]);
  useEffect(() => {
    setLesson(undefined);
    void loadLesson();
    if (props.lessonId && narrow) setPane("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLesson]);

  const runner = props.me.runners.find((r) => r.id === state.track.runner);
  const openCoach = () => { setLayout("split"); setCoachClosed(false); setPane("coach"); coachPeek.show(); };
  const placeReading = (floating: boolean) => { setReadingFloating(floating); setReadingClosed(false); if (floating) readingPeek.show(); };
  const placeCoach = (floating: boolean) => { setCoachFloating(floating); setCoachClosed(false); if (floating) coachPeek.show(); };
  const coachOpen = coachFloating && !narrow ? coachPeek.open : !coachClosed;

  const resetLayout = () => { setLayout("split"); setCoachWidth(400); setCoachClosed(true); setReadingClosed(false); setReadingFloating(false); setCoachFloating(false); setPane("code"); workbench.current?.resetLayout(); };
  const commands: WorkspaceCommand[] = [
    { id: "list", label: "Open problem list", run: () => problemList.current?.showModal() },
    ...(["split", "reading", "code", "results"] as const).map((id) => ({ id, label: id === "split" ? "Split layout" : `Focus ${id === "reading" ? "problem" : id}`, run: () => { changeLayout(id); setPane(id === "reading" ? "reading" : "code"); } })),
    { id: "reset", label: "Reset layout", run: resetLayout },
    { id: "coach", label: coachOpen ? "Collapse Coach" : "Expand Coach", run: () => coachOpen ? (coachFloating ? coachPeek.dismiss() : setCoachClosed(true)) : openCoach() },
    { id: "problem", label: (readingFloating ? !readingPeek.open : readingClosed) ? "Expand Problem" : "Collapse Problem", run: () => { setLayout("split"); if (readingFloating) readingPeek.open ? readingPeek.dismiss() : readingPeek.show(); else setReadingClosed(!readingClosed); setPane("reading"); } },
    { id: "float-problem", label: readingFloating ? "Inset Problem pane" : "Float Problem pane", run: () => { placeReading(!readingFloating); setLayout("split"); } },
    { id: "float-coach", label: coachFloating ? "Inset Coach pane" : "Float Coach pane", run: () => { placeCoach(!coachFloating); openCoach(); } },
    { id: "run", label: "Run code", detail: "Ungraded practice", run: () => workbench.current?.practice(), disabled: !lesson || runner?.graded === "coach" },
    { id: "submit", label: "Submit solution", run: () => workbench.current?.submit(), disabled: !lesson },
    ...state.lessons.map((l) => ({ id: `lesson-${l.id}`, label: l.title, detail: "Open lesson", run: () => go({ page: "track", track: state.track.id, view: "learn", lesson: l.id }) })),
  ];
  const menuTarget = document.getElementById("workspace-menu-controls");
  const commandTarget = document.getElementById("workspace-command-control");
  return (
    <div className={`learn ${narrow ? "narrow" : ""} layout-${layout}`} style={narrow ? undefined : { gridTemplateColumns: `minmax(0, 1fr) ${coachClosed || coachFloating || layout !== "split" ? "0 36px" : `6px minmax(260px, min(${coachWidth}px, 32%))`}` }}>
      {menuTarget && createPortal(<>
        <label>Layout<select ref={layoutSelect} aria-label="Layouts" value={layout} onChange={(e) => changeLayout(e.target.value as WorkspaceLayout)}>
          <option value="split">Split</option><option value="reading">Focus problem</option><option value="code">Focus Code</option><option value="results">Focus results</option>
        </select></label>
        <button type="button" className="small-button" onClick={resetLayout}>Reset layout</button>
      </>, menuTarget)}
      {commandTarget && createPortal(<CommandPicker commands={commands} />, commandTarget)}
      <div className="workspace-controls">
        <button type="button" className="pane-icon" title="Problem list" aria-label="Problem List" onClick={() => problemList.current?.showModal()} aria-haspopup="dialog"><PaneIcon name="list" /></button>
        {lesson && <div className="workspace-title"><h1>{lesson.meta.title}</h1><p>{lesson.meta.objective}</p></div>}
        <span className="spacer" />
        {lesson?.meta.status === "passed" && <span className="pill pill-ok">Done</span>}
      </div>
      <dialog ref={problemList} className="problem-list" aria-label="Problem List" onClick={closeOutside}>
        <div className="problem-list-head"><h2>Problem List</h2><button type="button" autoFocus onClick={() => problemList.current?.close()}>Close</button></div>
        <div onClick={(e) => { if ((e.target as HTMLElement).closest("a")) problemList.current?.close(); }}>
          <LessonNav state={state} current={props.lessonId} onJob={props.onJob} refresh={props.refresh} />
        </div>
      </dialog>
      {narrow && layout === "split" && (
        <div className="pane-switch" role="tablist" aria-label="Workspace panes">
          {(["reading", "code", "coach"] as const).map((p) => (
            <button key={p} type="button" role="tab" tabIndex={pane === p ? 0 : -1} aria-selected={pane === p} className={pane === p ? "on" : ""} onClick={() => setPane(p)} onKeyDown={(e) => tabKeys(e, ["reading", "code", "coach"], pane, setPane)}>
              {p === "reading" ? "Description" : p === "code" ? "Code" : "Coach"}
            </button>
          ))}
        </div>
      )}
      <div className="work" hidden={layout === "split" && narrow && pane === "coach"}>
        {error && <p className="error">{error}</p>}
        {!props.lessonId && !state.lessons.length && <NoLessons state={state} onJob={props.onJob} />}
        {lesson && (
          <Workbench
            ref={workbench}
            key={lesson.meta.id}
            state={state}
            lesson={lesson}
            graded={runner?.graded === "coach"}
            preview={Boolean(state.track.runner === "container" && state.track.environment?.preview)}
            runnerOk={runner?.ok ?? true}
            runnerDetail={runner?.detail}
            runtimeLabel={runner?.label ?? state.track.runner}
            sandboxed={props.me.sandbox.sandboxed}
            onMeta={(patch) => setLesson((l) => (activeLesson.current === contextKey && l?.meta.id === lesson.meta.id ? { ...l, meta: { ...l.meta, ...patch } } : l))}
            onFiles={(files) => setLesson((l) => (activeLesson.current === contextKey && l?.meta.id === lesson.meta.id ? { ...l, files } : l))}
            onDeleted={async () => {
              await props.refresh();
              go({ page: "track", track: state.track.id, view: "learn" });
            }}
            refresh={props.refresh}
            narrow={narrow}
            pane={pane}
            layout={layout}
            readingClosed={readingClosed} setReadingClosed={setReadingClosed}
            readingFloating={readingFloating} setReadingFloating={placeReading} readingPeek={readingPeek}
            changeLayout={changeLayout}
            showCode={() => { setLayout("split"); setPane("code"); }}
            askCoach={openCoach}
          />
        )}
      </div>
      {!narrow && (coachClosed || coachFloating || layout !== "split" ? <div /> : <ResizeHandle label="Resize coach panel" value={coachWidth} min={260} max={600} reverse onChange={setCoachWidth} />)}
      <div id="workspace-coach" className={`side-panel ${!narrow && coachFloating && layout === "split" ? "overlay-host" : ""}`} hidden={narrow && (layout !== "split" || pane !== "coach")}>
        {!narrow && (coachClosed || coachFloating || layout !== "split") && <button ref={coachPeek.trigger} {...coachPeek.events} className="panel-rail" type="button" aria-label="Expand coach panel" title={coachFloating ? "Hover to open Coach" : "Open Coach"} aria-controls="coach-content" aria-expanded={layout === "split" && coachOpen} onClick={openCoach}><PaneIcon name="collapse" /> Coach</button>}
        <div id="coach-content" ref={coachPeek.panelRef} {...coachPeek.events} className={`panel-content ${!narrow && coachFloating && layout === "split" ? "floating-pane floating-coach" : ""}`} style={!narrow && coachFloating && layout === "split" ? { width: `min(${coachWidth}px, calc(100vw - 72px))` } : undefined} hidden={!narrow && (layout !== "split" || (coachFloating ? !coachPeek.open : coachClosed))}>
        <Coach
          paneTools={!narrow ? <div className="coach-pane-tools"><button type="button" className="pane-icon" aria-label={coachFloating ? "Inset Coach pane" : "Float Coach pane"} title={coachFloating ? "Pin Coach inside the workspace" : "Open Coach over the workspace on rail hover"} onClick={() => placeCoach(!coachFloating)}><PaneIcon name={coachFloating ? "dock" : "float"} /></button><button type="button" className="pane-icon" aria-label="Collapse coach panel" title="Collapse Coach" onClick={() => coachFloating ? coachPeek.dismiss() : setCoachClosed(true)}><PaneIcon name="collapse" /></button></div> : undefined}
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
        </div>
      </div>
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

export type WorkbenchHandle = { vars: () => PromptVars; saveAll: () => Promise<void>; resetLayout: () => void; practice: () => void; submit: () => void };

type FileState = { content: string; saved: string; loaded: boolean; saving?: boolean; saveError?: string | undefined };

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
    preview: boolean;
    runnerOk: boolean;
    runnerDetail: string | undefined;
    runtimeLabel: string;
    sandboxed: boolean;
    onMeta: (m: Partial<LessonMeta>) => void;
    onFiles: (f: LessonFile[]) => void;
    onDeleted: () => Promise<void>;
    refresh: () => Promise<void>;
    askCoach: () => void;
    narrow: boolean;
    pane: Pane;
    layout: WorkspaceLayout;
    readingClosed: boolean; setReadingClosed: (closed: boolean) => void;
    readingFloating: boolean; setReadingFloating: (floating: boolean) => void;
    readingPeek: ReturnType<typeof useHoverPane>;
    changeLayout: (layout: WorkspaceLayout) => void;
    showCode: () => void;
  }
>(function Workbench(props, ref) {
  const { meta, files } = props.lesson;
  const track = props.state.track.id;
  const firstEditable = files.find((f) => f.editable)?.path;
  const [tab, setTab] = useState<string>(() => {
    const stored = load(`study-coach:tab:${track}:${meta.id}`, firstEditable ?? "");
    return files.some((f) => f.path === stored) ? stored : firstEditable ?? files[0]?.path ?? "";
  });
  const [descriptionWidth, setDescriptionWidth] = usePanelSize("study-coach:description-width", 380, 220, 640);
  const [contents, setContents] = useState<Record<string, FileState>>({});
  const [checks, setChecks] = useState<Checks | undefined>(meta.lastChecks);
  const [running, setRunning] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceState, setPracticeState] = useState<CaseControls>({ enabled: false, reason: "Loading practice inputs…", inputVersion: "" });
  const [practiceOutcome, setPracticeOutcome] = useState<PracticeOutcome>();
  const [practiceError, setPracticeError] = useState<string>();
  const casesRef = useRef<TestcasesHandle>(null);
  const execution = useRef<"practice" | "submit" | undefined>(undefined);
  const [caret, setCaret] = useState<Caret>();
  const saves = useRef(new Map<string, Promise<void>>());
  const [error, setError] = useState<string>();
  const [hints, setHints] = useState(0);
  const [readingTab, setReadingTab] = useState<"description" | "hints" | "solution" | "submissions">("description");
  const [revealing, setRevealing] = useState(false);
  const [solution, setSolution] = useState<{ path: string; content: string }[]>();
  const [outputOpen, setOutputOpen] = useState(Boolean(meta.practice || (meta.lastChecks && !meta.lastChecks.passed)));
  const [resultTab, setResultTab] = useState<"cases" | "result" | "problems" | "output">(meta.practice ? "cases" : "problems");
  const [resultHeight, setResultHeight] = usePanelSize("study-coach:results-height", 260, 90, 500);
  const [gotoLine, setGotoLine] = useState<{ line: number; column: number; at: number }>();
  const [checksStale, setChecksStale] = useState(false);
  const [typedProblems, setTypedProblems] = useState<CodeProblem[]>([]);
  const [localProblems, setLocalProblems] = useState<Record<string, CodeProblem[]>>({});
  const [assistanceError, setAssistanceError] = useState<string>();
  const [service] = useState(() => new LanguageService());
  const sync = useRef<{ signature: string; promise: Promise<CodeProblem[]> } | undefined>(undefined);
  const [preview, setPreview] = useState<{ html?: string; output?: string; building: boolean; stale: boolean }>({ building: false, stale: true });
  const [adding, setAdding] = useState<string>();
  const [extraFiles, setExtraFiles] = useState<LessonFile[]>([]);
  const allFiles = [...files, ...extraFiles.filter((x) => !files.some((f) => f.path === x.path))];
  const selection = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const codeRevision = useRef(0);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const updateContents = (update: (c: Record<string, FileState>) => Record<string, FileState>) => {
    const prior = contentsRef.current;
    const next = update(prior);
    if (Object.keys(prior).length !== Object.keys(next).length || Object.entries(next).some(([path, f]) => f.content !== prior[path]?.content)) codeRevision.current++;
    contentsRef.current = next;
    setContents(next);
  };
  const sourceFiles = useMemo(() => Object.entries(contents).filter(([, f]) => f.loaded).map(([path, f]) => ({ path, content: f.content })), [contents]);
  const prepareLanguage = useCallback((path?: string, content?: string) => {
    const sources = Object.entries(contentsRef.current).filter(([p, f]) => f.loaded && typedFile(p)).map(([p, f]) => ({ path: p, content: path === p && content !== undefined ? content : f.content }));
    const signature = JSON.stringify(sources);
    if (sync.current?.signature === signature) return sync.current.promise;
    const promise = service.sync(sources);
    sync.current = { signature, promise };
    void promise.then((problems) => {
      if (sync.current?.signature === signature) { setTypedProblems(problems); setAssistanceError(undefined); }
    }, (error: Error) => {
      if (sync.current?.signature === signature) { setTypedProblems([]); setAssistanceError(error.message); sync.current = undefined; }
    });
    return promise;
  }, [service]);
  useEffect(() => () => service.dispose(), [service]);
  useEffect(() => {
    if (!sourceFiles.some((f) => typedFile(f.path))) return;
    const timer = setTimeout(() => { void prepareLanguage().catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [sourceFiles, prepareLanguage]);
  const reportDiagnostics = useCallback((path: string, problems: CodeProblem[]) => {
    setLocalProblems((old) => JSON.stringify(old[path]) === JSON.stringify(problems) ? old : { ...old, [path]: problems });
  }, []);
  const problems = useMemo(() => [
    ...typedProblems,
    ...Object.entries(localProblems).filter(([path]) => sourceFiles.some((f) => f.path === path)).flatMap(([, list]) => list),
    ...checkProblems(checksStale ? undefined : checks, sourceFiles),
  ], [typedProblems, localProblems, checks, checksStale, sourceFiles]);
  const editorProblems = useMemo(() => problems.filter((p) => p.path === tab && p.source !== "Syntax" && !p.source.startsWith("json")), [problems, tab]);

  // Load every file once; tests are small, and the coach needs them all.
  useEffect(() => {
    let alive = true;
    for (const f of allFiles) {
      if (contentsRef.current[f.path]?.loaded) continue;
      api.readFile(track, meta.id, f.path).then(
        ({ content }) => alive && updateContents((c) => ({ ...c, [f.path]: c[f.path]?.loaded ? c[f.path]! : { content, saved: content, loaded: true } })),
        (e) => alive && setError(e.message),
      );
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, extraFiles, track, meta.id]);

  // First visit to a new lesson: offer (or send) the lesson-start prompts.
  useEffect(() => {
    const seen = load<string[]>(startedKey, []);
    const id = `${track}/${meta.id}`;
    if (meta.status !== "new" || seen.includes(id)) return;
    save(startedKey, [...seen, id].slice(-500));
    const t = setTimeout(() => fireTrigger("lesson-start"), 300);
    return () => clearTimeout(t);
  }, [track, meta.id, meta.status]);

  const saveFile = async (path: string): Promise<void> => {
    // Serialize writes per file; an older response must not overwrite a newer save.
    const pending = saves.current.get(path);
    if (pending) { await pending; return saveFile(path); }
    const f = contentsRef.current[path];
    if (!f || f.content === f.saved) return;
    updateContents((c) => ({ ...c, [path]: { ...c[path]!, saving: true, saveError: undefined } }));
    const request = (async () => {
      try {
        await api.writeFile(track, meta.id, path, f.content);
        updateContents((c) => ({ ...c, [path]: { ...c[path]!, saved: f.content, saving: false } }));
      } catch (e) {
        const message = (e as Error).message;
        updateContents((c) => ({ ...c, [path]: { ...c[path]!, saving: false, saveError: message } }));
        throw e;
      } finally {
        saves.current.delete(path);
      }
    })();
    saves.current.set(path, request);
    return request;
  };
  const saveAll = async () => {
    clearTimeout(timer.current);
    for (const f of allFiles) if (f.editable) await saveFile(f.path);
  };

  useImperativeHandle(ref, () => ({
    vars: () => ({ file: tab === "preview" ? "" : tab, selection: selection.current, failing: failingText(checks) }),
    saveAll,
    practice: () => practice(), submit: () => { void run(); },
    resetLayout: () => { setDescriptionWidth(380); setResultHeight(260); setOutputOpen(false); },
  }));

  const edit = (path: string, value: string) => {
    sync.current = undefined;
    setChecksStale(true);
    setTypedProblems([]);
    setLocalProblems((old) => { const next = { ...old }; delete next[path]; return next; });
    setPreview((p) => ({ ...p, stale: true }));
    updateContents((c) => ({ ...c, [path]: { ...c[path]!, content: value, saveError: undefined } }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void Promise.allSettled(allFiles.filter((f) => f.editable).map((f) => saveFile(f.path)));
    }, 1200);
  };

  const [testRun, setTestRun] = useState<Checks>();
  const [testRunRevision, setTestRunRevision] = useState<number>();
  const practice = () => {
    if (meta.practice) { casesRef.current?.run(); return; }
    if (execution.current || props.graded || !props.runnerOk) return;
    execution.current = "practice";
    setError(undefined); setPracticeBusy(true); setPracticeError(undefined); setTestRun(undefined); setOutputOpen(true); setResultTab("result"); props.showCode();
    void (async () => {
      try {
        await saveAll();
        if (allFiles.some((f) => f.editable && contentsRef.current[f.path]?.content !== contentsRef.current[f.path]?.saved)) throw new Error("Code changed while saving. Run again to use your latest edits.");
        const revision = codeRevision.current;
        const result = await api.tryChecks(track, meta.id);
        setTestRun(result.checks); setTestRunRevision(revision);
      } catch (e) { setPracticeError((e as Error).message); }
      finally { execution.current = undefined; setPracticeBusy(false); }
    })();
  };

  const run = async () => {
    if (execution.current || (!props.graded && !props.runnerOk)) return;
    execution.current = "submit";
    setRunning(true);
    setError(undefined);
    try {
      await saveAll();
      if (props.graded) {
        fireTrigger("grade");
        props.askCoach();
        return;
      }
      const checkedRevision = codeRevision.current;
      const r = await api.check(track, meta.id);
      setChecks(r.checks);
      setChecksStale(checkedRevision !== codeRevision.current);
      props.onMeta(r.meta);
      setOutputOpen(!r.checks.passed);
      if (!r.checks.passed) setResultTab("problems");
      const vars = { failing: failingText(r.checks), file: tab === "preview" ? "" : tab };
      if (r.checks.passed) {
        if (r.firstPass) fireTrigger("check-pass", vars);
      } else if ((r.meta.failStreak ?? 0) >= 3 && (r.meta.failStreak ?? 0) % 3 === 0) fireTrigger("stuck", vars);
      else fireTrigger("check-fail", vars);
      void props.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { execution.current = undefined; setRunning(false); }
  };

  const reset = async (path: string) => {
    try {
      const { content } = await api.starter(track, meta.id, path);
      edit(path, content);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const buildPreview = async () => {
    setPreview((p) => ({ ...p, building: true }));
    try {
      await saveAll();
      const r = await api.preview(track, meta.id);
      setPreview({ ...(r.html !== undefined ? { html: r.html } : {}), building: false, stale: false, ...(r.html === undefined || r.result.exitCode !== 0 ? { output: r.result.output } : {}) });
    } catch (e) {
      setPreview((p) => ({ ...p, building: false, output: (e as Error).message }));
    }
  };

  const selectTab = (t: string) => {
    setGotoLine(undefined);
    setTab(t);
    if (t !== tab) setCaret(undefined);
    if (t !== "preview") save(`study-coach:tab:${track}:${meta.id}`, t);
    if (t === "preview" && preview.stale && !preview.building) void buildPreview();
  };

  const addFile = async (path: string) => {
    setError(undefined);
    try {
      await api.newFile(track, meta.id, path);
      setChecksStale(true);
      setExtraFiles((x) => [...x, { path, editable: true, role: "starter", added: true }]);
      updateContents((c) => ({ ...c, [path]: { content: "", saved: "", loaded: true } }));
      setAdding(undefined);
      selectTab(path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeFile = async (path: string) => {
    try {
      await api.deleteFile(track, meta.id, path);
      setChecksStale(true);
      setExtraFiles((x) => x.filter((f) => f.path !== path));
      updateContents((c) => {
        const { [path]: _gone, ...rest } = c;
        return rest;
      });
      void props.refresh();
      selectTab(firstEditable === path ? files.find((f) => f.path !== path)?.path ?? "" : firstEditable ?? "");
      // The lesson's file list comes from the server; reload it so the tab disappears.
      const fresh = await api.lesson(track, meta.id);
      props.onFiles(fresh.files);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const dirty = allFiles.some((f) => contents[f.path] && contents[f.path]!.content !== contents[f.path]!.saved);
  const current = tab === "preview" ? undefined : allFiles.find((f) => f.path === tab);
  const saving = Object.values(contents).some((f) => f.saving);
  const saveError = allFiles.find((f) => contents[f.path]?.saveError);
  const saveStatus = saving ? "Saving…" : saveError ? `Save failed: ${saveError.path}` : dirty ? "Unsaved changes" : current && contents[current.path]?.loaded ? "Saved" : "";
  const runtime = props.state.track.runner === "container" ? props.state.track.environment?.image ?? "Container" :
    ["typescript", "javascript"].includes(props.state.track.runner) ? "Node 24" : props.state.track.runner === "written" ? "Coach grading" :
    props.state.track.runner === "custom" ? "Custom command" : props.runtimeLabel;
  const summary = checks ? summarize(checks) : undefined;
  const jumpToProblem = (problem: CodeProblem) => {
    const file = sourceFiles.find((f) => f.path === problem.path);
    if (!file) { setResultTab("output"); return; }
    selectTab(file.path);
    props.showCode();
    setGotoLine({ ...problemLocation(file.content, problem.from), at: Date.now() });
  };

  return (
    <article className="workbench" aria-label={meta.title}>
      <div className={`workbench-panes layout-${props.layout}`} style={props.narrow ? undefined : { gridTemplateColumns: props.layout === "split" ? `${props.readingClosed || props.readingFloating ? "36px 0" : `minmax(220px, min(${descriptionWidth}px, 45%)) 6px`} minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
        {!props.narrow && props.layout === "split" && (props.readingClosed || props.readingFloating) && <button ref={props.readingPeek.trigger} {...props.readingPeek.events} type="button" className="panel-rail problem-rail" title={props.readingFloating ? "Hover to open Problem" : "Open Problem"} aria-label="Expand problem panel" aria-controls="workspace-problem" aria-expanded={props.readingFloating && props.readingPeek.open} onClick={() => props.readingFloating ? props.readingPeek.show() : props.setReadingClosed(false)}><PaneIcon name="collapse" /> Problem</button>}
        <section id="workspace-problem" ref={props.readingPeek.panelRef} {...props.readingPeek.events} className={`reading-pane ${!props.narrow && props.readingFloating && props.layout === "split" ? "floating-pane floating-problem" : ""}`} style={!props.narrow && props.readingFloating && props.layout === "split" ? { width: `min(${descriptionWidth}px, calc(100% - 36px))` } : undefined} aria-label="Lesson reference" hidden={props.layout !== "reading" && (props.layout !== "split" || (props.narrow ? props.pane !== "reading" : props.readingFloating ? !props.readingPeek.open : props.readingClosed))}>
          <div className="pane-controls"><span className="small muted">Problem</span><span className="spacer" />
            {!props.narrow && <button type="button" className="pane-icon" aria-label={props.readingFloating ? "Inset Problem pane" : "Float Problem pane"} title={props.readingFloating ? "Pin Problem inside the workspace" : "Open Problem over the workspace on rail hover"} onClick={() => props.setReadingFloating(!props.readingFloating)}><PaneIcon name={props.readingFloating ? "dock" : "float"} /></button>}
            <button type="button" className="pane-icon" title="Focus problem" aria-label={props.layout === "reading" ? "Restore split layout" : "Maximize reading pane"} onClick={() => props.changeLayout(props.layout === "reading" ? "split" : "reading")}><PaneIcon name={props.layout === "reading" ? "restore" : "expand"} /></button>
            {!props.narrow && <button type="button" className="pane-icon" aria-label="Collapse problem panel" title="Collapse problem" onClick={() => { if (props.readingFloating) props.readingPeek.dismiss(); else props.setReadingClosed(true); props.changeLayout("split"); }}><PaneIcon name="collapse" /></button>}
          </div>
          <div className="lesson-badges">
            {!meta.verified && !props.graded && <span className="pill pill-warn" title="The generated tests could not be confirmed against a reference solution. If a test looks wrong, ask the coach.">tests unverified</span>}
            {props.lesson.help && props.lesson.help.turns > 0 && <span className="pill">help used: {props.lesson.help.highest}</span>}
            {meta.revealedAt && <span className="pill">solution viewed</span>}
          </div>
          <div className="reference-tabs" role="tablist" aria-label="Lesson reference">
            {(["description", "hints", "solution", "submissions"] as const).map((id) => <button key={id} id={`reading-${id}-tab`} type="button" role="tab" tabIndex={readingTab === id ? 0 : -1} aria-selected={readingTab === id} aria-controls={`reading-${id}`} onClick={() => setReadingTab(id)} onKeyDown={(e) => tabKeys(e, ["description", "hints", "solution", "submissions"], readingTab, setReadingTab)}>{id === "description" ? "Description" : id === "hints" ? "Hints" : id === "solution" ? "Reference solution" : "Submissions"}</button>)}
          </div>
          <div id="reading-description" role="tabpanel" tabIndex={0} aria-labelledby="reading-description-tab" className="brief" hidden={readingTab !== "description"}>
            <Md className="md">{meta.brief}</Md>
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
                <button type="button" className="primary" onClick={() => { selectTab(firstEditable); props.showCode(); }}>
                  Start in {firstEditable}
                </button>
              </p>
            )}
          </div>
          <div id="reading-hints" role="tabpanel" tabIndex={0} aria-labelledby="reading-hints-tab" className="brief" hidden={readingTab !== "hints"}>
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
            {!meta.hints.length && <p className="muted">No hints were supplied for this lesson. You can ask the coach for help within your help limit.</p>}
          </div>
          <div id="reading-solution" role="tabpanel" tabIndex={0} aria-labelledby="reading-solution-tab" className="brief" hidden={readingTab !== "solution"}>
            <h3>Reference solution</h3>
            {meta.revealedAt && <p className="notice small">Reference solution already revealed for this attempt.</p>}
            {!solution && <>
              <p>The reference stays hidden until you confirm. Viewing it closes the attempt; try a hint or the coach first.</p>
              <ConfirmButton
                question="See the reference solution? It closes the attempt; try a hint or the coach first."
                confirmLabel="Show solution"
                disabled={revealing}
                onConfirm={() => {
                  setRevealing(true);
                  void api.solution(track, meta.id).then(
                    (r) => { setSolution(r.files); props.onMeta({ revealedAt: r.revealedAt }); },
                    (e) => setError(e.message),
                  ).finally(() => setRevealing(false));
                }}
              >{revealing ? "Loading solution…" : meta.revealedAt ? "Load revealed solution" : "Reveal reference solution"}</ConfirmButton>
            </>}
            {solution?.map((f) => <div key={f.path}><p className="small muted">{f.path}</p><pre className="code-block">{f.content}</pre></div>)}
          </div>
          <div id="reading-submissions" role="tabpanel" tabIndex={0} aria-labelledby="reading-submissions-tab" className="brief" hidden={readingTab !== "submissions"}>
            {readingTab === "submissions" && <Submissions track={track} lesson={meta.id} attempts={meta.attempts} latest={meta.lastChecks} graded={props.graded} />}
          </div>
        </section>
        {!props.narrow && props.layout === "split" && (props.readingClosed || props.readingFloating ? <div /> : <ResizeHandle label="Resize description panel" value={descriptionWidth} min={220} max={640} onChange={setDescriptionWidth} />)}
        <section className="code-pane" aria-label="Code" hidden={props.layout === "reading" || (props.layout === "split" && props.narrow && props.pane !== "code")}>
          <div className="editor-toolbar" hidden={props.layout === "results"}>
            <h2 className="code-heading">Code</h2>
            <button type="button" className="pane-icon" title="Focus code" aria-label={props.layout === "code" ? "Restore split layout" : "Maximize Code pane"} onClick={() => props.changeLayout(props.layout === "code" ? "split" : "code")}><PaneIcon name={props.layout === "code" ? "restore" : "expand"} /></button>
            {current && <><span className="active-file">{current.path}</span><span className="file-language muted">{fileLanguage(current.path)}</span></>}
            <span className="small muted">Checks: {runtime}</span>
            {current && !current.editable && <span className="pill">Read-only</span>}
            <span className="spacer" />
            {current?.added && <ConfirmDialogButton label="Delete file" question={`Delete ${current.path}?`} confirmLabel="Delete file" disabled={running || practiceBusy} onConfirm={() => void removeFile(current.path)}><PaneIcon name="delete" /></ConfirmDialogButton>}
            {current?.editable && !current.added && <ConfirmDialogButton label="Reset file" question={`Reset ${current.path} to the starter code? Your edits will be lost.`} confirmLabel="Reset file" disabled={running || practiceBusy} onConfirm={() => void reset(current.path)}><PaneIcon name="reset" /></ConfirmDialogButton>}
            <ConfirmDialogButton label="Delete lesson" question="Delete this lesson and your work in it?" confirmLabel="Delete lesson" disabled={running || practiceBusy} onConfirm={() => api.deleteLesson(track, meta.id).then(props.onDeleted, (e) => setError(e.message))}><PaneIcon name="delete" /></ConfirmDialogButton>
            <details className="keyboard-help">
              <summary>Keyboard help</summary>
              <p id="editor-help">Ctrl/Cmd+S saves the active file. Ctrl/Cmd+Enter {props.graded ? "submits for coach grading" : "submits canonical checks"}. Ctrl/Cmd+Shift+Enter runs all practice cases when available. Ctrl+Space opens completion; Enter accepts. Ctrl/Cmd+D selects the next matching word; Alt-drag selects a rectangle. Tab indents and Shift+Tab unindents. Press Escape, then Tab to leave the editor. Ctrl+M (Option+Shift+M on macOS) toggles Tab focus mode. Hover over a symbol for documentation.</p>
            </details>
            {!props.graded && <button type="button" className="small-button run-button" aria-label="Run" title={meta.practice ? practiceState.reason || `Run practice cases (${PRACTICE_KEY})` : `Run lesson tests without grading (${PRACTICE_KEY})`} onClick={practice} disabled={running || practiceBusy || (meta.practice ? !practiceState.enabled : !props.runnerOk)}><PaneIcon name="run" />{practiceBusy ? "Running…" : "Run"}</button>}
          </div>
          <div className="tabs" role="tablist" aria-label="Lesson" hidden={props.layout === "results"}>
            {allFiles.map((f) => {
              const c = contents[f.path];
              const changed = c && c.content !== c.saved;
              return (
                <button key={f.path} type="button" role="tab" aria-selected={tab === f.path} className={tab === f.path ? "on" : ""} onClick={() => selectTab(f.path)}>
                  {!f.editable && <LockIcon />} {f.path}
                  {changed && <span className="dot" aria-label="unsaved" />}
                </button>
              );
            })}
            {props.preview && (
              <button type="button" role="tab" aria-selected={tab === "preview"} className={`preview-tab ${tab === "preview" ? "on" : ""}`} onClick={() => selectTab("preview")}>
                Preview
              </button>
            )}
            {adding === undefined ? (
              <button type="button" className="add-file" aria-label="Add a file" title="Add a file" onClick={() => setAdding("")}>
                +
              </button>
            ) : (
              <form
                className="add-file-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (adding.trim()) void addFile(adding.trim());
                }}
              >
                <input autoFocus value={adding} placeholder="src/new-file.ts" aria-label="New file path" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(undefined)} />
                <button type="submit" className="small-button">
                  Add
                </button>
              </form>
            )}
          </div>

          <div className="tab-body" hidden={props.layout === "results"}>
            {tab === "preview" ? (
              <div className="preview">
                <div className="preview-bar">
                  <button type="button" onClick={() => void buildPreview()} disabled={preview.building}>
                    {preview.building ? "Building…" : preview.html ? "Rebuild" : "Build preview"}
                  </button>
                  <span className="small muted">{preview.building ? "Building in the lesson's container…" : preview.stale && preview.html ? "Your code changed since this build." : "Runs in an isolated frame: it can't reach this app or your session."}</span>
                </div>
                {preview.output && <pre className="preview-output">{preview.output.trim().slice(-4000)}</pre>}
                {preview.html !== undefined && (
                  <iframe title={`Preview of ${meta.title}`} className="preview-frame" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock" srcDoc={preview.html} />
                )}
              </div>
            ) : current && contents[current.path]?.loaded ? (
              <Editor
                cacheKey={`${track}/${meta.id}/${current.path}`}
                path={current.path}
                value={contents[current.path]!.content}
                readOnly={!current.editable}
                label={`${current.path}${current.editable ? "" : " (read-only)"}`}
                files={sourceFiles}
                service={service}
                ready={prepareLanguage}
                problems={editorProblems}
                onDiagnostics={reportDiagnostics}
                gotoLine={gotoLine}
                onChange={(v) => edit(current.path, v)}
                onSave={() => void saveFile(current.path).catch(() => {})}
                onRun={() => void run()}
                onPractice={practice}
                onSelect={(t) => (selection.current = t)}
                onCaret={setCaret}
              />
            ) : (
              <p className="loading">Loading…</p>
            )}
          </div>

          <div className="editor-status small" hidden={props.layout === "results"}>
            <span className="save-state" role="status">{saveStatus}</span>
            <span className="spacer" />
            {current && caret && <span className="caret-status" aria-label="Caret position">Ln {caret.line}, Col {caret.column}{caret.cursors > 1 ? ` · ${caret.cursors} cursors` : ""}</span>}
          </div>
          {saveError && <p className="error small" role="alert" hidden={props.layout === "results"}>{contents[saveError.path]?.saveError} — Ctrl/Cmd+S retries the active file; Run and Submit save all files first.</p>}
          <div className="results-toolbar" role="tablist" aria-label="Results" hidden={props.layout === "code"}>
            <button type="button" role="tab" aria-selected={resultTab === "cases" && (outputOpen || props.layout === "results")} aria-controls="lesson-cases" onClick={() => { setResultTab("cases"); if (props.layout !== "results") setOutputOpen(true); }}>Testcases</button>
            <button type="button" role="tab" aria-selected={resultTab === "result" && (outputOpen || props.layout === "results")} aria-controls="lesson-practice-result" onClick={() => { setResultTab("result"); if (props.layout !== "results") setOutputOpen(true); }}>Test Result</button>
            <button type="button" role="tab" aria-selected={resultTab === "problems" && (outputOpen || props.layout === "results")} aria-controls="lesson-problems" onClick={() => { setResultTab("problems"); if (props.layout !== "results") setOutputOpen(true); }}>Problems ({problems.length})</button>
            <button type="button" role="tab" aria-selected={resultTab === "output" && (outputOpen || props.layout === "results")} aria-controls="lesson-output" onClick={() => { setResultTab("output"); if (props.layout !== "results") setOutputOpen(true); }}>Check output</button>
            <span className="spacer" />
            <button type="button" className="pane-icon" title="Focus results" aria-label={props.layout === "results" ? "Restore split layout" : "Maximize results pane"} onClick={() => props.changeLayout(props.layout === "results" ? "split" : "results")}><PaneIcon name={props.layout === "results" ? "restore" : "expand"} /></button>
            <button type="button" className="pane-icon" hidden={props.layout === "results"} aria-label={outputOpen ? "Collapse results panel" : "Expand results panel"} aria-expanded={outputOpen} onClick={() => setOutputOpen(!outputOpen)}><span style={{ display: "inline-flex", transform: outputOpen ? "rotate(-90deg)" : "rotate(90deg)" }}><PaneIcon name="collapse" /></span></button>
          </div>
          <section className={`results-panel ${props.layout === "results" ? "maximized" : ""}`} hidden={props.layout === "code" || (!outputOpen && props.layout !== "results")} style={props.layout === "results" ? undefined : { height: resultHeight }} aria-label="Results panel">
            {props.layout !== "results" && outputOpen && <ResizeHandle label="Resize results panel" value={resultHeight} min={90} max={500} horizontal reverse onChange={setResultHeight} />}
            <div id="lesson-cases" role="tabpanel" aria-label="Testcases" className="testcases" hidden={resultTab !== "cases"}>
              {!meta.practice ? <p className="small muted">{props.graded ? "This is a written lesson. Submit sends your work to the Coach for grading." : "This exercise uses the supplied test files. Open a test file above to read its cases, then Run to try them without grading. Editable inputs are available on function exercises with samples."}</p> : <Testcases ref={casesRef} onState={setPracticeState} reportError={setPracticeError} onResult={setPracticeOutcome} acquire={() => { if (execution.current) return false; execution.current = "practice"; setError(undefined); setPracticeBusy(true); setOutputOpen(true); setResultTab("result"); props.showCode(); if (props.layout === "code" || props.layout === "reading") props.changeLayout("split"); return true; }} release={() => { execution.current = undefined; setPracticeBusy(false); }} track={track} lesson={meta.id} practice={meta.practice} beforeRun={async () => {
                await saveAll();
                if (allFiles.some((f) => f.editable && (!contentsRef.current[f.path] || contentsRef.current[f.path]!.content !== contentsRef.current[f.path]!.saved))) throw new Error("Code changed while saving. Run the case again to use your latest edits.");
                return JSON.stringify([codeRevision.current, allFiles.map((f) => [f.path, contentsRef.current[f.path]?.content])]);
              }} />}
            </div>
            <div id="lesson-practice-result" role="tabpanel" aria-label="Test Result" className="testcases" hidden={resultTab !== "result"}>
              {!meta.practice ? <>
                {practiceBusy && <p role="status">Running lesson tests…</p>}
                {practiceError && <p role="alert" className="error">{practiceError}</p>}
                {!practiceBusy && !testRun && !practiceError && <p className="muted">Run tries the lesson tests without grading. Submit records a graded attempt.</p>}
                {testRun && <><p className={testRun.passed ? "ok" : "bad"}>{summarize(testRun)}{testRunRevision !== codeRevision.current ? " (before your latest edits)" : ""}</p><p className="small muted">Practice only. Your progress and submission history have not changed.</p>{testRun.results.map((r, i) => <div className={`result ${r.exitCode === 0 ? "ok" : "bad"}`} key={i}><p className="cmd"><code>{r.command}</code></p><pre>{r.output}</pre></div>)}</>}
              </> : <PracticeResults outcome={practiceOutcome} busy={practiceBusy} error={practiceError} reason={practiceState.reason} codeVersion={JSON.stringify([codeRevision.current, allFiles.map((f) => [f.path, contents[f.path]?.content])])} inputVersion={practiceState.inputVersion} files={sourceFiles} onProblem={jumpToProblem} />}
            </div>
            <div id="lesson-problems" role="tabpanel" aria-label="Problems" className="problems" hidden={resultTab !== "problems"}>
              {assistanceError && <p className="notice small" role="status">{assistanceError}</p>}
              {!problems.length && <p className="small muted">No problems reported. Submit for compiler and test results.</p>}
              {problems.map((p, i) => {
                const file = sourceFiles.find((f) => f.path === p.path);
                const at = file ? problemLocation(file.content, p.from) : undefined;
                return <button type="button" className={`problem ${p.severity}`} key={`${p.path}:${p.from}:${i}`} onClick={() => jumpToProblem(p)}>
                  <span className="problem-location">{p.path || "Checks"}{at ? `:${at.line}:${at.column}` : ""}</span>
                  <span>{p.message}</span><span className="small muted">{p.source}</span>
                </button>;
              })}
            </div>
            <section id="lesson-output" role="tabpanel" className="output" aria-label="Check output" hidden={resultTab !== "output"}>
              {!checks && <p className="small muted">Submit to see their output.</p>}
              {checksStale && checks && <p className="small muted">These results are from before your latest edits.</p>}
              {checks && <>
              {!checks.sandboxed && <p className="notice small">These checks ran without the sandbox.</p>}
              {checks.results.map((r, i) => (
                <div key={i} className={`result ${r.exitCode === 0 ? "ok" : "bad"}`}>
                  <p className="cmd">
                    <StatusIcon status={r.exitCode === 0 ? "passed" : "failed"} /> <code>{r.command}</code> <span className="muted small">{r.timedOut ? "timed out" : `${(r.durationMs / 1000).toFixed(1)}s`}</span>
                  </p>
                  {r.output.trim() && <pre>{r.output.trim()}</pre>}
                </div>
              ))}
              </>}
            </section>
          </section>
          <footer className="code-actions">
            {!props.runnerOk && !props.graded && <span className="small muted" role="status">{props.runnerDetail ?? "The code runner is unavailable."}</span>}
            {(error || practiceError) && <span className="error small" role="alert">{error || practiceError}</span>}
            {summary && <button type="button" className={`link small ${checks!.passed ? "ok" : "bad"}`} onClick={() => { setResultTab("output"); setOutputOpen(true); }}><StatusIcon status={checks!.passed ? "passed" : "failed"} /> {summary}{checksStale ? " (before edits)" : ""}</button>}
            <span className="spacer" />
            <button type="button" className="primary small-button" aria-label={props.graded ? "Submit for grading" : "Submit"} title={`Submit (${RUN_KEY})`} onClick={() => void run()} disabled={running || practiceBusy || (!props.graded && !props.runnerOk)}><PaneIcon name="submit" />{running ? "Submitting…" : props.graded ? "Submit for grading" : "Submit"}</button>
          </footer>
        </section>
      </div>
    </article>
  );
});
