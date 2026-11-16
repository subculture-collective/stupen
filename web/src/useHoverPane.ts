import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";

/** Rail and drawer share a delayed dismissal boundary so crossing between them stays open. */
export function useHoverPane(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelRef = useCallback((node: HTMLElement | null) => { panel.current = node; }, []);
  const cancel = () => { clearTimeout(timer.current); };
  const show = () => { cancel(); setOpen(true); };
  const dismiss = () => {
    cancel();
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
    setOpen(false);
  };
  const scheduleClose = () => {
    cancel();
    timer.current = setTimeout(() => {
      const active = document.activeElement;
      const focused = active instanceof HTMLElement && (trigger.current?.contains(active) || panel.current?.contains(active))
        && (active.matches(":focus-visible") || active.matches('input, textarea, select, [contenteditable="true"]'));
      if (!trigger.current?.matches(":hover") && !panel.current?.matches(":hover") && !focused) setOpen(false);
    }, 180);
  };
  useEffect(() => {
    if (!enabled) setOpen(false);
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    if (enabled) document.addEventListener("pointerdown", outside);
    return () => { clearTimeout(timer.current); document.removeEventListener("pointerdown", outside); };
  }, [enabled]);
  const events = enabled ? {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") show(); },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") scheduleClose(); },
    onFocusCapture: (_event: FocusEvent<HTMLElement>) => show(),
    onBlurCapture: (_event: FocusEvent<HTMLElement>) => scheduleClose(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); dismiss(); }
    },
  } : {};
  return { open, show, dismiss, trigger, panelRef, events };
}
