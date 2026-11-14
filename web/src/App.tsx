import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { api, type Job, load, type Me, type ProviderStatus, save, type Track, type TrackState } from "./api.ts";
import { JobStrip } from "./Jobs.tsx";
import { Learn } from "./Learn.tsx";
import { Materials } from "./Materials.tsx";
import { Plan } from "./Plan.tsx";
import { Prompts } from "./Prompts.tsx";
import { TrackForm } from "./TrackForm.tsx";
import { ThemeIcon } from "./ui.tsx";

export type Route =
  | { page: "home" }
  | { page: "new" }
  | { page: "prompts" }
  | { page: "track"; track: string; view: "learn" | "plan" | "materials" | "settings"; lesson?: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "prompts") return { page: "prompts" };
  if (parts[0] === "t" && parts[1]) {
    const view = (["learn", "plan", "materials", "settings"] as const).find((v) => v === parts[2]) ?? "learn";
    return { page: "track", track: parts[1], view, ...(view === "learn" && parts[3] ? { lesson: parts[3] } : {}) };
  }
  return { page: "home" };
}

export function href(r: Route): string {
  if (r.page === "track") return `#/t/${encodeURIComponent(r.track)}/${r.view}${r.lesson ? `/${encodeURIComponent(r.lesson)}` : ""}`;
  return r.page === "home" ? "#/" : `#/${r.page}`;
}

export const go = (r: Route) => {
  location.hash = href(r);
};

function useHash(): string {
  return useSyncExternalStore(
    (cb) => {
      addEventListener("hashchange", cb);
      return () => removeEventListener("hashchange", cb);
    },
    () => location.hash,
  );
}

type Theme = "system" | "light" | "dark";
function applyTheme(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function App() {
  const route = parseRoute(useHash());
  const [me, setMe] = useState<Me>();
  const [providers, setProviders] = useState<ProviderStatus>();
  const [tracks, setTracks] = useState<Track[]>();
  const [state, setState] = useState<TrackState>();
  const [error, setError] = useState<string>();
  const [theme, setTheme] = useState<Theme>(() => load<Theme>("study-coach:theme", "system"));
  const trackId = route.page === "track" ? route.track : undefined;

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    api.me().then(setMe, (e) => setError(e.message));
    api.providers().then(setProviders, () => {});
    api.tracks().then(setTracks, (e) => setError(e.message));
  }, []);

  const refresh = useCallback(async () => {
    if (!trackId) return;
    try {
      setState(await api.track(trackId));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [trackId]);

  useEffect(() => {
    setState(undefined);
    void refresh();
  }, [refresh]);

  // While a job runs, poll its progress; refresh the track when one finishes.
  const running = state?.jobs.some((j) => j.state === "running");
  const prevRunning = useRef(new Set<string>());
  useEffect(() => {
    if (!running || !trackId) return;
    const timer = setInterval(async () => {
      const jobs = await api.jobs(trackId).catch(() => undefined);
      if (!jobs) return;
      const finished = [...prevRunning.current].some((id) => jobs.find((j) => j.id === id)?.state !== "running");
      prevRunning.current = new Set(jobs.filter((j) => j.state === "running").map((j) => j.id));
      if (finished) void refresh();
      else setState((s) => (s ? { ...s, jobs } : s));
    }, 2000);
    return () => clearInterval(timer);
  }, [running, trackId, refresh]);

  const onJob = (job: Job) => {
    prevRunning.current.add(job.id);
    setState((s) => (s ? { ...s, jobs: [...s.jobs.filter((j) => j.id !== job.id), job] } : s));
  };

  const reloadTracks = async () => setTracks(await api.tracks());

  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const view = route.page === "track" ? route.view : undefined;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 29V21H11V14H19V7H29V29Z" fill="currentColor" />
            <rect x="19" y="4" width="10" height="3" fill="#f5c400" />
          </svg>
          stupen
        </a>
        {tracks && tracks.length > 0 && (
          <select
            className="track-select"
            aria-label="Track"
            value={trackId ?? ""}
            onChange={(e) => (e.target.value === "__new" ? go({ page: "new" }) : go({ page: "track", track: e.target.value, view: "learn" }))}
          >
            {!trackId && <option value="">Choose a track…</option>}
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
            <option value="__new">+ New track…</option>
          </select>
        )}
        {trackId && (
          <nav className="views" aria-label="Track views">
            {(["learn", "plan", "materials", "settings"] as const).map((v) => (
              <a key={v} href={href({ page: "track", track: trackId, view: v })} className={view === v ? "on" : ""} aria-current={view === v ? "page" : undefined}>
                {v === "learn" ? "Learn" : v === "plan" ? "Plan" : v === "materials" ? `Materials${state?.materials.length ? ` · ${state.materials.length}` : ""}` : "Settings"}
              </a>
            ))}
          </nav>
        )}
        <span className="spacer" />
        <a className={`top-link ${route.page === "prompts" ? "on" : ""}`} href="#/prompts">
          Prompts
        </a>
        <button
          type="button"
          className="icon-button"
          aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}`}
          title={`Theme: ${theme}`}
          onClick={() => {
            const t = nextTheme[theme];
            setTheme(t);
            save("study-coach:theme", t);
          }}
        >
          <ThemeIcon theme={theme} />
        </button>
        {me && me.user !== "local" && <span className="muted small user">{me.user}</span>}
      </header>
      {providers && (!providers.claude.ok || !providers.codex.ok) && (
        <p className="banner small">
          {!providers.claude.ok && <span>Claude is not signed in on the server ({providers.claude.detail}). </span>}
          {!providers.codex.ok && <span>ChatGPT is not signed in on the server ({providers.codex.detail}).</span>}
        </p>
      )}
      {error && (
        <p className="banner" role="alert">
          {error}{" "}
          <button type="button" className="link" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </p>
      )}
      {state && <JobStrip jobs={state.jobs} track={state.track.id} onChange={refresh} />}
      <main className="main">
        {route.page === "prompts" && <Prompts />}
        {(route.page === "new" || (route.page === "home" && tracks && tracks.length === 0)) && me && (
          <TrackForm
            me={me}
            first={!tracks?.length}
            onSaved={async (t, opts) => {
              await reloadTracks();
              go({ page: "track", track: t.id, view: opts.plan ? "plan" : "learn" });
            }}
          />
        )}
        {route.page === "home" && tracks && tracks.length > 0 && <Home tracks={tracks} />}
        {route.page === "track" && !state && !error && <p className="loading">Loading…</p>}
        {route.page === "track" && state && me && (
          <>
            {route.view === "learn" && <Learn me={me} state={state} lessonId={route.lesson} refresh={refresh} onJob={onJob} />}
            {route.view === "plan" && <Plan state={state} refresh={refresh} onJob={onJob} />}
            {route.view === "materials" && <Materials state={state} refresh={refresh} onJob={onJob} />}
            {route.view === "settings" && (
              <TrackForm
                me={me}
                track={state.track}
                state={state}
                onSaved={async () => {
                  await reloadTracks();
                  await refresh();
                }}
                onDeleted={async () => {
                  await reloadTracks();
                  go({ page: "home" });
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Home(props: { tracks: Track[] }) {
  return (
    <section className="home">
      <div className="home-head">
        <h1>Your tracks</h1>
        <a className="button primary" href="#/new">
          New track
        </a>
      </div>
      <ul className="track-cards">
        {props.tracks.map((t) => (
          <li key={t.id}>
            <a href={href({ page: "track", track: t.id, view: "learn" })}>
              <strong>{t.title}</strong>
              <span className="muted small">
                {t.subject !== t.title ? `${t.subject} · ` : ""}
                {t.level} · last used {new Date(t.updatedAt).toLocaleDateString()}
              </span>
              {t.goals && <span className="small clamp">{t.goals}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
