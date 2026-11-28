import { clock } from "../../clock";
/**
 * The town center's radial menu and its name plaque. Tapping the building
 * (or the plaque, or Enter on it) opens a ring of actions around the doors:
 * launch an agent, talk to the Town master and the town's other errands.
 * Escape, a press outside, Back on a phone or the hub closes it.
 *
 * An action with a `ring` (Buildings, #1261) opens the next ring around
 * itself: the entry that opened a ring is that ring's centre, as the town
 * center is the first ring's, and the same rule holds at every depth. There
 * the hub is Back, and Escape or a phone's Back return to the ring before
 * (each ring is its own layer on the layer stack); a press outside closes
 * them all.
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, X, type LucideIcon } from "lucide-react";
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
  /**
   * Choosing it opens a second ring of these actions, read when it opens,
   * instead of running (Buildings); `run` is then not called.
   */
  ring?: () => readonly TownCenterAction[];
  run(): void;
};

/** The most entries a ring is laid out for (the first ring's eight). */
const TOWN_CENTER_MOST = 8;

/**
 * Ring geometry in screen pixels: phones get larger medallions. Each label
 * sits outside the ring, beyond its icon, so no label covers another entry
 * or the ring at any depth. A phone keeps its side labels inside its width:
 * when a round ring would leave them too little room, the ring narrows into
 * an upright oval, tall enough to keep its medallions apart.
 */
export function townCenterRing(viewportWidth: number) {
  const known = RINGS.get(viewportWidth);
  if (known) return known;
  const ring = layOutRing(viewportWidth);
  RINGS.set(viewportWidth, ring);
  return ring;
}

type TownCenterRadius = { x: number; y: number };
type TownCenterGeometry = ReturnType<typeof layOutRing>;
/** Ring geometry by view width: places it each frame, so laid out once. */
const RINGS = new Map<number, TownCenterGeometry>();

/** The nearest two neighbouring medallions come, in any ring up to eight. */
function townCenterClosest(radius: TownCenterRadius) {
  let closest = Infinity;
  for (let count = 2; count <= TOWN_CENTER_MOST; count += 1)
    for (let index = 0; index < count; index += 1) {
      const a = townCenterSpot(index, count, radius);
      const b = townCenterSpot((index + 1) % count, count, radius);
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    }
  return closest;
}

function layOutRing(viewportWidth: number) {
  const phone = viewportWidth < 640;
  const item = phone ? 56 : 52;
  /** From a medallion's middle to where its label starts. */
  const beyond = item / 2 + (phone ? 4 : 6);
  const labelWidth = phone ? 120 : 132;
  const half = Math.floor(viewportWidth / 2) - 2;
  // A phone's side label gets 92 px (a long building name), down to 56 px.
  const x = phone ? Math.max(56, Math.min(96, half - 92 - beyond)) : 96;
  // Neighbouring medallions stay 10 px apart, edge to edge.
  const apart = item + 10;
  let y = x;
  while (y < 4 * x && townCenterClosest({ x, y }) < apart) y += 2;
  return {
    /** The ring's half-width and half-height, through the medallions. */
    radius: { x, y },
    item,
    beyond,
    /** The widest a label grows before its text ends in an ellipsis. */
    labelWidth,
    /** How far the ring and its labels reach from its middle. */
    reach: {
      x: phone ? Math.min(x + beyond + labelWidth, half) : x + beyond + 132,
      top: y + beyond + 40,
      bottom: y + beyond + 40,
    },
  };
}

/**
 * Where entry `index` of `count` puts its label: `at`, beyond its icon
 * (from the entry's ring point), `align` the label's side on `at` (−1 to
 * 1 on each axis: 1 starts the label there and grows it outward), and the
 * widest it may be to stay inside the ring's reach.
 * @internal Exported for tests.
 */
export function townCenterLabel(
  index: number,
  count: number,
  ring: ReturnType<typeof townCenterRing>,
) {
  const spot = townCenterSpot(index, count, ring.radius);
  const { x: cos, y: sin } = spot.out;
  const toward = (value: number) =>
    Math.max(-1, Math.min(1, Math.round(value * 200) / 100));
  const align = { x: toward(cos), y: toward(sin) };
  // The label's left and right edges stay within the ring's reach.
  const from = spot.x + ring.beyond * cos;
  const room = Math.min(
    align.x > -1 ? (2 * (ring.reach.x - from)) / (1 + align.x) : Infinity,
    align.x < 1 ? (2 * (ring.reach.x + from)) / (1 - align.x) : Infinity,
  );
  return {
    at: { x: Math.round(cos * ring.beyond), y: Math.round(sin * ring.beyond) },
    align,
    width: Math.max(0, Math.floor(Math.min(ring.labelWidth, room))),
  };
}

/** A ring's entry from its centre, in screen pixels. */
export type TownCenterStep = { x: number; y: number };

/**
 * Where the open ring centres: on the center's doors, moved just enough to
 * keep every action inside a `width` × `height` view, else the view's
 * middle. Each of `steps` (the entries that opened the rings after the
 * first) then moves the centre onto that entry, fitted again, so a ring
 * opens around the entry that opened it.
 */
export function townCenterMenuPoint(
  at: { x: number; y: number },
  width: number,
  height: number,
  steps: readonly TownCenterStep[] = [],
) {
  const { reach } = townCenterRing(width);
  const clamp = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
  const fit = (point: { x: number; y: number }) => ({
    x: clamp(point.x, reach.x, width - reach.x),
    y: clamp(point.y, reach.top, height - reach.bottom),
  });
  return steps.reduce(
    (centre, step) => fit({ x: centre.x + step.x, y: centre.y + step.y }),
    fit(at),
  );
}

/** Place `menu` at the ring point for a screen point in a view. */
export function placeTownCenterMenu(
  menu: HTMLElement,
  at: { x: number; y: number },
  width: number,
  height: number,
  steps: readonly TownCenterStep[] = [],
) {
  const point = townCenterMenuPoint(at, width, height, steps);
  menu.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
}

/**
 * Where entry `index` of `count` sits from its ring's centre.
 * @internal Exported for tests.
 */
export function townCenterStep(
  index: number,
  count: number,
  radius: TownCenterRadius,
): TownCenterStep {
  const spot = townCenterSpot(index, count, radius);
  return { x: Math.round(spot.x), y: Math.round(spot.y) };
}

/**
 * Entry `index` of `count` on a ring of half-axes `radius`: clockwise from
 * the top, evenly spaced along the ring's length (on a round ring, evenly
 * by angle), with `out` the unit direction from the centre through it.
 * @internal Exported for tests.
 */
export function townCenterSpot(
  index: number,
  count: number,
  radius: TownCenterRadius,
) {
  const along = townCenterAlong(index, count, radius);
  const x = Math.cos(along) * radius.x;
  const y = Math.sin(along) * radius.y;
  const length = Math.hypot(x, y) || 1;
  return { x, y, out: { x: x / length, y: y / length } };
}

/** An oval's cumulative length at evenly spaced angles, by its half-axes. */
const LENGTHS = new Map<string, Float64Array>();
const SAMPLES = 720;

/** The ellipse angle for entry `index` of `count`, evenly along its length. */
function townCenterAlong(
  index: number,
  count: number,
  radius: TownCenterRadius,
) {
  const start = townCenterAngle(0, 1);
  if (radius.x === radius.y) return townCenterAngle(index, count);
  const key = `${radius.x}:${radius.y}`;
  let lengths = LENGTHS.get(key);
  if (!lengths) {
    lengths = new Float64Array(SAMPLES + 1);
    for (let at = 1; at <= SAMPLES; at += 1) {
      const a = start + ((at - 1) * 2 * Math.PI) / SAMPLES;
      const b = start + (at * 2 * Math.PI) / SAMPLES;
      lengths[at] =
        lengths[at - 1]! +
        Math.hypot(
          (Math.cos(b) - Math.cos(a)) * radius.x,
          (Math.sin(b) - Math.sin(a)) * radius.y,
        );
    }
    LENGTHS.set(key, lengths);
  }
  const target = (index / count) * lengths[SAMPLES]!;
  let at = 1;
  while (at < SAMPLES && lengths[at]! < target) at += 1;
  const before = lengths[at - 1]!;
  const part = (target - before) / (lengths[at]! - before || 1);
  return start + ((at - 1 + part) * 2 * Math.PI) / SAMPLES;
}

/** One ring opened by an entry: its actions, around that entry. */
type TownCenterLevel = {
  from: TownCenterAction;
  actions: readonly TownCenterAction[];
  /** The entry from the previous ring's centre. */
  step: TownCenterStep;
};

/**
 * A ring after the first on the layer stack: Escape and a phone's Back leave
 * it for the ring before. Its element is its medallions only while it is the
 * ring shown, so leaving it keeps focus on the entry that opened it.
 */
function TownCenterLevelLayer({
  current,
  back,
}: {
  current: () => Element | null;
  back(): void;
}) {
  useLayer(true, back, { element: current });
  return null;
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
  /**
   * Position the ring for the camera as drawn (and again each frame), its
   * centre moved along `steps` onto the entry that opened it.
   */
  place(menu: HTMLElement, steps: readonly TownCenterStep[]): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  /** The shown ring's own medallions and hub. */
  const items = useRef<HTMLDivElement>(null);
  const opened = useRef(clock.monotonic());
  /** The rings opened after the first, innermost last. */
  const [levels, setLevels] = useState<readonly TownCenterLevel[]>([]);
  const depth = useRef(0);
  depth.current = levels.length;
  const inner = levels[levels.length - 1] ?? null;
  /** The action whose ring just closed, to take focus back. */
  const returnTo = useRef<string | null>(null);
  /** Leave the shown ring for the one before. */
  const back = () => {
    setLevels((open) => {
      returnTo.current = open[open.length - 1]?.from.id ?? null;
      return open.slice(0, -1);
    });
  };
  useLayer(true, onClose, { element: () => ref.current });
  useLayoutEffect(() => {
    if (ring.current)
      place(
        ring.current,
        levels.map((level) => level.step),
      );
    // Placed as each ring opens; frames re-place it as the camera moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels]);
  useLayoutEffect(() => {
    const target = returnTo.current;
    returnTo.current = null;
    const button = target
      ? ring.current?.querySelector<HTMLButtonElement>(
          `.town-center-action[data-action="${target}"]`,
        )
      : ring.current?.querySelector<HTMLButtonElement>(
          ".town-center-action:not([aria-disabled='true'])",
        );
    button?.focus({ preventScroll: true });
  }, [levels]);
  const shown = inner?.actions ?? actions;
  const ringKey =
    levels.map((level) => level.from.id).join("/") || "town-center";
  const geometry = townCenterRing(viewportWidth);
  const { radius, item } = geometry;
  // The style guide's icon sizes: a menu's 16 px, phone navigation's 22 px.
  const iconSize = item < 56 ? 16 : 22;
  const choose = (action: TownCenterAction, index: number) => {
    if (action.disabled) return;
    if (action.ring) {
      const opens = action.ring();
      const step = townCenterStep(index, shown.length, radius);
      setLevels((open) => [...open, { from: action, actions: opens, step }]);
      return;
    }
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
      {levels.map((level, index) => (
        <TownCenterLevelLayer
          key={`${index}:${level.from.id}`}
          current={() => (depth.current === index + 1 ? items.current : null)}
          back={back}
        />
      ))}
      <div
        className="town-center-backdrop"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          // The second press of a double tap that opened the ring stays.
          if (clock.monotonic() - opened.current > 300) onClose();
        }}
      />
      <div
        ref={ring}
        className="town-center-ring"
        role="menu"
        aria-label={inner ? inner.from.label : "Town center"}
        data-ring={ringKey}
        style={
          {
            "--ring-x": `${radius.x}px`,
            "--ring-y": `${radius.y}px`,
            "--ring-item": `${item}px`,
          } as React.CSSProperties
        }
        onKeyDown={keyDown}
      >
        <div
          key={`track:${ringKey}`}
          className="town-center-track"
          data-help="town.center"
          aria-hidden="true"
        />
        {/* Keyed by ring, so a ring's medallions open afresh. */}
        <div
          key={ringKey}
          ref={items}
          className="town-center-items"
          role="none"
        >
          {shown.map((action, index) => {
            const spot = townCenterStep(index, shown.length, radius);
            const label = townCenterLabel(index, shown.length, geometry);
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
                aria-haspopup={action.ring ? "menu" : undefined}
                aria-label={[
                  action.label,
                  action.count ? `${action.count} waiting` : null,
                  action.detail,
                ]
                  .filter(Boolean)
                  .join(", ")}
                style={
                  {
                    "--dx": `${spot.x}px`,
                    "--dy": `${spot.y}px`,
                    "--delay": `${index * 18}ms`,
                    "--lx": `${label.at.x}px`,
                    "--ly": `${label.at.y}px`,
                    "--ax": label.align.x,
                    "--ay": label.align.y,
                    "--label-width": `${label.width}px`,
                  } as React.CSSProperties
                }
                onClick={() => choose(action, index)}
              >
                <span className="town-center-medallion" aria-hidden="true">
                  <Icon size={iconSize} strokeWidth={2} />
                  {action.count ? <b>{action.count}</b> : null}
                </span>
                <span className="town-center-label" aria-hidden="true">
                  <span>{action.label}</span>
                  {action.detail ? <small>{action.detail}</small> : null}
                </span>
              </button>
            );
          })}
          {inner ? (
            // The entry that opened this ring is its centre, and Back.
            <button
              type="button"
              className="town-center-hub"
              data-hub="back"
              data-from={inner.from.id}
              aria-label={`Back to ${levels[levels.length - 2]?.from.label ?? "town center"}`}
              title="Back"
              onClick={back}
            >
              <ArrowLeft size={iconSize} strokeWidth={2} aria-hidden="true" />
              <span className="town-center-label" aria-hidden="true">
                {inner.from.label}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="town-center-hub"
              aria-label="Close town center"
              onClick={onClose}
            >
              <X size={iconSize} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
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
      data-help-opens="town.center"
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
