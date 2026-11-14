import { useEffect, useState } from "react";

import { api, type ModelChoice, type Models, type Provider } from "./api.ts";

let cache: Promise<Models> | undefined;
const listeners = new Set<() => void>();

/** Reload the model choices everywhere, after a connection is added or removed. */
export function refreshModels() {
  cache = undefined;
  for (const l of listeners) l();
}

/** The signed-in person's model choices: their connections, plus server logins for admins. */
export function useModels(): Models | undefined {
  const [models, setModels] = useState<Models>();
  useEffect(() => {
    let live = true;
    const load = () => {
      cache ??= api.models();
      cache.then((m) => live && setModels(m), () => {});
    };
    load();
    listeners.add(load);
    return () => {
      live = false;
      listeners.delete(load);
    };
  }, []);
  return models;
}

export function choiceLabel(choices: ModelChoice[] | undefined, id: string | undefined): string {
  const c = choices?.find((x) => x.id === id);
  if (!c) return id === "codex" ? "ChatGPT" : id === "claude" ? "Claude" : "Model";
  return c.model ? `${c.label} · ${c.model}` : c.label;
}

/** A select of the person's models; links to the Models page when there are none. */
export function ModelPicker(props: { value: Provider; onChange: (p: Provider) => void; disabled?: boolean; label: string }) {
  const models = useModels();
  const choices = models?.choices ?? [];
  // A track may name a connection that was removed; fall back to the first choice.
  useEffect(() => {
    if (choices.length && !choices.some((c) => c.id === props.value)) props.onChange(choices[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);
  if (!models) return <span className="muted small">Loading models…</span>;
  if (!choices.length)
    return (
      <a className="button small-button primary" href="#/models">
        Connect a model
      </a>
    );
  return (
    <select className="model-picker" aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.model ? `${c.label} · ${c.model}` : c.label}
        </option>
      ))}
    </select>
  );
}
