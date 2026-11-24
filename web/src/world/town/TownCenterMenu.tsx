/**
 * The town center's radial menu and its name plaque. Tapping the building
 * (or the plaque, or Enter on it) opens a ring of actions around the doors:
 * launch an agent, talk to the Town master and the town's other errands.
 * Escape, a press outside, Back on a phone or the hub closes it.
 */

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { X, type LucideIcon } from "lucide-react";
import { useLayer } from "../../layerStack";
import { TOWN_TILE as T } from "./townLayout";
import { townCenterEmblem, type TownCenterLot } from "./townCenter";
import "./townCenter.css";

/** One action on the ring. */
export type TownCenterAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** A short second line: the Town master's name, why it is unavailable. */
  detail?: string;
  /** A count on the medallion (Needs you), part of its accessible name. */
  count?: number;
  /** Shown but not usable (its detail says why). */
  disabled?: boolean;
  /** The ring's first and brightest action. */
  primary?: boolean;
  run(): void;
};

/** Ring geometry in screen pixels: phones get larger medallions. */
export function townCenterRing(viewportWidth: number) {
  const phone = viewportWidth < 640;
  const radius = phone ? 100 : 96;
  const item = phone ? 56 : 52;
  return {
    radius,
    item,
    /** How far the ring and its labels reach from its middle. */
    reach: {
      x: radius + item / 2 + 24,
      top: radius + item / 2 + 8,
      bottom: radius + item / 2 + 40,
    },
  };
}

/**
 * Where the ring centres: on the center's doors, moved just enough to keep
 * every action inside a `width` × `height` view, else the view's middle.
 */
export function townCenterMenuPoint(
  at: { x: number; y: number },
  width: number,
  height: number,
) {
  const { reach } = townCenterRing(width);
  const clamp = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
  return {
    x: clamp(at.x, reach.x, width - reach.x),
    y: clamp(at.y, reach.top, height - reach.bottom),
  };
}

/** Place `menu` at the ring point for a screen point in a view. */
export function placeTownCenterMenu(
  menu: HTMLElement,
  at: { x: number; y: number },
  width: number,
  height: number,
) {
  const point = townCenterMenuPoint(at, width, height);
  menu.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
}

/** The ring's angle for item `index` of `count`, clockwise from the top. */
export const townCenterAngle = (index: number, count: number) =>
  -Math.PI / 2 + (index * 2 * Math.PI) / count;

export function TownCenterMenu({
  actions,
  viewportWidth,
  place,
  onClose,
}: {
  actions: readonly TownCenterAction[];
  viewportWidth: number;
  /** Position the ring for the camera as drawn (and again each frame). */
  place(menu: HTMLElement): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const opened = useRef(performance.now());
  useLayer(true, onClose, { element: () => ref.current });
  useLayoutEffect(() => {
    if (ring.current) place(ring.current);
    const first = ring.current?.querySelector<HTMLButtonElement>(
      ".town-center-action:not([aria-disabled='true'])",
    );
    first?.focus({ preventScroll: true });
    // Positioned once on open; frames re-place it as the camera moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { radius, item } = townCenterRing(viewportWidth);
  // The style guide's icon sizes: a menu's 16 px, phone navigation's 22 px.
  const iconSize = item < 56 ? 16 : 22;
  const choose = (action: TownCenterAction) => {
    if (action.disabled) return;
    onClose();
    action.run();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(ring.current?.querySelectorAll<HTMLButtonElement>(
        ".town-center-action",
      ) ?? []),
    ];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : null;
    if (next === null || !buttons.length) return;
    event.preventDefault();
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div ref={ref} className="town-center-layer">
      <div
        className="town-center-backdrop"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          // The second press of a double tap that opened the ring stays.
          if (performance.now() - opened.current > 300) onClose();
        }}
      />
      <div
        ref={ring}
        className="town-center-ring"
        role="menu"
        aria-label="Town center"
        style={
          {
            "--ring-radius": `${radius}px`,
            "--ring-item": `${item}px`,
          } as React.CSSProperties
        }
        onKeyDown={keyDown}
      >
        <div className="town-center-track" aria-hidden="true" />
        {actions.map((action, index) => {
          const angle = townCenterAngle(index, actions.length);
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="town-center-action"
              data-action={action.id}
              data-primary={action.primary || undefined}
              aria-disabled={action.disabled || undefined}
              aria-label={[
                action.label,
                action.count ? `${action.count} waiting` : null,
                action.detail,
              ]
                .filter(Boolean)
                .join(", ")}
              style={
                {
                  "--dx": `${Math.round(Math.cos(angle) * radius)}px`,
                  "--dy": `${Math.round(Math.sin(angle) * radius)}px`,
                  "--delay": `${index * 18}ms`,
                } as React.CSSProperties
              }
              onClick={() => choose(action)}
            >
              <span className="town-center-medallion" aria-hidden="true">
                <Icon size={iconSize} strokeWidth={2} />
                {action.count ? <b>{action.count}</b> : null}
              </span>
              <span className="town-center-label" aria-hidden="true">
                {action.label}
                {action.detail ? <small>{action.detail}</small> : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="town-center-hub"
          aria-label="Close town center"
          onClick={onClose}
        >
          <X size={iconSize} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * The center's name plaque on its frieze: a button that opens the ring, so
 * the menu is one Tab and Enter away. Focus brings the center into view.
 */
export function TownCenterSign({
  center,
  open,
  onOpen,
  onFocus,
}: {
  center: TownCenterLot;
  open: boolean;
  onOpen?: () => void;
  onFocus?: () => void;
}) {
  const at = townCenterEmblem(center, T);
  return (
    <button
      type="button"
      className="town-center-sign"
      style={{ left: at.x, top: at.y }}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={!onOpen}
      onFocus={onFocus}
      onClick={onOpen}
    >
      Town center
    </button>
  );
}
