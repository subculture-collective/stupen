import { useEffect, useRef, useState } from "react";
import { PaneIcon } from "./PaneTools.tsx";

export type WorkspaceCommand = { id: string; label: string; detail?: string; run: () => void; disabled?: boolean };
export function closeOutside(e: React.MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return;
  const box = e.currentTarget.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) e.currentTarget.close();
}
export function CommandPicker({ commands }: { commands: WorkspaceCommand[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = commands.filter((c) => `${c.label} ${c.detail ?? ""}`.toLowerCase().includes(query.toLowerCase())).filter((c) => !c.disabled);
  const open = () => { setQuery(""); setSelected(0); dialog.current?.showModal(); input.current?.focus(); };
  const execute = (command: WorkspaceCommand) => { dialog.current?.close(); command.run(); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (dialog.current?.open) dialog.current.close(); else open(); } };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => { document.getElementById(`command-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  return <>
    <button type="button" className="command-trigger" aria-label="Open command picker" title="Commands (Ctrl/Cmd+K)" onClick={open}><PaneIcon name="search" /><span>Commands</span><kbd>⌘ / Ctrl K</kbd></button>
    <dialog ref={dialog} className="command-picker" aria-label="Command picker" onClick={closeOutside}>
      <div className="command-input"><PaneIcon name="search" /><input ref={input} role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-expanded={true} aria-controls="command-results" aria-activedescendant={filtered[selected] ? `command-${selected}` : undefined} placeholder="Type a command or lesson title…" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((i) => filtered.length ? (i + (e.key === "ArrowDown" ? 1 : filtered.length - 1)) % filtered.length : 0); }
        if (e.key === "Enter" && filtered[selected]) { e.preventDefault(); execute(filtered[selected]); }
      }} /><button type="button" className="pane-icon" aria-label="Close command picker" onClick={() => dialog.current?.close()}><PaneIcon name="close" /></button></div>
      <div role="listbox" id="command-results" aria-label="Commands" className="command-results">
        {filtered.map((c, i) => <button type="button" role="option" aria-selected={selected === i} id={`command-${i}`} key={c.id} onPointerMove={() => setSelected(i)} onClick={() => execute(c)}><span>{c.label}</span>{c.detail && <small>{c.detail}</small>}</button>)}
        {!filtered.length && <p className="muted">No matching commands.</p>}
      </div>
      <footer className="small muted">↑ ↓ to choose · Enter to run · Esc to close</footer>
    </dialog>
  </>;
}
