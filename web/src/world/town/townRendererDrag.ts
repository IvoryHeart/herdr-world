/**
 * The Town renderer's drag and move effects: the carried desk or agent with
 * its shadow, target highlight and slot; its lift, spring, park, landing and
 * fade (townDragMotion.ts); and the dust raised where it lifts and lands. The
 * renderer owns the layers and steps these each frame through `update`.
 */

import {
  Container,
  Graphics,
  Sprite,
  type Application,
  type Texture,
} from "pixi.js";
import type { TerminalColor } from "../terminalColor";
import type { TownActors } from "./townActors";
import type { TownCamera } from "./townCamera";
import type { TownRendererDiagnostics } from "./townDiagnostics";
import {
  stepTownDrag,
  townDragPhase,
  townGroundedPose,
  type TownDragMotion,
} from "./townDragMotion";
import {
  TOWN_AGENT_SCALE,
  TOWN_TILE as T,
  townSeat,
  type TownCell,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownMoveResult } from "./townMoves";
import { textureOf, type PodView } from "./townRendererScene";
import {
  townCharacter,
  type TownLook,
  type TownStaticSprites,
} from "./townSprites";

/** What the drag effects read from the renderer that owns them. */
export type TownDragContext = {
  app: Application;
  camera: TownCamera;
  sprites: TownStaticSprites;
  actors: TownActors;
  dragLayer: Container;
  puffLayer: Graphics;
  stats: TownRendererDiagnostics;
  model(): TownModel | null;
  layout(): TownLayout | null;
  /** Calm motion raises no dust. */
  state(): { calm: boolean };
  layoutCells(): ReadonlyMap<string, TownCell>;
  podOf(deskKey: string): PodView | undefined;
  deskColor(deskKey: string): TerminalColor;
  lookOf(key: string): TownLook;
  /** The renderer's animation clock, in seconds. */
  clock(): number;
  request(reason: string): void;
};

export function createTownDragEffects(ctx: TownDragContext) {
  const { camera, sprites, actors, dragLayer, puffLayer, stats, request } = ctx;
  const { deskColor, lookOf } = ctx;
  type Puff = { x: number; y: number; vx: number; vy: number; life: number };
  const puffs: Puff[] = [];
  const quiet = () => camera.reducedMotion || ctx.state().calm;
  /** Raise dust unless motion is quiet; true when it did. */
  const puffAt = (x: number, y: number, count: number) => {
    if (quiet()) return false;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI * (0.9 + 1.2 * Math.random());
      const speed = 18 + 34 * Math.random();
      puffs.push({
        x: x + (Math.random() - 0.5) * 24,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        life: 0.45 + 0.3 * Math.random(),
      });
    }
    return true;
  };
  type DragVisual = {
    kind: "desk" | "agent";
    key: string;
    ghost: Container;
    /** A carried agent, drawn kicking its legs. */
    agent: { sprite: Sprite; look: TownLook } | null;
    shadow: Graphics;
    highlight: Graphics;
    slot: Sprite | null;
    dimmed: Container | null;
    /** The desk snapshot made for this drag; cached textures are never ours. */
    snapshot: Texture | null;
  } & TownDragMotion;
  let drag: DragVisual | null = null;
  const clearDrag = () => {
    if (!drag) return;
    if (drag.dimmed && !drag.dimmed.destroyed) drag.dimmed.alpha = 1;
    // Cached textures (characters, tables) are shared with the scene: destroy
    // only the sprites, and the snapshot made for this drag.
    drag.ghost.destroy({ children: true });
    drag.snapshot?.destroy(true);
    drag.shadow.destroy();
    drag.highlight.destroy();
    drag.slot?.destroy();
    drag = null;
  };
  const beginDrag = (
    kind: "desk" | "agent",
    key: string,
    x: number,
    y: number,
  ) => {
    clearDrag();
    const model = ctx.model();
    const layoutCells = ctx.layoutCells();
    if (!model || !ctx.layout()) return;
    const ghost = new Container();
    let home = { x, y };
    let dimmed: Container | null = null;
    let snapshot: Texture | null = null;
    let image: Sprite;
    if (kind === "desk") {
      const cell = layoutCells.get(key);
      const pod = ctx.podOf(key);
      if (cell) home = { x: (cell.x + 3) * T, y: cell.y * T + 30 };
      if (pod) {
        // A snapshot of the desk as drawn, people and screens included.
        snapshot = ctx.app.renderer.generateTexture(pod.container);
        image = new Sprite(snapshot);
        pod.container.alpha = 0.25;
        dimmed = pod.container;
      } else {
        const seats = cell?.seats ?? 4;
        image = new Sprite(
          textureOf(
            (seats <= 2 ? sprites.tableSmall : sprites.table)[deskColor(key)]!,
          ),
        );
      }
      image.anchor.set(0.5);
      ghost.addChild(image);
    } else {
      const actor = actors.actors.get(key);
      const seat = model.agentSeats.get(key);
      const cell = seat && layoutCells.get(seat.deskKey);
      if (cell && seat) {
        const geometry = townSeat(cell, seat.seat);
        home = { x: geometry.cx, y: geometry.seatedY - 10 };
      } else if (actor) home = { x: actor.x, y: actor.y - 10 };
      // Held by the scruff: it hangs from the top and swings.
      image = new Sprite(
        textureOf(townCharacter(lookOf(key), "down", 0, "stand", false)),
      );
      image.anchor.set(0.5, 0.1);
      image.scale.set(TOWN_AGENT_SCALE);
      image.y = -0.7 * 18 * TOWN_AGENT_SCALE;
      ghost.addChild(image);
    }
    const shadow = new Graphics()
      .ellipse(0, 0, kind === "desk" ? 30 : 8, kind === "desk" ? 6 : 3)
      .fill({ color: 0x000000, alpha: 0.32 });
    const highlight = new Graphics();
    dragLayer.addChild(highlight, shadow, ghost);
    drag = {
      kind,
      key,
      ghost,
      agent: kind === "agent" ? { sprite: image, look: lookOf(key) } : null,
      shadow,
      highlight,
      slot: null,
      home,
      x: home.x,
      y: home.y,
      target: null,
      dimmed,
      snapshot,
      // It lifts off from where it stood and springs after the pointer.
      phase: { name: "drag", t: 0 },
      shown: townGroundedPose(home.x, home.y),
      vx: 0,
      vy: 0,
      lean: 0,
    };
    stats.drags.lifts += 1;
    puffAt(
      home.x,
      home.y + (kind === "desk" ? 24 : 8),
      kind === "desk" ? 8 : 4,
    );
    moveDrag(x, y, null);
  };
  const moveDrag = (
    x: number,
    y: number,
    targetKey: string | null,
    snap = false,
  ) => {
    const layout = ctx.layout();
    const layoutCells = ctx.layoutCells();
    if (!drag || !layout || drag.phase.name !== "drag") return;
    drag.x = x;
    drag.y = y - (drag.kind === "desk" ? 24 : 14);
    drag.target = null;
    drag.slot?.destroy();
    drag.slot = null;
    if (targetKey && drag.kind === "desk") {
      // Another desk's slot when reordering in the room or grouping with
      // that desk, or else the next free spot of the target room.
      const room = layout.buildings
        .flatMap((b) => b.rooms)
        .find((candidate) => candidate.key === targetKey);
      const cell =
        layoutCells.get(targetKey) ??
        room?.cells.find((candidate) => !candidate.deskKey);
      if (cell) {
        drag.target = {
          x: (cell.x + 1) * T - 3,
          y: cell.y * T + 2,
          w: 70,
          h: 57,
        };
      }
      // Grouping keeps both desks: no ghost table takes the other's place.
      if (cell && !snap) {
        const seats = ctx.model()?.desks.get(drag.key)?.paneDevices.length ?? 4;
        const slot = new Sprite(
          textureOf(
            (seats <= 2 ? sprites.tableSmall : sprites.table)[
              deskColor(drag.key)
            ]!,
          ),
        );
        slot.alpha = 0.35;
        slot.position.set(
          (cell.x + 1) * T + (seats <= 2 ? 14 : -1),
          cell.y * T + 17,
        );
        dragLayer.addChildAt(slot, 1);
        drag.slot = slot;
      }
    } else if (targetKey && drag.kind === "agent") {
      const cell = layoutCells.get(targetKey);
      if (cell)
        drag.target = {
          x: (cell.x + 1) * T - 3,
          y: cell.y * T + 2,
          w: 70,
          h: 57,
        };
    }
    request("drag");
  };
  const endDrag = (mode: "cancel" | "park") => {
    if (!drag || drag.phase.name !== "drag") return;
    drag.phase = townDragPhase(
      drag,
      mode === "park" && drag.target ? "park" : "back",
    );
    request("drag-end");
  };
  const finishMove = (result: TownMoveResult) => {
    if (!drag) return;
    // An uncertain move neither lands nor springs home: the ghost fades where
    // it was dropped and the refreshed scene shows where the panes are.
    if (result === "uncertain") {
      drag.phase = townDragPhase(drag, "fade");
      request("drag-uncertain");
      return;
    }
    // Every move that lands raises dust when it touches down (see
    // updateDrag), on its target or, without one, where it was dropped.
    if (result === "moved") drag.phase = townDragPhase(drag, "land");
    else {
      drag.phase = townDragPhase(drag, "back");
      stats.drags.returns += 1;
    }
    request("drag-result");
  };
  /** Advance drag effects and puffs; true while anything still moves. */
  const updateDrag = (dt: number) => {
    const clock = ctx.clock();
    puffLayer.clear();
    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      const puff = puffs[i]!;
      puff.life -= dt;
      if (puff.life <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vx *= 0.9;
      puff.vy *= 0.9;
      puffLayer
        .circle(puff.x, puff.y, 2 + (0.8 - puff.life) * 6)
        .fill({ color: 0xe8dcc4, alpha: Math.min(0.5, puff.life) });
    }
    if (!drag) return puffs.length > 0;
    const { pose, done, landed } = stepTownDrag(drag, dt, clock, quiet());
    const desk = drag.kind === "desk";
    // The ground under the ghost: its shadow, and where the dust rises.
    const ground = desk ? 40 : 12;
    if (landed) {
      stats.drags.landings += 1;
      if (puffAt(pose.x, pose.y + ground - 2, desk ? 16 : 8))
        stats.drags.dust += 1;
    }
    if (done) {
      clearDrag();
      return puffs.length > 0;
    }
    const { x, y, tilt, alpha, scale, lift, squash } = pose;
    const phase = drag.phase;
    // Lifted, the ghost rises off its shadow, which spreads and fades.
    drag.ghost.position.set(x, y - lift * (desk ? 14 : 10));
    drag.ghost.rotation = tilt;
    drag.ghost.alpha = alpha;
    drag.ghost.scale.set(scale * Math.sqrt(squash), scale / Math.sqrt(squash));
    drag.shadow.position.set(x, y + ground);
    drag.shadow.scale.set(1 + 0.35 * lift);
    drag.shadow.alpha = alpha * (1 - 0.4 * Math.min(1, lift));
    if (drag.agent) {
      // A carried agent swings from where it is held and kicks its legs.
      const kicking = lift > 0.3 && phase.name !== "land";
      const frame = kicking
        ? Math.floor(clock * (Math.hypot(drag.vx, drag.vy) > 60 ? 12 : 5)) % 4
        : 0;
      drag.agent.sprite.texture = textureOf(
        townCharacter(drag.agent.look, "down", frame, "stand", false),
      );
      drag.agent.sprite.rotation = kicking
        ? Math.max(-0.5, Math.min(0.5, drag.vx * 0.002))
        : 0;
    }
    drag.highlight.clear();
    if (drag.target && phase.name !== "back") {
      const pulse = 0.12 + 0.08 * Math.sin(clock * 4);
      const r = drag.target;
      drag.highlight
        .rect(r.x, r.y, r.w, r.h)
        .fill({ color: 0x7be08f, alpha: phase.name === "drag" ? 0.3 : pulse })
        .stroke({ color: 0x7be08f, width: 1.5, alpha: 0.9 });
    }
    return true;
  };

  return {
    beginDrag,
    moveDrag,
    endDrag,
    finishMove,
    /** Advance drag effects and dust; true while anything still moves. */
    update: updateDrag,
    clear: clearDrag,
  };
}
