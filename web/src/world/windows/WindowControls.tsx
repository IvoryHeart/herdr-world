import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measuredFixedPositionScale } from "../../fixedPositionScale";
import { Columns2, Maximize2, Minimize2, Minus, X } from "lucide-react";
import {
  ColorSwatchButton,
  type ColorChoice,
  type ColorValue,
} from "../../components/ColorSwatch";
import { useLayer } from "../../layerStack";
import type { SnapTarget } from "./windowManager";
import "./windows.css";

export type ManagedWindowControls = {
  maximized: boolean;
  compact: boolean;
  onMinimize(): void;
  onMaximize(): void;
  onClose(): void;
  onSnap(target: SnapTarget): void;
  onFloat(): void;
  /** A terminal window's colour, chosen in its menu. */
  color?: {
    palette: readonly ColorChoice[];
    current: ColorValue;
    onColor(id: string | null): void;
  } | null;
};
const choices: { target: SnapTarget; label: string }[] = [
  { target: "left", label: "Left half" },
  { target: "right", label: "Right half" },
  { target: "top", label: "Top half" },
  { target: "bottom", label: "Bottom half" },
  { target: "top-left", label: "Top left" },
  { target: "top-right", label: "Top right" },
  { target: "bottom-left", label: "Bottom left" },
  { target: "bottom-right", label: "Bottom right" },
];
export function WindowControls({
  controls,
  label = "window",
}: {
  controls: ManagedWindowControls;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayer(open, () => setOpen(false), {
    element: () => menu.current,
    anchors: () => [trigger.current],
  });
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
  }, [open]);
  const scale = open ? measuredFixedPositionScale() : 1;
  const anchor = trigger.current?.getBoundingClientRect();
  const position = anchor
    ? {
        left:
          Math.max(
            8,
            Math.min(
              anchor.right - 240 * scale,
              window.innerWidth - 240 * scale - 8,
            ),
          ) / scale,
        top:
          Math.max(
            8,
            Math.min(
              anchor.bottom + 4,
              window.innerHeight - (controls.color ? 250 : 210) * scale - 8,
            ),
          ) / scale,
      }
    : {};
  return (
    <div
      ref={host}
      className="world-window-controls workspace-inspector-actions"
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Tab") setOpen(false);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const items = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"], .color-swatch-button',
            ) ?? [],
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          items[
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }
      }}
    >
      {!controls.compact && (
        <button
          ref={trigger}
          type="button"
          aria-label={`Snap ${label}`}
          title="Snap window"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Columns2 size={15} />
        </button>
      )}
      <button
        type="button"
        aria-label={`Minimize ${label}`}
        title="Minimize window"
        onClick={controls.onMinimize}
      >
        <Minus size={15} />
      </button>
      {!controls.compact && (
        <button
          type="button"
          aria-label={`${controls.maximized ? "Restore" : "Maximize"} ${label}`}
          title={controls.maximized ? "Restore window" : "Maximize window"}
          onClick={controls.onMaximize}
        >
          {controls.maximized ? (
            <Minimize2 size={15} />
          ) : (
            <Maximize2 size={15} />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={`Close ${label}`}
        title="Close window"
        onClick={controls.onClose}
      >
        <X size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            style={position}
            className="world-window-snap-menu"
            role="menu"
            aria-label="Window placement"
          >
            {choices.map(({ target, label }) => (
              <button
                key={target}
                type="button"
                role="menuitem"
                onClick={() => {
                  controls.onSnap(target);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                controls.onFloat();
                setOpen(false);
              }}
            >
              Float window
            </button>
            {controls.color ? (
              <ColorSwatchButton
                className="world-window-color"
                label="Terminal colour"
                text="Colour"
                palette={controls.color.palette}
                current={controls.color.current}
                onColor={(id) => {
                  setOpen(false);
                  controls.color?.onColor(id);
                }}
              />
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
