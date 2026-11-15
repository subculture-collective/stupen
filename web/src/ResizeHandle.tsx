import { useRef } from "react";

/** A splitter that works with a pointer, touch, or the arrow keys. */
export function ResizeHandle(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  horizontal?: boolean;
  reverse?: boolean;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ start: number; value: number } | undefined>(undefined);
  const set = (n: number) => props.onChange(Math.round(Math.max(props.min, Math.min(props.max, n))));
  const direction = props.reverse ? -1 : 1;
  return (
    <div
      className={`resize-handle ${props.horizontal ? "horizontal" : "vertical"}`}
      role="separator"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation={props.horizontal ? "horizontal" : "vertical"}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: props.horizontal ? e.clientY : e.clientX, value: props.value };
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.value + direction * ((props.horizontal ? e.clientY : e.clientX) - drag.current.start));
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
      onLostPointerCapture={() => (drag.current = undefined)}
      onKeyDown={(e) => {
        const previous = props.horizontal ? "ArrowUp" : "ArrowLeft";
        const next = props.horizontal ? "ArrowDown" : "ArrowRight";
        if (![previous, next, "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "Home") set(props.min);
        else if (e.key === "End") set(props.max);
        else set(props.value + (e.key === next ? 1 : -1) * direction * (e.shiftKey ? 40 : 10));
      }}
    />
  );
}
