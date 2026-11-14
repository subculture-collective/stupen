import { useEffect, useState } from "react";

import { api, BASE, type Connection } from "./api.ts";
import { refreshModels, useModels } from "./ModelPicker.tsx";

/** Your own AI accounts: add an API key or connect OpenRouter, pick a model, remove. */
export function ModelsPage() {
  const models = useModels();
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [note, setNote] = useState<string | undefined>(params.get("connected") === "openrouter" ? "OpenRouter is connected. It starts on OpenRouter's automatic model choice; pick a specific model below if you like." : undefined);
  const [error, setError] = useState<string | undefined>(params.get("error") ?? undefined);
  const [adding, setAdding] = useState(false);

  if (!models) return <p className="loading">Loading…</p>;
  const server = models.choices.filter((c) => c.kind === "claude" || c.kind === "codex");
  return (
    <section className="account models">
      <h1>Models</h1>
      <p className="lede">
        Stupen runs on your own AI account. Add an API key from a provider, or connect OpenRouter to sign in there and approve Stupen without copying a key. Keys are stored encrypted and are never shown again; usage is billed to your account by the provider.
      </p>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {models.connections.map((c) => (
        <ConnectionCard key={c.id} c={c} kindLabel={models.kinds.find((k) => k.id === c.kind)?.label ?? c.kind} onError={setError} onNote={setNote} />
      ))}
      {server.length > 0 && (
        <div className="card">
          <h2>Server logins</h2>
          <p className="muted small">As an admin you can also use the server's Claude and ChatGPT subscriptions: {server.map((s) => s.label).join(", ")}.</p>
        </div>
      )}

      {adding ? (
        <AddConnection
          onDone={(msg) => {
            setAdding(false);
            setNote(msg);
            refreshModels();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="row wrap">
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            Add an API key
          </button>
          <a className="button" href={`${BASE}/auth/openrouter`}>
            Connect with OpenRouter
          </a>
        </div>
      )}
    </section>
  );
}

function ConnectionCard(props: { c: Connection; kindLabel: string; onError: (e?: string) => void; onNote: (n?: string) => void }) {
  const { c } = props;
  const [list, setList] = useState<string[]>();
  const [model, setModel] = useState(c.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    props.onError(undefined);
    props.onNote(undefined);
    try {
      await f();
      if (done) props.onNote(done);
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card connection">
      <h2>
        {c.label} <span className="muted small">{props.kindLabel}</span>
      </h2>
      <p className="small muted">
        Key {c.keyHint}
        {c.baseUrl && ` · ${c.baseUrl}`}
        {c.web ? " · can search the web" : " · no web search"}
      </p>
      <div className="row wrap">
        <label className="small" htmlFor={`m-${c.id}`}>
          Model
        </label>
        <input id={`m-${c.id}`} list={`ml-${c.id}`} value={model} onChange={(e) => setModel(e.target.value)} style={{ maxWidth: 320 }} />
        <datalist id={`ml-${c.id}`}>{list?.map((m) => <option key={m} value={m} />)}</datalist>
        <button type="button" className="small-button" disabled={busy} onClick={() => run(async () => setList((await api.listModels({ id: c.id })).models), undefined)}>
          {list ? `${list.length} models` : "Check key and list models"}
        </button>
      </div>
      <div className="row wrap">
        <input type="password" autoComplete="off" placeholder="Replace the key (optional)" value={key} onChange={(e) => setKey(e.target.value)} style={{ maxWidth: 320 }} />
        <button
          type="button"
          className="small-button primary"
          disabled={busy || (model === c.model && !key)}
          onClick={() =>
            run(async () => {
              await api.saveConnection({ id: c.id, model, ...(key ? { key } : {}) });
              setKey("");
              refreshModels();
            }, "Saved.")
          }
        >
          Save
        </button>
        <button
          type="button"
          className="small-button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.deleteConnection(c.id);
              refreshModels();
            }, `Removed ${c.label}. Revoke the key at the provider too if you no longer use it.`)
          }
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddConnection(props: { onDone: (msg: string) => void; onCancel: () => void }) {
  const models = useModels();
  const kinds = models?.kinds ?? [];
  const [kind, setKind] = useState(kinds[0]?.id ?? "anthropic");
  const info = kinds.find((k) => k.id === kind);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState(info?.model ?? "");
  const [label, setLabel] = useState("");
  const [list, setList] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setModel(info?.model ?? "");
    setList(undefined);
  }, [kind, info?.model]);

  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const ms = (await api.listModels({ kind, key, ...(info?.baseUrl ? { baseUrl } : {}) })).models;
      setList(ms);
      if (!model && ms.length) setModel(ms[0]!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const c = await api.saveConnection({ kind, key, model, ...(label ? { label } : {}), ...(info?.baseUrl ? { baseUrl } : {}) });
      props.onDone(`${c.label} is connected with ${c.model}. Choose it in a track's settings or in the coach.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card add-connection" onSubmit={save}>
      <h2>Add an API key</h2>
      <label className="block small" htmlFor="ac-kind">
        Provider
      </label>
      <select id="ac-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      {info?.keyUrl && (
        <p className="small muted">
          Create a key at{" "}
          <a href={info.keyUrl} target="_blank" rel="noreferrer">
            {new URL(info.keyUrl).host}
          </a>
          . Usage is billed to that account.
        </p>
      )}
      {info?.baseUrl && (
        <>
          <label className="block small" htmlFor="ac-base">
            Base URL (https, public)
          </label>
          <input id="ac-base" placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </>
      )}
      <label className="block small" htmlFor="ac-key">
        API key
      </label>
      <input id="ac-key" type="password" autoComplete="off" required value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="row wrap">
        <button type="button" disabled={busy || !key} onClick={load}>
          {busy ? "Checking…" : "Check key and list models"}
        </button>
        {list && <span className="small ok">Key works · {list.length} models</span>}
      </div>
      <label className="block small" htmlFor="ac-model">
        Model
      </label>
      <input id="ac-model" list="ac-models" required value={model} onChange={(e) => setModel(e.target.value)} placeholder={list ? "Choose or type a model" : "Check the key to list models"} />
      <datalist id="ac-models">{list?.map((m) => <option key={m} value={m} />)}</datalist>
      <label className="block small" htmlFor="ac-label">
        Name (optional)
      </label>
      <input id="ac-label" placeholder={info?.label.replace(/ \(.*\)$/, "")} value={label} onChange={(e) => setLabel(e.target.value)} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button type="submit" className="primary" disabled={busy || !key || !model}>
          Save
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
