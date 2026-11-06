/**
 * Town's scene model: what the town is, derived from its semantic inputs,
 * headless. TownCanvas is its adapter: it hands in the projection, documents
 * and the user's presses, and draws what comes back. Time comes only through
 * the clock port, so every rule here runs on a test clock.
 *
 * This first slice holds the semantic state: the model with its colours and
 * pins, placement with its memory per shape, the reflow hold, teams, targets,
 * desk badges and when agents became blocked. Camera, interaction and the
 * renderer's dirty sets join it in later steps (research/town-scene-model.md).
 */

import type { WorldSourcesSnapshot } from "../../../../../shared/worldSources";
import type { Relation } from "../../../../../shared/relations";
import type { HerdrOfficeProjection } from "../../herdrOfficeProjection";
import type { TerminalPlace } from "../../relations";
import type { TerminalColor, TerminalColors } from "../../terminalColor";
import type { DeskPins } from "../../useDeskPins";
import {
  sameTownBadges,
  townDeskBadges,
  type TownDeskBadge,
} from "../townBadges";
import {
  layoutTown,
  townGeometryKey,
  townPinCell,
  townShapeKey,
  type TownLayout,
  type TownPlacementMemory,
  type TownShape,
} from "../townLayout";
import {
  keepPlaceColors,
  NO_PLACE_COLORS,
  townDeskColors,
  townDeskPins,
  townModelFromProjection,
  townPinnedCells,
  townPlaceColors,
  type TownDeskPin,
  type TownModel,
  type TownPlaceColors,
} from "../townModel";
import { townTargets, type TownTarget } from "../townTargets";
import { townTeams, type TownTeams } from "../townTeams";
import type { TownClock } from "./ports";

/**
 * A reflow that moves rooms or buildings waits this long after the user's last
 * press, scroll or zoom, so the town does not shift under a hand or eye.
 */
export const TOWN_REFLOW_IDLE_MS = 1200;

export type TownSemanticInputs = {
  projection: HerdrOfficeProjection;
  /** Saved terminal colours (useTerminalColors); desks use their tab's. */
  terminalColors: TerminalColors;
  /** Saved desk pins (useDeskPins); a pinned desk keeps its cell. */
  deskPins: DeskPins;
  /** Which terminals know each other (world/relations.ts). */
  relations: {
    relations: readonly Relation[];
    places: ReadonlyMap<string, TerminalPlace>;
  };
  /** World sources, for pull request and ticket chips on desks. */
  sources: WorldSourcesSnapshot;
  /** The town's shape, from its container. */
  shape: TownShape;
  /** Explicit Fold/Expand admission revision, committed with its projection. */
  foldRevision: number;
};

export type TownSemantics = {
  model: TownModel;
  /** Where everything goes now. */
  placed: TownLayout;
  /** What is shown: `placed`, or the layout held while the user interacts. */
  layout: TownLayout;
  holding: boolean;
  teams: TownTeams;
  targets: readonly TownTarget[];
  deskBadges: ReadonlyMap<string, TownDeskBadge>;
  /** When each blocked agent became blocked (wall clock), for queue order. */
  blockedSince: ReadonlyMap<string, number>;
};

/** A pinned desk whose cell is not saved yet: save `cell` under `pinKey`. */
export type TownPinPlacement = {
  pinKey: string;
  cell: { col: number; row: number };
};

/** Recompute only when an argument changes identity, as `useMemo` does. */
function memo<A extends readonly unknown[], R>(compute: (...args: A) => R) {
  let deps: A | null = null;
  let value: R;
  return (...args: A): R => {
    if (
      deps === null ||
      deps.length !== args.length ||
      args.some((arg, index) => !Object.is(arg, deps![index]))
    ) {
      deps = args;
      value = compute(...args);
    }
    return value;
  };
}

export class TownScene {
  private readonly clock: TownClock;
  private readonly wake: () => void;
  private inputAt = 0;
  private pressing = false;
  private shown: TownLayout | null = null;
  private appliedFoldRevision: number | null = null;
  private cancelWake: (() => void) | null = null;
  private memory: { shape: string; memory: TownPlacementMemory } | null = null;
  private badges: ReadonlyMap<string, TownDeskBadge> = new Map();
  private deskColors: ReadonlyMap<string, TerminalColor> = new Map();
  private placeColors: TownPlaceColors = NO_PLACE_COLORS;
  private pins: ReadonlyMap<string, TownDeskPin> = new Map();
  private readonly blocked = new Map<string, number>();
  private readonly placing = new Set<string>();

  /**
   * `wake` asks the adapter to derive again: a held reflow re-checks whether
   * the user has paused.
   */
  constructor(clock: TownClock, wake: () => void) {
    this.clock = clock;
    this.wake = wake;
  }

  /* ---------- the user's hand: presses, scrolls and zooms ---------- */

  pointerDown() {
    this.pressing = true;
    this.touch();
  }

  pointerUp() {
    this.pressing = false;
    this.touch();
  }

  /** A scroll or zoom on the town. */
  touch() {
    this.inputAt = this.clock.now();
  }

  /* ---------- derivation ---------- */

  private readonly deriveBadges = memo(
    (projection: HerdrOfficeProjection, sources: WorldSourcesSnapshot) => {
      const next = townDeskBadges(projection, sources);
      if (!sameTownBadges(next, this.badges)) this.badges = next;
      return this.badges;
    },
  );

  private readonly topology = memo(townModelFromProjection);

  // Colours ride on the model but not its layout input: a new colour repaints
  // tables without placing the town again.
  private readonly coloured = memo(
    (
      topology: TownModel,
      projection: HerdrOfficeProjection,
      colors: TerminalColors,
    ): TownModel => {
      // The same colours keep the same map, so status updates never rebuild.
      const next = townDeskColors(projection, colors);
      const last = this.deskColors;
      if (
        next.size !== last.size ||
        [...next].some(([key, color]) => last.get(key) !== color)
      )
        this.deskColors = next;
      this.placeColors = keepPlaceColors(
        this.placeColors,
        townPlaceColors(projection, colors),
      );
      return {
        ...topology,
        deskColors: this.deskColors,
        placeColors: this.placeColors,
      };
    },
  );

  // Pins ride on the model too; the same pins keep the same map.
  private readonly pinned = memo(
    (
      coloured: TownModel,
      projection: HerdrOfficeProjection,
      pins: DeskPins,
    ): TownModel => {
      const next = townDeskPins(projection, pins);
      const last = this.pins;
      if (
        next.size !== last.size ||
        [...next].some(([key, pin]) => {
          const was = last.get(key);
          return (
            !was ||
            was.key !== pin.key ||
            was.cell?.col !== pin.cell?.col ||
            was.cell?.row !== pin.cell?.row
          );
        })
      )
        this.pins = next;
      return { ...coloured, deskPins: this.pins };
    },
  );

  private readonly pinnedCells = memo(townPinnedCells);

  // Placement depends only on topology and pins, not on agent status.
  private readonly place = memo(
    (
      input: TownModel["input"],
      shape: TownShape,
      cells: ReturnType<typeof townPinnedCells>,
    ) => {
      const key = townShapeKey(shape);
      const previous =
        this.memory?.shape === key ? this.memory.memory : new Map();
      const result = layoutTown(input, shape, previous, cells);
      this.memory = { shape: key, memory: result.memory };
      return result.layout;
    },
  );

  private readonly teamsOf = memo(
    (
      model: TownModel,
      layout: TownLayout,
      relations: TownSemanticInputs["relations"],
    ) => townTeams(model, layout, relations.relations, relations.places),
  );

  private readonly targetsOf = memo(
    (model: TownModel, layout: TownLayout, deskTeams: TownTeams["deskTeams"]) =>
      townTargets(model, layout, deskTeams),
  );

  derive(inputs: TownSemanticInputs): TownSemantics {
    const { projection, shape, foldRevision } = inputs;
    const deskBadges = this.deriveBadges(projection, inputs.sources);
    const model = this.pinned(
      this.coloured(
        this.topology(projection),
        projection,
        inputs.terminalColors,
      ),
      projection,
      inputs.deskPins,
    );
    const placed = this.place(
      model.input,
      shape,
      this.pinnedCells(model.deskPins),
    );
    // While the user presses, scrolls or zooms, a reflow that would move rooms
    // or buildings waits until they pause (then the camera follows the room in
    // view). Explicit Fold/Expand applies immediately; its admission and
    // revision arrive together. A held layout must still name only valid desks.
    const explicit =
      this.appliedFoldRevision !== null &&
      foldRevision !== this.appliedFoldRevision;
    this.appliedFoldRevision = foldRevision;
    const held = this.shown;
    const holding =
      !explicit &&
      held !== null &&
      held !== placed &&
      townShapeKey(held.shape) === townShapeKey(placed.shape) &&
      (this.pressing ||
        this.clock.now() - this.inputAt < TOWN_REFLOW_IDLE_MS) &&
      townGeometryKey(held) !== townGeometryKey(placed) &&
      held.buildings.every((b) =>
        b.rooms.every((r) =>
          r.cells.every((c) => !c.deskKey || model.desks.has(c.deskKey)),
        ),
      );
    const layout = holding ? held : placed;
    this.shown = layout;
    // A held reflow looks again a little later, until the user pauses.
    this.cancelWake?.();
    this.cancelWake = holding
      ? this.clock.after(TOWN_REFLOW_IDLE_MS / 3, () => {
          this.cancelWake = null;
          this.wake();
        })
      : null;
    const teams = this.teamsOf(model, layout, inputs.relations);
    // Track when agents became blocked so reception and the rail share age order.
    const now = this.clock.wall();
    for (const agent of model.agents.values()) {
      if (agent.semanticStatus === "blocked") {
        if (!this.blocked.has(agent.key)) this.blocked.set(agent.key, now);
      } else this.blocked.delete(agent.key);
    }
    return {
      model,
      placed,
      layout,
      holding,
      teams,
      targets: this.targetsOf(model, layout, teams.deskTeams),
      deskBadges,
      blockedSince: this.blocked,
    };
  }

  /**
   * Desks just pinned keep the cell they have: the cells to save now. Each is
   * returned once until `pinPlaced` reports its save finished.
   */
  pinPlacements(
    deskPins: TownModel["deskPins"],
    layout: TownLayout,
    placed: TownLayout,
  ): TownPinPlacement[] {
    const placements: TownPinPlacement[] = [];
    for (const [deskKey, pin] of deskPins) {
      if (pin.cell || this.placing.has(pin.key)) continue;
      const cell = townPinCell(layout, placed, deskKey);
      if (!cell) continue;
      this.placing.add(pin.key);
      placements.push({
        pinKey: pin.key,
        cell: { col: cell.col, row: cell.row },
      });
    }
    return placements;
  }

  pinPlaced(pinKey: string) {
    this.placing.delete(pinKey);
  }

  dispose() {
    this.cancelWake?.();
    this.cancelWake = null;
  }
}
