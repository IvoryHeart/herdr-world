/**
 * The map's part of Town's group selection (#820): Shift+drag draws a box
 * that adds every agent drawn inside it, wherever it stands (desk,
 * reception, bar); Shift+click toggles the agent (or a table's agents) under
 * the pointer. Plain drags and clicks never reach this, so they still pan
 * and open. Agents in a folded room are not drawn, so a box leaves them out.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { TownHit } from "./townHitTest";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import type { TownSceneCamera } from "./scene/townSceneCamera";
import { townBoxKeys, townGroupFrame } from "./townGroup";
import { useTownGroupContext } from "./useTownGroup";

type Point = { x: number; y: number };

/** A press that moves less than this (screen px) is a Shift+click. */
const CLICK_SLOP = 5;

/** The agents a Shift+click toggles: the agent hit, or a table's agents. */
export function townHitAgents(hit: TownHit | null, model: TownModel) {
  if (!hit) return [];
  if (hit.kind === "agent") return model.agents.has(hit.key) ? [hit.key] : [];
  if (hit.kind === "pane") {
    const agentKey = model.devices.get(hit.key)?.agentKey;
    return agentKey ? [agentKey] : [];
  }
  if (hit.kind === "desk")
    return (model.desks.get(hit.key)?.paneDevices ?? []).flatMap((device) =>
      device.agentKey ? [device.agentKey] : [],
    );
  return [];
}

export type TownBoxPorts = {
  /** Canvas point to world point, against the frame last drawn. */
  toWorld(at: Point): Point | null;
  model(): TownModel;
  /** Where an agent is drawn now; null when it is not on the map. */
  position(key: string): Point | null;
  /** The screen box to draw, or null to remove it. */
  draw(
    box: { x: number; y: number; width: number; height: number } | null,
  ): void;
  add(keys: readonly string[]): void;
  toggle(keys: readonly string[]): void;
  /** The chosen agents now. */
  keys(): ReadonlySet<string>;
  /** Whether a selection is open. */
  selecting(): boolean;
};

/** One Shift press on the map: a box, or a click if it barely moved. */
export class TownBoxSelect {
  private press: {
    id: number;
    from: Point;
    to: Point;
    hit: { hitAt(x: number, y: number): TownHit | null };
  } | null = null;

  constructor(private readonly ports: TownBoxPorts) {}

  /** The chosen agents, for the scene's rings. */
  keys() {
    return this.ports.keys();
  }

  /** While a selection is open a touch tap toggles, so a table's card waits. */
  selecting() {
    return this.ports.selecting();
  }

  /** True when this press is the box's: a primary mouse button with Shift. */
  down(
    pointer: {
      pointerId: number;
      pointerType: string;
      button: number;
      shiftKey: boolean;
    },
    at: Point,
    hit: { hitAt(x: number, y: number): TownHit | null },
  ) {
    if (
      !pointer.shiftKey ||
      pointer.pointerType !== "mouse" ||
      pointer.button !== 0
    )
      return false;
    this.press = { id: pointer.pointerId, from: at, to: at, hit };
    return true;
  }

  move(id: number, at: Point) {
    const press = this.press;
    if (!press || press.id !== id) return false;
    press.to = at;
    if (this.dragged())
      this.ports.draw({
        x: Math.min(press.from.x, at.x),
        y: Math.min(press.from.y, at.y),
        width: Math.abs(at.x - press.from.x),
        height: Math.abs(at.y - press.from.y),
      });
    return true;
  }

  up(id: number, at: Point, cancel: boolean) {
    const press = this.press;
    if (!press || press.id !== id) return false;
    this.press = null;
    this.ports.draw(null);
    if (cancel) return true;
    press.to = at;
    const model = this.ports.model();
    if (!this.dragged(press))
      this.ports.toggle(
        townHitAgents(press.hit.hitAt(press.from.x, press.from.y), model),
      );
    else {
      const a = this.ports.toWorld(press.from);
      const b = this.ports.toWorld(at);
      if (a && b)
        this.ports.add(
          townBoxKeys(
            { x0: a.x, y0: a.y, x1: b.x, y1: b.y },
            model.agents.keys(),
            (key) => this.ports.position(key),
          ),
        );
    }
    return true;
  }

  private dragged(press = this.press) {
    return (
      !!press &&
      Math.hypot(press.to.x - press.from.x, press.to.y - press.from.y) >=
        CLICK_SLOP
    );
  }
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The canvas's selection: the box, the chosen keys for the rings, binned
 * agents leaving, and Show them framing the chosen agents.
 */
export function useTownGroupCanvas(
  renderer: RefObject<TownRendererHandle | null>,
  host: RefObject<HTMLDivElement | null>,
  view: TownSceneCamera,
  model: TownModel,
  /** Agents put in the bin: they leave the selection. */
  away: ReadonlySet<string>,
) {
  const group = useTownGroupContext();
  const latest = useRef({ group, model });
  latest.current = { group, model };
  const position = (key: string) =>
    renderer.current?.actorPosition(key) ?? null;
  const [box] = useState(() => {
    let element: HTMLDivElement | null = null;
    return new TownBoxSelect({
      toWorld: (at) => {
        const drawn = view.drawn;
        if (drawn.z)
          return {
            x: drawn.x + (at.x - drawn.width / 2) / drawn.z,
            y: drawn.y + (at.y - drawn.height / 2) / drawn.z,
          };
        return renderer.current?.camera.toWorld(at.x, at.y) ?? null;
      },
      model: () => latest.current.model,
      position,
      draw: (rect) => {
        if (!rect) {
          element?.remove();
          element = null;
          return;
        }
        if (!element) {
          element = document.createElement("div");
          element.className = "town-select-box";
          element.setAttribute("aria-hidden", "true");
          host.current?.append(element);
        }
        Object.assign(element.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      },
      add: (keys) => latest.current.group?.add(keys),
      toggle: (keys) => latest.current.group?.toggle(keys),
      keys: () => latest.current.group?.keys ?? NONE,
      selecting: () => !!latest.current.group?.open,
    });
  });
  useEffect(() => {
    if (away.size) latest.current.group?.prune((key) => !away.has(key));
  }, [away]);
  const framer = group?.framer;
  useEffect(() => {
    if (!framer) return;
    framer.current = (keys) => {
      const rect = townGroupFrame(
        keys.flatMap((key) => {
          const at = position(key);
          return at ? [at] : [];
        }),
      );
      if (rect) view.frameRect(rect);
    };
    return () => {
      framer.current = null;
    };
    // position reads the renderer ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framer, view]);
  /** The chosen agents: a new set when the selection changes. */
  return { box, keys: group?.keys ?? NONE };
}
