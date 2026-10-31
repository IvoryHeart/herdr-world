/**
 * The Town renderer's standing and walking agents and their status bubbles:
 * each agent away from its seat as a retained sprite and shadow in its
 * building, and each bubble on the screen layer over its head. The renderer
 * steps these each frame through `update` and `updateBubbles`.
 */

import { Graphics, Sprite, Texture, type Container } from "pixi.js";
import type { TownActors } from "./townActors";
import type { TownAmbient } from "./townAmbient";
import { townAgentChatting, townBubbleKind } from "./townBubbleKind";
import type { TownCamera, TownLevel } from "./townCamera";
import { TOWN_AGENT_SCALE, townSeat, type TownCell } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownSceneState } from "./townRenderer";
import { textureOf, type BuildingView } from "./townRendererScene";
import { townActorViewsToDrop } from "./scene/townSceneBake";
import {
  townCharacter,
  townHash,
  type TownLook,
  type TownStaticSprites,
} from "./townSprites";

type ActorView = { sprite: Sprite; shadow: Graphics; look: TownLook };

/** What the agents' sprites read from the renderer that owns them. */
export type TownActorViewsContext = {
  camera: TownCamera;
  actors: TownActors;
  sprites: TownStaticSprites;
  screenLayer: Container;
  model(): TownModel | null;
  level(): TownLevel;
  /** The renderer's animation clock, in seconds. */
  clock(): number;
  state(): TownSceneState;
  /** This frame's record of when visible animation next changes. */
  ambient(): TownAmbient;
  layoutCells(): ReadonlyMap<string, TownCell>;
  buildingOf(hostKey: string): BuildingView | undefined;
  lookOf(key: string): TownLook;
  blink(key: string, onScreen: boolean): boolean;
  visible(sprite: Sprite | Graphics): boolean;
};

export function createTownActorViews(ctx: TownActorViewsContext) {
  const { camera, actors, sprites, screenLayer, lookOf } = ctx;
  const actorViews = new Map<string, ActorView>();
  const bubbles = new Map<string, Sprite>();
  /** All of them, or those of one building baked again (townActorViewsToDrop). */
  const drop = (hostKey?: string) => {
    const keys =
      hostKey === undefined
        ? [...actorViews.keys()]
        : townActorViewsToDrop(
            actorViews.keys(),
            (key) => actors.actors.get(key)?.hostKey,
            hostKey,
          );
    for (const key of keys) {
      const view = actorViews.get(key)!;
      view.sprite.destroy();
      view.shadow.destroy();
      actorViews.delete(key);
    }
  };

  const updateActors = (standingAlpha: number) => {
    const live = new Set<string>();
    for (const actor of actors.actors.values()) {
      if (actor.mode === "seat") continue;
      const building = ctx.buildingOf(actor.hostKey);
      if (!building || !building.container.visible) continue;
      live.add(actor.key);
      let view = actorViews.get(actor.key);
      if (!view) {
        const sprite = new Sprite(
          textureOf(
            townCharacter(lookOf(actor.key), actor.dir, 0, "stand", false),
          ),
        );
        const shadow = new Graphics()
          .rect(-5, -1, 10, 3)
          .fill({ color: 0x000000, alpha: 0.22 });
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(TOWN_AGENT_SCALE);
        shadow.scale.set(TOWN_AGENT_SCALE, 1);
        building.dynamic.addChild(shadow, sprite);
        view = { sprite, shadow, look: lookOf(actor.key) };
        actorViews.set(actor.key, view);
      }
      const moving = actor.mode === "walk";
      const frame = moving ? Math.floor(actor.walked / 6) % 4 : 0;
      const bob = moving && frame % 2 ? -1 : 0;
      view.look = lookOf(actor.key);
      view.sprite.position.set(
        Math.round(actor.x),
        Math.round(actor.y + 1 + bob),
      );
      view.sprite.zIndex = actor.y;
      view.shadow.position.set(Math.round(actor.x), Math.round(actor.y));
      view.shadow.zIndex = actor.y - 0.5;
      view.sprite.alpha = view.shadow.alpha = standingAlpha;
      view.sprite.visible = view.shadow.visible = standingAlpha > 0.02;
      view.sprite.texture = textureOf(
        townCharacter(
          view.look,
          actor.dir,
          frame,
          "stand",
          ctx.blink(actor.key, actor.dir !== "up" && ctx.visible(view.sprite)),
        ),
      );
    }
    for (const [key, view] of actorViews)
      if (!live.has(key)) {
        view.sprite.destroy();
        view.shadow.destroy();
        actorViews.delete(key);
      }
  };

  const updateBubbles = () => {
    const model = ctx.model();
    const level = ctx.level();
    const clock = ctx.clock();
    const state = ctx.state();
    const ambient = ctx.ambient();
    const layoutCells = ctx.layoutCells();
    const scale = Math.min(4, Math.max(2, Math.round(camera.z * 1.5)));
    const wanted = new Set<string>();
    if (model && level !== "town")
      for (const actor of actors.actors.values()) {
        const agent = model.agents.get(actor.key);
        if (!agent) continue;
        const status = agent.semanticStatus;
        const near = level === "room" || level === "desk";
        const chatting = townAgentChatting(
          agent.key,
          clock,
          level,
          status,
          actor.mode,
          !state.calm && !camera.reducedMotion,
        );
        const kind = townBubbleKind(
          status,
          state.askingKeys?.has(agent.key) ?? false,
          state.completionSeenKeys.has(agent.key),
          level,
          actor.mode,
          chatting,
          Math.floor(clock * 3),
        );
        let headX = actor.x;
        let headY = actor.y - 20 * TOWN_AGENT_SCALE;
        if (actor.mode === "seat") {
          const seat = model.agentSeats.get(actor.key);
          const cell = seat && layoutCells.get(seat.deskKey);
          if (cell && seat) {
            const geometry = townSeat(cell, seat.seat);
            headX = geometry.cx;
            headY = geometry.top
              ? geometry.tableY + 24 - 20 * TOWN_AGENT_SCALE
              : geometry.tableY + 33;
          }
        }
        const point = camera.toScreen(headX, headY);
        if (
          point.x < -40 ||
          point.y < -40 ||
          point.x > camera.viewport.width + 40 ||
          point.y > camera.viewport.height + 40
        )
          continue;
        if (
          near &&
          status === "working" &&
          actor.mode === "seat" &&
          !state.askingKeys?.has(agent.key)
        ) {
          const phase = clock * 0.35 + (townHash(agent.key) % 97) / 97;
          const fraction = phase - Math.floor(phase);
          ambient.at(clock + ((chatting ? 0.33 : 1) - fraction) / 0.35);
          if (chatting) ambient.every(3);
        }
        if (!kind) continue;
        wanted.add(actor.key);
        let bubble = bubbles.get(actor.key);
        if (!bubble) {
          bubble = new Sprite(Texture.EMPTY);
          bubble.anchor.set(0.5, 1);
          screenLayer.addChild(bubble);
          bubbles.set(actor.key, bubble);
        }
        bubble.texture = textureOf(sprites.bubble[kind]);
        const bubbleScale =
          (kind === "blocked" || kind === "ask" || kind === "done") && !near
            ? 2
            : scale;
        bubble.scale.set(bubbleScale);
        const bounce =
          kind === "blocked" && !camera.reducedMotion && !state.calm
            ? Math.abs(Math.sin(clock * 4 + (townHash(actor.key) % 7))) * 3
            : 0;
        bubble.position.set(
          Math.round(point.x),
          Math.round(point.y - 2 - bounce),
        );
        if (kind === "blocked" && ctx.visible(bubble)) ambient.continuous();
      }
    for (const [key, bubble] of bubbles)
      if (!wanted.has(key)) {
        bubble.destroy();
        bubbles.delete(key);
      }
  };

  return {
    /** Place the standing agents; `standingAlpha` fades them with zoom. */
    update: updateActors,
    updateBubbles,
    drop,
    bubbleCount: () => bubbles.size,
    /** Bubbles live on the screen layer, outside every building. */
    dispose() {
      for (const bubble of bubbles.values()) bubble.destroy();
      bubbles.clear();
    },
  };
}
