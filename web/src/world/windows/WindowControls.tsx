import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { measuredFixedPositionScale } from "../../fixedPositionScale";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  ColorSwatchButton,
  type ColorChoice,
  type ColorValue,
} from "../../components/ColorSwatch";
import { useLayer } from "../../layerStack";
import type { SnapTarget } from "./windowManager";
import "./windows.css";

/** Where a phone shows a window: the whole screen, a sheet or a card. */
export type PhoneWindowPlacement =
  | { kind: "full" }
  | { kind: "sheet"; edge: "top" | "bottom"; fraction: number }
  | {
      kind: "float";
      rect: { left: number; top: number; width: number; height: number };
    };

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
  /** The phone placement, when the frame can move the window on a phone. */
  phonePlacement?: PhoneWindowPlacement;
  onPhonePlacement?(placement: PhoneWindowPlacement): void;
  /** Close is shown as Back at the start of the bar, as Town's window does. */
  back?: { label: string };
  /** The next agent that needs you, as the bar's primary action. */
  next?: { count: number; urgent: boolean; onNext(): void } | null;
  /** On a phone, the window's views live in ⋯ instead of the bar. */
  views?: readonly {
    id: string;
    label: string;
    checked: boolean;
    onSelect(): void;
  }[];
  /** Other agents and terminals this window can switch to. */
  switchTo?: readonly {
    id: string;
    label: string;
    detail?: string;
    onSelect(): void;
  }[];
};

/** Close presented as Back, for the leading edge of a window bar. */
export function WindowBackButton({
  controls,
}: {
  controls: ManagedWindowControls;
}) {
  if (!controls.back) return null;
  return (
    <button
      type="button"
      className="world-window-back"
      aria-label={controls.back.label}
      title={controls.back.label}
      onClick={controls.onClose}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
  );
}
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
type MenuItem = {
  key?: string;
  label: string;
  detail?: string;
  checked?: boolean;
  section?: string;
  run(): void;
};

function phonePlacementItems(controls: ManagedWindowControls): MenuItem[] {
  const place = controls.onPhonePlacement;
  if (!place) return [];
  const current = controls.phonePlacement ?? { kind: "full" };
  const edge = current.kind === "sheet" ? current.edge : "bottom";
  const fraction = current.kind === "sheet" ? current.fraction : 0.5;
  const sheetAt = (at: number) =>
    current.kind === "sheet" && Math.abs(current.fraction - at) < 0.01;
  return [
    {
      label: "Full screen",
      checked: current.kind === "full",
      run: () => place({ kind: "full" }),
    },
    {
      label: "Top",
      checked: current.kind === "sheet" && current.edge === "top",
      run: () => place({ kind: "sheet", edge: "top", fraction }),
    },
    {
      label: "Bottom",
      checked: current.kind === "sheet" && current.edge === "bottom",
      run: () => place({ kind: "sheet", edge: "bottom", fraction }),
    },
    {
      label: "One third",
      checked: sheetAt(1 / 3),
      run: () => place({ kind: "sheet", edge, fraction: 1 / 3 }),
    },
    {
      label: "Half",
      checked: sheetAt(1 / 2),
      run: () => place({ kind: "sheet", edge, fraction: 1 / 2 }),
    },
    {
      label: "Floating",
      checked: current.kind === "float",
      run: () =>
        place(
          current.kind === "float"
            ? current
            : {
                kind: "float",
                rect: {
                  left: 12,
                  top: Math.round(window.innerHeight * 0.25),
                  width: window.innerWidth - 24,
                  height: Math.round(window.innerHeight * 0.5),
                },
              },
        ),
    },
  ];
}

/**
 * The window bar keeps maximise and close as buttons. The rarer actions
 * (minimise, snap, float, a phone's position and the colour) share ⋯.
 */
export function WindowControls({
  controls,
  label = "window",
}: {
  controls: ManagedWindowControls;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const items: MenuItem[] = [
    ...(controls.views ?? []).map((view, index) => ({
      key: `view:${view.id}`,
      label: view.label,
      checked: view.checked,
      section: index === 0 ? "View" : undefined,
      run: view.onSelect,
    })),
    ...(controls.switchTo ?? []).map((target, index) => ({
      key: `switch:${target.id}`,
      label: target.label,
      detail: target.detail,
      section: index === 0 ? "Switch to" : undefined,
      run: target.onSelect,
    })),
    {
      label: "Minimize",
      section:
        controls.views?.length || controls.switchTo?.length
          ? "Window"
          : undefined,
      run: controls.onMinimize,
    },
    ...(controls.compact
      ? phonePlacementItems(controls)
      : [
          ...choices.map(({ target, label }) => ({
            label,
            run: () => controls.onSnap(target),
          })),
          { label: "Float window", run: controls.onFloat },
        ]),
  ];
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
      ?.querySelector<HTMLButtonElement>(
        '[aria-checked="true"], [role^="menuitem"]',
      )
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
              window.innerHeight - (controls.color ? 290 : 250) * scale - 8,
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
              '[role^="menuitem"], .color-swatch-button',
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
      {controls.next ? (
        <button
          type="button"
          className={`world-window-next ${controls.next.urgent ? "is-urgent" : ""}`}
          aria-label={`Next agent that needs you (${controls.next.count})`}
          title="Next agent that needs you"
          onClick={controls.next.onNext}
        >
          <span className="world-window-next-label">Next</span>
          {controls.next.count > 0 ? (
            <span className="world-window-next-count">
              {controls.next.count}
            </span>
          ) : null}
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button
        ref={trigger}
        type="button"
        aria-label={`More actions for ${label}`}
        title="More window actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} />
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
      {controls.back ? null : (
        <button
          type="button"
          aria-label={`Close ${label}`}
          title="Close window"
          onClick={controls.onClose}
        >
          <X size={16} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            style={{
              ...position,
              maxHeight: `calc(100dvh - ${(position.top ?? 8) + 8}px)`,
            }}
            className="world-window-snap-menu"
            role="menu"
            aria-label="Window actions"
          >
            {items.map((item) => (
              <Fragment key={item.key ?? item.label}>
                {item.section ? (
                  <div
                    className="world-window-menu-section"
                    role="presentation"
                  >
                    {item.section}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={item.key ? "is-wide" : undefined}
                  role={
                    item.checked === undefined ? "menuitem" : "menuitemradio"
                  }
                  aria-checked={item.checked}
                  onClick={() => {
                    item.run();
                    setOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {item.detail ? <small>{item.detail}</small> : null}
                </button>
              </Fragment>
            ))}
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
