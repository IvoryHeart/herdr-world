/**
 * What the renderer is handed: the town now, and what changed since the
 * renderer last applied it. The scene computes the dirty sets; the renderer
 * applies them (townRenderer.ts `apply`), baking only dirty buildings and
 * reconciling only dirty hosts' agents.
 */

import type { TownLayout } from "../townLayout";
import type { TownModel } from "../townModel";
import {
  townActorDirty,
  townActorKeys,
  type TownActorKeys,
} from "./townSceneActors";
import {
  townBakeDirty,
  townBakeKeys,
  type TownBakeDirty,
  type TownBakeKeys,
} from "./townSceneBake";

/** The user's marks the renderer draws: selection, hover, seen, summoned, asking. */
export type TownSceneState = {
  selectedKey: string | null;
  hoverKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
  /** Agents the user opened, who walk back to their desks. */
  summonedKeys: ReadonlySet<string>;
  askingKeys?: ReadonlySet<string>;
  /** Building currently held open (for example while moving a desk). */
  openHostKey: string | null;
  calm: boolean;
};

export type TownSceneDirty = {
  /** A renderer's first frame: everything is placed at once. */
  first: boolean;
  /** The model or layout changed: drawn-each-frame state needs a state frame. */
  scene: boolean;
  bake: TownBakeDirty;
  /** The hosts whose agents to reconcile. */
  actors: ReadonlySet<string>;
};

export type TownSceneFrame = {
  model: TownModel;
  layout: TownLayout;
  state: TownSceneState;
  dirty: TownSceneDirty;
};

const NONE: ReadonlySet<string> = new Set();
const CLEAN: TownBakeDirty = { scene: false, buildings: NONE };

/** Tracks what one renderer has applied, and what it must apply next. */
export class TownSceneDiff {
  private model: TownModel | null = null;
  private layout: TownLayout | null = null;
  private state: TownSceneState | null = null;
  private bakeKeys: TownBakeKeys | null = null;
  private actorKeys: TownActorKeys | null = null;

  /** A new renderer has applied nothing yet. */
  reset() {
    this.model = this.layout = this.state = null;
    this.bakeKeys = this.actorKeys = null;
  }

  next(
    model: TownModel,
    layout: TownLayout,
    state: TownSceneState,
  ): TownSceneFrame {
    const was = this.model;
    const first = was === null;
    const scene = first || model !== was || layout !== this.layout;
    // Tables, carpets and roofs are baked with their colours, pins and host
    // state (townSceneBake.ts).
    let bake = CLEAN;
    if (
      first ||
      layout !== this.layout ||
      model.deskColors !== was.deskColors ||
      model.placeColors !== was.placeColors ||
      model.deskPins !== was.deskPins ||
      model.hosts !== was.hosts
    ) {
      const keys = townBakeKeys(model, layout);
      bake = townBakeDirty(this.bakeKeys, keys);
      this.bakeKeys = keys;
    }
    // Agents follow the model, the layout and the summoned and asking marks.
    let actors = NONE;
    const asking = state.askingKeys ?? NONE;
    if (
      scene ||
      state.summonedKeys !== this.state?.summonedKeys ||
      asking !== (this.state?.askingKeys ?? NONE)
    ) {
      const keys = townActorKeys(model, layout, state.summonedKeys, asking);
      actors =
        this.actorKeys === null
          ? new Set(keys.keys())
          : townActorDirty(this.actorKeys, keys);
      this.actorKeys = keys;
    }
    this.model = model;
    this.layout = layout;
    this.state = state;
    return {
      model,
      layout,
      state,
      dirty: { first, scene, bake, actors },
    };
  }
}
