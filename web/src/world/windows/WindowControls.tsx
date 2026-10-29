import {
  INTEREST_CHOICES,
  type InterestChoice,
} from "../../components/InterestButton";
import {
  ChevronLeft,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pin,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ColorChoice,
  ColorSwatchButton,
  type ColorValue,
} from "../../components/ColorSwatch";
import { measuredFixedPositionScale } from "../../fixedPositionScale";
import { useLayer } from "../../layerStack";
import type { SnapTarget } from "./windowManager";
import "./windows.css";
import { previewWindowSnap } from "./windowSnapPreview";

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
  /** An agent window's Town desk pin (useDeskPins.ts), toggled in its menu. */
  pin?: { pinned: boolean; onPin(pinned: boolean): void } | null;
  /** Close is shown as Back at the start of the bar, as Town's window does. */
  back?: { label: string };
  /** A narrow window: maximize joins ⋯ so the bar still fits. */
  narrow?: boolean;
  /** On a phone, the window's views live in ⋯ instead of the bar. */
  views?: readonly {
    id: string;
    label: string;
    checked: boolean;
    onSelect(): void;
  }[];
  /** Mobile Inspector attention settings, independent of the selected view. */
  attention?: InterestChoice | null;
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
  label = "window",
}: {
  controls: ManagedWindowControls;
  label?: string;
}) {
  if (!controls.back) return null;
  // It closes the window, so it keeps the window's Close name; the tooltip
  // says where Back leads.
  return (
    <button
      type="button"
      className="world-window-back"
      aria-label={`Close ${label}`}
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
  /** A setting turned on and off (the desk pin), not a choice among views. */
  toggle?: boolean;
  section?: string;
  preview?: SnapTarget;
  run(): void;
};

/**
 * The window bar keeps maximise and close as buttons. The rarer actions
 * (minimise, snap, float and the colour) share ⋯.
 */
export function WindowControls({
  controls,
  label = "window",
}: {
  controls: ManagedWindowControls;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const pinItems: MenuItem[] = controls.pin
    ? [
        {
          key: "pin",
          label: controls.pin.pinned
            ? "Unpin desk in Town"
            : "Pin desk in Town",
          checked: controls.pin.pinned,
          toggle: true,
          run: () => controls.pin?.onPin(!controls.pin.pinned),
        },
      ]
    : [];
  const items: MenuItem[] = [
    ...(controls.compact ? pinItems : []),
    ...(controls.views ?? []).map((view, index) => ({
      key: `view:${view.id}`,
      label: view.label,
      checked: view.checked,
      section: index === 0 ? "View" : undefined,
      run: view.onSelect,
    })),
    ...(controls.attention
      ? INTEREST_CHOICES.map((choice, index) => ({
          key: `attention:${choice.id}`,
          label: choice.label,
          detail:
            controls.attention?.quiet && choice.id === "watching"
              ? "Quiet while an agent is focused"
              : choice.hint,
          checked: controls.attention?.current === choice.id,
          section: index === 0 ? "Attention" : undefined,
          run: () => controls.attention?.onInterest(choice.id),
        }))
      : []),
    ...(controls.switchTo ?? []).map((target, index) => ({
      key: `switch:${target.id}`,
      label: target.label,
      detail: target.detail,
      section: index === 0 ? "Switch to" : undefined,
      run: target.onSelect,
    })),
    ...(controls.narrow
      ? [
          {
            label: controls.maximized ? "Restore" : "Maximize",
            section:
              controls.views?.length ||
              controls.switchTo?.length ||
              controls.attention
                ? "Window"
                : undefined,
            run: controls.onMaximize,
          },
        ]
      : []),
    {
      label: "Minimize",
      section: controls.narrow
        ? undefined
        : controls.views?.length ||
            controls.switchTo?.length ||
            controls.attention
          ? "Window"
          : undefined,
      run: controls.onMinimize,
    },
    ...(controls.compact
      ? []
      : [
          ...choices.map(({ target, label }) => ({
            label,
            preview: target,
            run: () => controls.onSnap(target),
          })),
          ...(["fit-left", "fit-right"] as const).map((target, index) => ({
            label: target === "fit-left" ? "Fit left" : "Fit right",
            section: index === 0 ? "Default size" : undefined,
            preview: target,
            run: () => controls.onSnap(target),
          })),
          { label: "Float window", run: controls.onFloat },
        ]),
    ...(!controls.compact ? pinItems : []),
  ];
  const host = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) previewWindowSnap(host.current, null);
  }, [open]);
  useLayer(open, () => setOpen(false), {
    element: () => menu.current,
    anchors: () => [trigger.current],
  });
  useEffect(() => {
    if (!open) return;
    // The checked item (the current view) first, else the first item.
    const items = menu.current;
    (
      items?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      ) ??
      items?.querySelector<HTMLButtonElement>(
        '[role^="menuitem"]:not(.world-window-pin)',
      )
    )?.focus();
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
      {!controls.compact && !controls.narrow && (
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
            // The menu is portaled out of the window, so it carries the
            // window's dark scope (Town) with it.
            className={`world-window-snap-menu ${
              host.current?.closest(".theme-scope-dark")
                ? "theme-scope-dark"
                : ""
            }`}
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
                  className={
                    item.toggle
                      ? "is-wide world-window-pin"
                      : item.key
                        ? "is-wide"
                        : undefined
                  }
                  title={
                    item.toggle
                      ? "A pinned desk keeps its place in Town, and its agents stay at it"
                      : undefined
                  }
                  role={
                    item.checked === undefined
                      ? "menuitem"
                      : item.toggle
                        ? "menuitemcheckbox"
                        : "menuitemradio"
                  }
                  aria-checked={item.checked}
                  onMouseEnter={() =>
                    previewWindowSnap(host.current, item.preview ?? null)
                  }
                  onMouseLeave={() => previewWindowSnap(host.current, null)}
                  onFocus={() =>
                    previewWindowSnap(host.current, item.preview ?? null)
                  }
                  onBlur={() => previewWindowSnap(host.current, null)}
                  onClick={() => {
                    item.run();
                    setOpen(false);
                  }}
                >
                  {item.toggle ? <Pin size={14} aria-hidden="true" /> : null}
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
