/**
 * The steps Town's thought bubbles show, by agent key. Town names the agents
 * it wants steps for (working agents in rooms on screen at the room or desk
 * level); a reader (useTownStepReads) reads only those and sets their steps.
 * Each bubble subscribes to its own agent, so a step change renders one
 * bubble, not the town.
 */

import { TOWN_TILE as T } from "./townLayout";
import type { TownStep } from "./townSteps";

/** The same agents, in any order: panning reorders them, nothing more. */
const sameKeys = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
};

const sameStep = (a: TownStep | undefined, b: TownStep | undefined) =>
  a === b ||
  (!!a && !!b && a.kind === b.kind && a.since === b.since && a.task === b.task);

export class TownStepStore {
  private wanted: readonly string[] = [];
  private steps: ReadonlyMap<string, TownStep> = new Map();
  private glyphs: ReadonlySet<string> = new Set();
  private readonly byKey = new Map<string, Set<() => void>>();
  private readonly wantListeners = new Set<() => void>();
  private readonly glyphListeners = new Set<() => void>();

  /** The agents Town wants steps for, nearest first. */
  want(keys: readonly string[]) {
    const next = [...keys];
    if (sameKeys(next, this.wanted)) return;
    this.wanted = next;
    // An agent no longer wanted shows no step: it left the screen or the
    // room level, or stopped working.
    const kept = new Set(next);
    const steps = new Map([...this.steps].filter(([key]) => kept.has(key)));
    if (steps.size !== this.steps.size) this.set(steps);
    for (const listener of [...this.wantListeners]) listener();
  }

  wantedKeys() {
    return this.wanted;
  }

  onWant(listener: () => void) {
    this.wantListeners.add(listener);
    return () => void this.wantListeners.delete(listener);
  }

  /** Replace every step; only agents whose step changed are told. */
  set(steps: ReadonlyMap<string, TownStep>) {
    const prior = this.steps;
    this.steps = steps;
    const changed = new Set<string>();
    for (const [key, step] of steps)
      if (!sameStep(prior.get(key), step)) changed.add(key);
    for (const key of prior.keys()) if (!steps.has(key)) changed.add(key);
    if (!changed.size) return;
    for (const key of changed)
      for (const listener of [...(this.byKey.get(key) ?? [])]) listener();
    const glyphs = new Set(steps.keys());
    if (
      glyphs.size !== this.glyphs.size ||
      [...glyphs].some((key) => !this.glyphs.has(key))
    ) {
      this.glyphs = glyphs;
      for (const listener of [...this.glyphListeners]) listener();
    }
  }

  get(key: string): TownStep | undefined {
    return this.steps.get(key);
  }

  /** Agents showing a step bubble: their typing dots give way to it. */
  glyphKeys(): ReadonlySet<string> {
    return this.glyphs;
  }

  /** Whether an agent shows a step bubble; one function for every frame. */
  readonly hasGlyph = (key: string) => this.glyphs.has(key);

  onGlyphs(listener: () => void) {
    this.glyphListeners.add(listener);
    return () => void this.glyphListeners.delete(listener);
  }

  subscribe(key: string, listener: () => void) {
    let listeners = this.byKey.get(key);
    if (!listeners) this.byKey.set(key, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.byKey.delete(key);
    };
  }
}

/** The world rectangle on screen, in pixels. */
export type TownStepView = { x0: number; y0: number; x1: number; y1: number };

/**
 * The agents whose steps Town wants at the room or desk level: working
 * agents (an asking agent's bubble is its question) at desks on screen,
 * nearest the middle of the screen first, so the nearest are read first.
 * Every one is wanted: the room and desk levels bound how many are on
 * screen, and the reads take them in turns (TOWN_STEP_BATCH).
 */
export function townStepWanted(
  rooms: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
    cells: readonly { x: number; y: number; deskKey: string | null }[];
  }[],
  view: TownStepView,
  agentsAt: (deskKey: string) => readonly string[],
  working: (agentKey: string) => boolean,
): string[] {
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const off = (x: number, y: number, w: number, h: number) =>
    x > view.x1 || x + w < view.x0 || y > view.y1 || y + h < view.y0;
  const found: { key: string; distance: number }[] = [];
  for (const room of rooms) {
    if (off(room.x * T, room.y * T, room.w * T, room.h * T)) continue;
    for (const cell of room.cells) {
      if (!cell.deskKey) continue;
      // A desk's cell is five tiles square: its aisle, then its table.
      const x = cell.x * T;
      const y = cell.y * T;
      if (off(x, y, 5 * T, 5 * T)) continue;
      const distance = Math.hypot(x + 2.5 * T - cx, y + 2.5 * T - cy);
      for (const key of agentsAt(cell.deskKey))
        if (working(key)) found.push({ key, distance });
    }
  }
  return found
    .sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1))
    .map(({ key }) => key);
}
