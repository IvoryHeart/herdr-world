import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measuredFixedPositionScale } from "../../fixedPositionScale";
import { PanelsTopLeft, Minus } from "lucide-react";
import "./windows.css";

export type WindowSwitcherEntry = {
  id: string;
  tab?: { connectionId: string; runtimeGeneration: number; tabId: string };
  label: string;
  active: boolean;
  minimized: boolean;
  onSelect(): void;
};
export function WindowSwitcher({
  entries,
}: {
  entries: readonly WindowSwitcherEntry[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    const scale = measuredFixedPositionScale();
    if (bounds)
      setPosition({
        left:
          Math.max(
            8,
            Math.min(
              bounds.right - 280 * scale,
              window.innerWidth - 280 * scale - 8,
            ),
          ) / scale,
        top:
          Math.max(
            8,
            Math.min(
              bounds.bottom + 4,
              window.innerHeight -
                Math.min(entries.length * 40 + 16, 320) * scale -
                8,
            ),
          ) / scale,
      });
    (
      menu.current?.querySelector<HTMLButtonElement>('[aria-current="true"]') ??
      menu.current?.querySelector<HTMLButtonElement>("button")
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open, entries.length]);
  if (!entries.length) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="world-window-switcher-trigger"
        title="Open windows"
        aria-label={`Open windows (${entries.length})`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <PanelsTopLeft size={15} />
        <span>{entries.length}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="world-window-switcher-menu"
            role="menu"
            aria-label="Open windows"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                trigger.current?.focus();
              }
              if (event.key === "Tab") setOpen(false);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = Array.from(
                  menu.current?.querySelectorAll<HTMLButtonElement>("button") ??
                    [],
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                items[
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                    items.length
                ]?.focus();
              }
            }}
          >
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                aria-current={entry.active ? "true" : undefined}
                onClick={() => {
                  entry.onSelect();
                  setOpen(false);
                  requestAnimationFrame(() => {
                    const frame = document.querySelector<HTMLElement>(
                      `[data-window-id="${CSS.escape(entry.id)}"]`,
                    );
                    (frame ?? trigger.current)?.focus({ preventScroll: true });
                  });
                }}
              >
                <span>{entry.label}</span>
                {entry.minimized ? (
                  <Minus size={15} aria-label="Minimized" />
                ) : null}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
