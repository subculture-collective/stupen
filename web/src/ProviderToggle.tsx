import type { Provider } from "./api.ts";

const LABEL: Record<Provider, string> = { claude: "Claude", codex: "ChatGPT" };

/** Claude or ChatGPT, as a pair of toggle buttons. Used by the coach and the generation actions. */
export function ProviderToggle(props: { value: Provider; onChange: (p: Provider) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {(["claude", "codex"] as const).map((p) => (
        <button key={p} type="button" aria-pressed={props.value === p} className={props.value === p ? "on" : ""} disabled={props.disabled} onClick={() => props.onChange(p)}>
          {LABEL[p]}
        </button>
      ))}
    </div>
  );
}
