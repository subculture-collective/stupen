import { useEffect, useRef, useState, type CSSProperties } from "react";

export type IconName = "expand" | "restore" | "collapse" | "float" | "dock" | "run" | "submit" | "reset" | "delete" | "settings" | "search" | "list" | "close" | "move";
const paths: Record<IconName, string> = {
  expand: "M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4",
  restore: "M5 2h9v9M2 5h9v9H2Z",
  collapse: "m10 3-5 5 5 5", float: "M8 2h6v6M14 2 7 9M5 3H2v11h11v-3",
  dock: "M2 2h12v12H2ZM9 2v12", run: "m5 3 8 5-8 5Z",
  submit: "m3 8 3 3 7-7", reset: "M3 5a5 5 0 1 1-1 5M2 2v4h4",
  delete: "M2 4h12M6 2h4M4 4l1 10h6l1-10M7 7v4M9 7v4",
  settings: "M2 4h12M2 12h12M6 2v4M10 10v4", search: "M11 11l3 3M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  list: "M5 3h9M5 8h9M5 13h9M2 3h.1M2 8h.1M2 13h.1",
  close: "m3 3 10 10M13 3 3 13", move: "M8 1v14M1 8h14M5 4l3-3 3 3M5 12l3 3 3-3M4 5 1 8l3 3M12 5l3 3-3 3",
};
export function PaneIcon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Floating panels stay inside the viewport and can be moved with pointer or arrows. */
export function useFloatingPane(side: "left" | "right", label: string) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const grip = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const move = (x: number, y: number, element: HTMLElement) => {
    const box = element.closest<HTMLElement>(".floating-pane")!.getBoundingClientRect();
    setPosition({ x: Math.max(0, Math.min(x, innerWidth - box.width)), y: Math.max(0, Math.min(y, innerHeight - box.height)) });
  };
  useEffect(() => {
    const clamp = () => {
      const box = grip.current?.closest(".floating-pane")?.getBoundingClientRect();
      if (box) setPosition((p) => p ? { x: Math.max(0, Math.min(p.x, innerWidth - box.width)), y: Math.max(0, Math.min(p.y, innerHeight - box.height)) } : p);
    };
    addEventListener("resize", clamp); return () => removeEventListener("resize", clamp);
  }, []);
  const style: CSSProperties = position ? { left: position.x, top: position.y, right: "auto", bottom: "auto", maxWidth: `calc(100vw - ${position.x}px - 8px)`, maxHeight: `calc(100dvh - ${position.y}px - 8px)` } : { [side]: 16 };
  const handle = <button ref={grip} type="button" className="pane-icon move-pane" aria-label={`Move floating ${label} pane`} title="Drag to move; arrow keys also move the pane"
    onPointerDown={(e) => { const box = e.currentTarget.closest(".floating-pane")!.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => { const d = drag.current; if (d) move(d.left + e.clientX - d.x, d.top + e.clientY - d.y, e.currentTarget); }}
    onLostPointerCapture={() => { drag.current = undefined; }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}
    onKeyDown={(e) => { if (!e.key.startsWith("Arrow")) return; e.preventDefault(); const b = e.currentTarget.closest(".floating-pane")!.getBoundingClientRect(); move(b.left + (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0), b.top + (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0), e.currentTarget); }}><PaneIcon name="move" /></button>;
  return { style, handle };
}
