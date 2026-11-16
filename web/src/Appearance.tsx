import { useEffect, useRef, useState } from "react";
import { load, save } from "./api.ts";
import { applyTextSize, TEXT_SIZES, type TextSize } from "./ui.tsx";
import { PaneIcon } from "./PaneTools.tsx";

type Theme = "system" | "light" | "dark";
export function Appearance() {
  const menu = useRef<HTMLDetailsElement>(null);
  const [theme, setTheme] = useState(() => load<Theme>("study-coach:theme", "system"));
  const [palette, setPalette] = useState(() => load("study-coach:palette", "stair"));
  const [font, setFont] = useState(() => load("study-coach:font", "golos"));
  const [size, setSize] = useState(() => load<TextSize>("study-coach:text-size", "m"));
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    document.documentElement.dataset.font = font;
    applyTextSize(size);
    save("study-coach:theme", theme); save("study-coach:palette", palette); save("study-coach:font", font); save("study-coach:text-size", size);
  }, [theme, palette, font, size]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) menu.current?.removeAttribute("open"); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && menu.current?.open) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } };
    addEventListener("pointerdown", close); addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", close); removeEventListener("keydown", escape); };
  }, []);
  return <details ref={menu} className="appearance-menu">
    <summary aria-label="Workspace settings" title="Appearance and layout"><PaneIcon name="settings" /></summary>
    <div className="appearance-popover">
      <h2>Workspace</h2>
      <label>Appearance<select aria-label="Appearance" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Palette<select aria-label="Palette" value={palette} onChange={(e) => setPalette(e.target.value)}><option value="stair">Stair / yellow & blue</option><option value="tide">Tide / blue & coral</option><option value="orchard">Orchard / plum & green</option></select></label>
      <label>Reading font<select aria-label="Reading font" value={font} onChange={(e) => setFont(e.target.value)}><option value="golos">Golos Text</option><option value="literata">Literata</option><option value="atkinson">Atkinson Hyperlegible</option></select></label>
      <label>Text size<select aria-label="Text size" value={size} onChange={(e) => setSize(e.target.value as TextSize)}>{TEXT_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div id="workspace-menu-controls" />
    </div>
  </details>;
}
