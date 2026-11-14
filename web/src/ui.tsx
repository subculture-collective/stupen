import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type Status = "passed" | "failed" | "unchecked";

/** Status icons drawn at one weight and size, so they line up wherever they appear. */
export function StatusIcon(props: { status: Status; size?: number }) {
  const s = props.size ?? 14;
  const common = { width: s, height: s, viewBox: "0 0 16 16", "aria-hidden": true, className: `icon st-${props.status}` } as const;
  if (props.status === "passed")
    return (
      <svg {...common}>
        <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (props.status === "failed")
    return (
      <svg {...common}>
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="icon lock" role="img" aria-label="read-only" viewBox="0 0 16 16" width="12" height="12">
      <title>Read-only</title>
      <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** Arrow, Home and End move between tabs; only the selected tab is in the Tab order. */
export function tabKeys<T extends string>(e: KeyboardEvent, ids: T[], current: T, select: (id: T) => void) {
  const i = ids.indexOf(current);
  let next: number | undefined;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % ids.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + ids.length) % ids.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = ids.length - 1;
  if (next === undefined) return;
  e.preventDefault();
  select(ids[next]!);
  const list = (e.currentTarget as HTMLElement).closest('[role="tablist"]');
  requestAnimationFrame(() => (list?.querySelectorAll<HTMLElement>('[role="tab"]')[next!])?.focus());
}

/**
 * A button that asks for confirmation in place instead of a browser dialog.
 * Escape cancels from anywhere in the question; focus returns to the button.
 */
export function ConfirmButton(props: {
  children: ReactNode;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string | undefined;
  danger?: boolean;
  /** Accessible name and tooltip when the button shows only an icon. */
  label?: string | undefined;
}) {
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) yes.current?.focus();
    else if (wasAsking.current) trigger.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  if (!asking)
    return (
      <button
        ref={trigger}
        type="button"
        className={props.className}
        disabled={props.disabled}
        aria-label={props.label}
        title={props.label}
        onClick={() => setAsking(true)}
      >
        {props.children}
      </button>
    );
  return (
    <span
      className="confirm"
      role="group"
      aria-label={props.question}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setAsking(false);
        }
      }}
    >
      <span className="confirm-q">{props.question}</span>
      <button
        ref={yes}
        type="button"
        className={props.danger ? "danger" : "primary"}
        disabled={props.disabled}
        onClick={() => {
          if (props.disabled) return;
          setAsking(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

/** A media query that stays current when the window is resized or a tablet is rotated. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== "function") return () => {};
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
}

/** A circular arrow: the code changed since its check, so run it again. */
export function RerunIcon(props: { size?: number }) {
  const s = props.size ?? 14;
  return (
    <svg className="icon st-changed" width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.6 6.2A5 5 0 1 0 13 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.4 2.6v3.9H9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Chevron(props: { dir: "left" | "right" }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={props.dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ThemeIcon(props: { theme: "system" | "light" | "dark" }) {
  const common = { className: "icon", viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true } as const;
  if (props.theme === "light")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (props.theme === "dark")
    return (
      <svg {...common}>
        <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </svg>
  );
}

export const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const RUN_KEY = isMac ? "⌘↵" : "Ctrl+Enter";
export const SAVE_KEY = isMac ? "⌘S" : "Ctrl+S";

/** The window width, kept current on resize and rotation. */
export function useWindowWidth(): number {
  return useSyncExternalStore(
    (cb) => {
      addEventListener("resize", cb);
      return () => removeEventListener("resize", cb);
    },
    () => (typeof innerWidth === "number" ? innerWidth : 1440),
  );
}

/** Reading and code text size, applied to the whole page and available on every screen. */
export const TEXT_SIZES = [
  { id: "s", label: "Small text", read: 13.5, code: 13 },
  { id: "m", label: "Medium text", read: 14.5, code: 14 },
  { id: "l", label: "Large text", read: 16, code: 15.5 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["id"];

export function applyTextSize(id: TextSize) {
  const t = TEXT_SIZES.find((x) => x.id === id) ?? TEXT_SIZES[1];
  document.documentElement.style.setProperty("--read-size", `${t.read}px`);
  document.documentElement.style.setProperty("--code-size", `${t.code}px`);
}
