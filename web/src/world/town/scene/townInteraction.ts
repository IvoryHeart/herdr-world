/**
 * Town's pointer and wheel interaction, headless. Pointer input runs through
 * World's shared gesture machine; this module hit-tests against the camera as
 * last drawn and carries out what the machine decides: pans, flings, pinches,
 * taps, double taps, and carrying a desk, agent or room with its magnet,
 * edge pan and drop. The DOM adapter only normalizes events; the renderer,
 * the drag ghost and World's callbacks are ports, so every rule runs on a
 * test clock and test frames.
 */

import {
  initialGesture,
  stepGesture,
  waitsForHold,
  type GestureEffect,
  type GestureEvent,
} from "../../interaction/gesture";
import type { TownCamera, TownLevel } from "../townCamera";
import {
  TOWN_MAGNET_MS,
  townDragFor,
  townDropTarget,
  townMagnetDesk,
  townRoomDrag,
  townRoomDropTarget,
  type TownDrag,
} from "../townDrag";
import { TOWN_TILE } from "../townLayout";
import type { TownRoomPlacement } from "../townRoomPlace";
import {
  TOWN_GESTURES,
  TOWN_HOLD_MS,
  type TownGestureTarget,
} from "../townGesture";
import { townHitKey, townHitTest, type TownHit } from "../townHitTest";
import type { TownLayout } from "../townLayout";
import type { TownModel } from "../townModel";
import type { TownMoveResult } from "../townMoves";
import type { TownTeams } from "../townTeams";
import type { TownClock, TownFrames } from "./ports";
import type { TownSceneCamera } from "./townSceneCamera";

type Point = { x: number; y: number };

/** The renderer as interaction uses it; null while none is ready. */
export type TownStage = {
  readonly camera: TownCamera;
  readonly level: TownLevel;
  invalidate(reason: string): void;
  roofAlpha(hostKey: string): number;
  actorPosition(key: string): { x: number; y: number; seated: boolean } | null;
  beginDrag(kind: TownDrag["kind"], key: string, x: number, y: number): void;
  moveDrag(
    x: number,
    y: number,
    targetKey: string | null,
    snap?: boolean,
    /** A carried room: where every room would stand if it landed here. */
    room?: TownRoomPlacement | null,
  ): void;
  endDrag(mode: "cancel" | "park"): void;
  finishMove(result: TownMoveResult): void;
};

/** A drop World carries out; it resolves how the move ended. */
export type TownMoveCommand =
  | { kind: "agent"; agentKey: string; deskKey: string }
  | { kind: "desk"; deskKey: string; roomKey: string }
  | { kind: "group"; deskKey: string; targetDeskKey: string }
  | { kind: "ungroup"; deskKey: string }
  /** Into `ontoDeskKey`'s slot, or last in its room when null. */
  | { kind: "reorder"; deskKey: string; ontoDeskKey: string | null }
  /** A room to a new spot in its building; the others make way. */
  | { kind: "room"; roomKey: string; placement: TownRoomPlacement };

export type TownInteractionPorts = {
  clock: TownClock;
  frames: TownFrames;
  view: TownSceneCamera;
  /** The ready renderer, read at each use. */
  stage(): TownStage | null;
  /** The town as shown now. */
  world(): { model: TownModel; layout: TownLayout; teams: TownTeams };
  /** The hover state key (an agent, desk or `building:` key) shown now. */
  hovered(): string | null;
  setHovered(key: string | null): void;
  /** World's hover card for the key under a mouse, at its client point. */
  hover(hover: { key: string; clientX: number; clientY: number } | null): void;
  /**
   * What a mouse over the canvas shows: a pointer over what it can open, a
   * grab hand over a room's edge, which lifts the room.
   */
  cursor(kind: "pointer" | "grab" | null): void;
  select(key: string): void;
  /**
   * A touch tap, with the table it landed on (null elsewhere). Touch has no
   * hover, so a tap on a table opens its summary card first; true when the
   * tap did that and nothing else should happen.
   */
  tapCard?(deskKey: string | null): boolean;
  activateAgent(key: string): void;
  activateRoom(roomKey: string): void;
  /**
   * Each tap: the building whose reception lobby it landed on at desk level,
   * where the reception board is hidden, or null when it landed elsewhere.
   */
  openReception?(hostKey: string | null): void;
  /** Open the town center's radial menu. */
  openCenter(): void;
  move(command: TownMoveCommand): Promise<TownMoveResult>;
  /** The label that follows a carry: shown on lift, aimed as it moves. */
  ghost: {
    lift(label: string, at: Point): void;
    aim(label: string, valid: boolean, action: string, at: Point): void;
    remove(): void;
  };
  /** A touch hold lifted something. */
  held(): void;
  /**
   * Whether canvas point `at` is over the bin or a bus stop (marking it), or
   * null when the carry ended. Without it nothing is dropped in the bin.
   */
  binAt?(at: Point | null): boolean;
  /** The carried agent or desk was dropped on the bin. */
  bin?(drag: Pick<TownDrag, "kind" | "key">): void;
  /** Development builds: each step of the gesture machine. */
  trace?(
    before: string,
    after: string,
    event: GestureEvent<TownGestureTarget>,
    effects: readonly GestureEffect<TownGestureTarget>[],
  ): void;
};

/** How close to the usable edge a carry pans the town, and how fast. */
const EDGE = 56;
const EDGE_SPEED = 14;

export class TownInteraction {
  private gesture = initialGesture<TownGestureTarget>();
  private cancelHold: (() => void) | null = null;
  /** The desk or agent being carried, and where it would land. */
  private carrying: TownDrag | null = null;
  private carryAt: Point | null = null;
  /**
   * A carried room: its top-left from the pointer (world pixels), and where
   * every room would stand if it landed now.
   */
  private room: {
    dx: number;
    dy: number;
    at: TownRoomPlacement | null;
  } | null = null;
  /** A desk the carried desk rests on: after a moment it snaps (groups). */
  private magnet: { key: string; cancel: () => void; on: boolean } | null =
    null;
  private cancelEdge: (() => void) | null = null;
  private pinch: null | { distance: number; z: number; world: Point } = null;
  /** The kind of pointer last pressed: a touch tap has no hover before it. */
  private pressedWith = "mouse";

  constructor(private readonly ports: TownInteractionPorts) {}

  /** The pointer currently pressed on the town, by id. */
  pressed(id: number) {
    return this.gesture.pointers.has(id);
  }

  /**
   * What is under canvas point (x, y) as last drawn. A carry looks through
   * standing agents (`standing` false): one walking, queued or in the
   * lounge is not where its desk or room is, and moves on by itself.
   */
  hitAt(x: number, y: number, standing = true): TownHit | null {
    const stage = this.ports.stage();
    if (!stage) return null;
    const { layout, model } = this.ports.world();
    // Before the first frame nothing is drawn; the live camera is all there is.
    const drawn = this.ports.view.drawn;
    const shown = drawn.z ? drawn : null;
    const world = shown
      ? {
          x: shown.x + (x - shown.width / 2) / shown.z,
          y: shown.y + (y - shown.height / 2) / shown.z,
        }
      : stage.camera.toWorld(x, y);
    return townHitTest(
      {
        layout,
        model,
        level: stage.level,
        zoom: shown?.z ?? stage.camera.z,
        roofAlpha: (hostKey) => stage.roofAlpha(hostKey),
        standing: function* () {
          if (!standing) return;
          for (const agent of model.agents.values()) {
            const position = stage.actorPosition(agent.key);
            if (position && !position.seated)
              yield { key: agent.key, hostKey: agent.hostKey, ...position };
          }
        },
        seated: (key) => stage.actorPosition(key)?.seated ?? true,
      },
      world.x,
      world.y,
    );
  }

  /* ---------- pointer input from the adapter ---------- */

  down(pointer: {
    id: number;
    at: Point;
    primary: boolean;
    pointerType: string;
    /**
     * The room whose card was pressed: a tap there zooms that room, and a
     * hold over one of its desks lifts the desk beneath the card.
     */
    card?: string;
    /**
     * The room whose name was pressed (its plaque, or its card's name): a
     * drag or touch hold carries the room. A tap on a plaque's name is the
     * plaque's own (it opens its card); on a card's name it zooms the room.
     */
    roomName?: string;
    /** The press is on the room's Move handle: touch lifts it at once. */
    handle?: boolean;
  }) {
    const stage = this.ports.stage();
    if (!stage) return;
    this.pressedWith = pointer.pointerType;
    const hit = this.hitAt(pointer.at.x, pointer.at.y);
    const { model } = this.ports.world();
    const drag = townDragFor(hit, model, stage.level);
    const target: TownGestureTarget = pointer.roomName
      ? {
          hit: { kind: "room", key: pointer.roomName },
          drag: townRoomDrag(pointer.roomName, model),
          ...(pointer.card ? {} : { nameOnly: true as const }),
        }
      : pointer.card
        ? {
            hit: { kind: "room", key: pointer.card },
            drag:
              drag?.kind === "desk" && drag.from === pointer.card ? drag : null,
          }
        : { hit, drag };
    this.feed({
      type: "down",
      id: pointer.id,
      at: pointer.at,
      time: this.ports.clock.now(),
      target,
      primary: pointer.primary,
      pointerType: pointer.pointerType,
    });
    // Touch: a desk or agent held still lifts; the machine ignores a hold
    // that comes after the finger moved or lifted.
    this.cancelHold?.();
    this.cancelHold = null;
    if (
      pointer.handle &&
      target.drag &&
      waitsForHold(TOWN_GESTURES, target, pointer.pointerType)
    )
      // The Move handle is for carrying: no hold, no pan.
      this.feed({ type: "hold", id: pointer.id, time: this.ports.clock.now() });
    else if (waitsForHold(TOWN_GESTURES, target, pointer.pointerType)) {
      const id = pointer.id;
      this.cancelHold = this.ports.clock.after(TOWN_HOLD_MS, () => {
        this.cancelHold = null;
        this.feed({ type: "hold", id, time: this.ports.clock.now() });
      });
    }
  }

  move(pointer: { id: number; at: Point; pointerType: string; client: Point }) {
    if (!this.ports.stage()) return;
    if (this.gesture.pointers.has(pointer.id)) {
      this.feed({
        type: "move",
        id: pointer.id,
        at: pointer.at,
        time: this.ports.clock.now(),
      });
      return;
    }
    // No press: a mouse hovering shows what is under it.
    if (pointer.pointerType !== "mouse" || this.gesture.pointers.size) return;
    const hit = this.hitAt(pointer.at.x, pointer.at.y);
    const key =
      hit?.kind === "building" || hit?.kind === "reception"
        ? `building:${hit.key}`
        : townHitKey(hit);
    if (key !== this.ports.hovered()) this.ports.setHovered(key);
    this.ports.cursor(
      hit?.kind === "room" &&
        hit.edge &&
        townRoomDrag(hit.key, this.ports.world().model)
        ? "grab"
        : hit && hit.kind !== "building"
          ? "pointer"
          : null,
    );
    const hoverKey = townHitKey(hit);
    this.ports.hover(
      hoverKey
        ? {
            key: hoverKey,
            clientX: pointer.client.x,
            clientY: pointer.client.y,
          }
        : null,
    );
  }

  /** A pointer lifted, or the browser cancelled it. */
  up(pointer: { id: number; at: Point; cancel: boolean }) {
    this.cancelHold?.();
    this.cancelHold = null;
    if (!this.gesture.pointers.has(pointer.id)) return;
    if (pointer.cancel) this.feed({ type: "cancel", id: pointer.id });
    else
      this.feed({
        type: "up",
        id: pointer.id,
        at: pointer.at,
        time: this.ports.clock.now(),
      });
  }

  leave() {
    if (!this.gesture.pointers.size) {
      this.ports.setHovered(null);
      this.ports.hover(null);
    }
  }

  /** A wheel turn at a canvas point; ctrl is a trackpad pinch. True when used. */
  wheel(at: Point, deltaY: number, ctrl: boolean) {
    const stage = this.ports.stage();
    if (!stage) return false;
    stage.camera.zoomAt(Math.exp(-deltaY * (ctrl ? 0.01 : 0.0018)), at.x, at.y);
    stage.invalidate("wheel");
    return true;
  }

  /**
   * The drawn camera moved under a still carry (an edge pan, an arrow key):
   * the target follows what is now drawn. Nothing rested on a desk while the
   * town moved under the carry, so the magnet's wait starts again.
   */
  reaim() {
    if (!this.carryAt) return;
    this.clearMagnet();
    this.carryTo(this.carryAt);
  }

  /**
   * Escape: what is being carried goes back where it was, and the press that
   * carries it does nothing more. True when something was carried.
   */
  cancelCarry() {
    const mode = this.gesture.mode;
    if (mode.name !== "card" || !this.carrying) return false;
    this.feed({ type: "cancel", id: mode.id });
    return true;
  }

  dispose() {
    this.clearMagnet();
    this.cancelHold?.();
    this.cancelHold = null;
    this.cancelEdge?.();
    this.cancelEdge = null;
    this.ports.ghost.remove();
  }

  /* ---------- carrying ---------- */

  private clearMagnet() {
    this.magnet?.cancel();
    this.magnet = null;
  }

  /**
   * Show where the carry would land at canvas point `at`. Resting on
   * another desk starts the magnet: after a moment it snaps (groups).
   */
  private carryTo(at: Point) {
    if (!this.carrying || !this.ports.stage()) return;
    this.carryAt = at;
    const hit = this.hitAt(at.x, at.y, false);
    const under = this.resting(at)
      ? townMagnetDesk(this.carrying, hit, this.ports.world().model)
      : null;
    if (under !== this.magnet?.key) {
      this.clearMagnet();
      if (under) {
        const magnet = {
          key: under,
          on: false,
          cancel: this.ports.clock.after(TOWN_MAGNET_MS, () => {
            if (!this.magnet || !this.carrying || !this.carryAt) return;
            // The camera began moving since: the frame that settles it
            // re-aims the carry and the wait starts again (reaim).
            if (!this.resting(this.carryAt)) {
              this.clearMagnet();
              return;
            }
            magnet.on = true;
            this.aim(
              this.hitAt(this.carryAt.x, this.carryAt.y, false),
              this.carryAt,
            );
          }),
        };
        this.magnet = magnet;
      }
    }
    this.aim(hit, at);
  }

  /**
   * Whether a carry at canvas point `at` rests where it is: not in the edge
   * band, where the town scrolls under it, and with no camera motion still
   * to draw (a zoom easing, a flight). The magnet's wait runs on the clock
   * while motion runs on frames, so it only counts once the town is still,
   * however long frames take to come.
   */
  private resting(at: Point) {
    const edge = this.edgePush(at);
    return !edge.dx && !edge.dy && !this.ports.stage()?.camera.moving;
  }

  /**
   * How far a carry at canvas point `at` pans the town each frame. Over the
   * bin (its chip floats at the screen's foot) the town holds still.
   */
  private edgePush(at: Point) {
    const stage = this.ports.stage();
    if (!stage || this.carrying?.target?.action === "bin")
      return { dx: 0, dy: 0 };
    const { width, height, inset } = stage.camera.viewport;
    const push = (p: number, low: number, high: number) =>
      p < low + EDGE
        ? Math.min(1, (low + EDGE - p) / EDGE) * EDGE_SPEED
        : p > high - EDGE
          ? -Math.min(1, (p - high + EDGE) / EDGE) * EDGE_SPEED
          : 0;
    return {
      dx: push(at.x, inset.left, width - inset.right),
      dy: push(at.y, inset.top, height - inset.bottom),
    };
  }

  /** Pan the town while a carry is held near an edge, each animation frame. */
  private edgePan = () => {
    this.cancelEdge = null;
    const stage = this.ports.stage();
    if (!this.carrying || !this.carryAt || !stage) return;
    const { dx, dy } = this.edgePush(this.carryAt);
    if (dx || dy) {
      stage.camera.panBy(dx, dy);
      stage.invalidate("edge-pan");
      // The town scrolls under the carry: it rests on no desk (see reaim).
      this.clearMagnet();
      this.carryTo(this.carryAt);
    }
    this.cancelEdge = this.ports.frames.next(this.edgePan);
  };

  private startDrag(drag: TownDrag, at: Point) {
    this.carrying = drag;
    this.carryAt = at;
    this.cancelEdge?.();
    this.cancelEdge = this.ports.frames.next(this.edgePan);
    this.ports.hover(null);
    this.ports.ghost.lift(drag.label, at);
    const stage = this.ports.stage();
    if (stage) {
      const world = stage.camera.toWorld(at.x, at.y);
      const placed =
        drag.kind === "room"
          ? this.ports
              .world()
              .layout.buildings.flatMap((b) => b.rooms)
              .find((room) => room.key === drag.key)
          : undefined;
      this.room = placed
        ? {
            dx: placed.x * TOWN_TILE - world.x,
            dy: placed.y * TOWN_TILE - world.y,
            at: null,
          }
        : null;
      stage.beginDrag(drag.kind, drag.key, world.x, world.y);
    }
  }

  private endDrag() {
    this.ports.ghost.remove();
    this.ports.binAt?.(null);
    this.clearMagnet();
    this.cancelEdge?.();
    this.cancelEdge = null;
    this.carryAt = null;
    const drag = this.carrying;
    this.carrying = null;
    return drag;
  }

  /** Aim a carried room: wherever it is in its own building. */
  private aimRoom(drag: TownDrag, at: Point) {
    const stage = this.ports.stage();
    if (!stage || !this.room) return;
    const world = stage.camera.toWorld(at.x, at.y);
    const { layout, model } = this.ports.world();
    const { target, placement } = townRoomDropTarget(
      drag,
      layout,
      model,
      world.x + this.room.dx,
      world.y + this.room.dy,
      world.x,
      world.y,
    );
    drag.target = target;
    this.room.at = placement;
    this.ports.ghost.aim(target.label, target.key !== null, "move", at);
    stage.moveDrag(world.x, world.y, target.key, false, placement);
  }

  /** Show where the carried desk or agent would land, and snap to it. */
  private aim(hit: TownHit | null, at: Point) {
    const stage = this.ports.stage();
    if (!this.carrying || !stage) return;
    // Rooms stay in their building: only desks and agents go in the bin.
    if (this.carrying.kind === "room") return this.aimRoom(this.carrying, at);
    if (this.ports.binAt?.(at)) {
      this.carrying.target = {
        key: "bin",
        label: "Put in the bin",
        action: "bin",
      };
      this.ports.ghost.aim("Put in the bin", true, "bin", at);
      const world = stage.camera.toWorld(at.x, at.y);
      stage.moveDrag(world.x, world.y, null);
      return;
    }
    const { model, teams } = this.ports.world();
    const target = townDropTarget(
      this.carrying,
      hit,
      model,
      teams.deskTeams,
      this.magnet?.on ? this.magnet.key : null,
      teams.groupedDesks,
    );
    this.carrying.target = target;
    this.ports.ghost.aim(
      target.label,
      target.key !== null,
      target.action ?? "",
      at,
    );
    const world = stage.camera.toWorld(at.x, at.y);
    stage.moveDrag(world.x, world.y, target.key, target.action === "group");
  }

  /* ---------- what the gesture machine decided ---------- */

  private tap(target: TownGestureTarget) {
    const stage = this.ports.stage();
    const hit = target.hit;
    if (!stage) return;
    this.ports.openReception?.(hit?.kind === "reception" ? hit.key : null);
    if (target.nameOnly) return;
    if (
      this.pressedWith === "touch" &&
      this.ports.tapCard?.(hit?.kind === "desk" ? hit.key : null)
    )
      return;
    if (!hit) return;
    const { layout } = this.ports.world();
    if (hit.kind === "center") {
      this.ports.openCenter();
      return;
    }
    if (hit.kind === "reception") {
      this.ports.view.revealReception(layout, hit.key);
      return;
    }
    if (hit.kind === "building") {
      const building = layout.buildings.find((b) => b.hostKey === hit.key);
      if (building && stage.roofAlpha(building.hostKey) > 0.5)
        this.ports.view.zoomToBuilding(layout, building.hostKey);
      return;
    }
    if (hit.kind === "room" || hit.kind === "cell") {
      const roomKey = hit.kind === "room" ? hit.key : hit.roomKey;
      this.ports.activateRoom(roomKey);
      if (stage.level !== "desk") this.ports.view.zoomToRoom(layout, roomKey);
      return;
    }
    const key = townHitKey(hit);
    if (key) this.ports.select(key);
  }

  private drop(drag: TownDrag, targetKey: string): TownMoveCommand {
    const action = drag.target?.action;
    if (drag.kind === "agent")
      return { kind: "agent", agentKey: drag.key, deskKey: targetKey };
    // A room has a target only with the placement it was aimed with.
    if (drag.kind === "room")
      return { kind: "room", roomKey: drag.key, placement: this.room!.at! };
    if (action === "group")
      return { kind: "group", deskKey: drag.key, targetDeskKey: targetKey };
    if (action === "ungroup") return { kind: "ungroup", deskKey: drag.key };
    if (action === "reorder")
      return {
        kind: "reorder",
        deskKey: drag.key,
        ontoDeskKey: targetKey === drag.from ? null : targetKey,
      };
    return { kind: "desk", deskKey: drag.key, roomKey: targetKey };
  }

  private apply(effect: GestureEffect<TownGestureTarget>) {
    const stage = this.ports.stage();
    if (!stage) return;
    const camera = stage.camera;
    switch (effect.type) {
      case "stopCamera":
        camera.stop();
        return;
      case "panBy":
        this.ports.hover(null);
        camera.panBy(effect.dx, effect.dy);
        stage.invalidate("pan");
        return;
      case "fling":
        camera.release(effect.vx, effect.vy);
        stage.invalidate("fling");
        return;
      case "pinchStart":
        this.pinch = {
          distance: effect.distance,
          z: camera.z,
          world: camera.toWorld(effect.mid.x, effect.mid.y),
        };
        return;
      case "pinch": {
        const pinch = this.pinch;
        if (!pinch) return;
        const z = camera.clampZoom(pinch.z * effect.scale);
        camera.setZoom(z, effect.mid.x, effect.mid.y);
        camera.x =
          pinch.world.x - (effect.mid.x - camera.viewport.width / 2) / z;
        camera.y =
          pinch.world.y - (effect.mid.y - camera.viewport.height / 2) / z;
        stage.invalidate("pinch");
        return;
      }
      case "liftCard":
        if (!effect.target.drag) return;
        this.startDrag(effect.target.drag, effect.at);
        if (effect.held) this.ports.held();
        return;
      case "moveCard":
        this.carryTo(effect.at);
        return;
      case "dropCard": {
        // Judge the drop where it is released, against the frame drawn now.
        this.carryTo(effect.at);
        const drag = this.endDrag();
        const targetKey = drag?.target?.key;
        if (!drag || !targetKey) {
          stage.endDrag("cancel");
          return;
        }
        if (drag.target?.action === "bin") {
          // It goes back to where it was and walks out to its stop.
          stage.endDrag("cancel");
          this.ports.bin?.({ kind: drag.kind, key: drag.key });
          return;
        }
        // Wait at the target while Herdr moves it, then land or spring back.
        stage.endDrag("park");
        void this.ports
          .move(this.drop(drag, targetKey))
          .catch((): TownMoveResult => "uncertain")
          .then((result) => this.ports.stage()?.finishMove(result));
        return;
      }
      case "settleCard":
        if (this.endDrag()) stage.endDrag("cancel");
        return;
      case "tap":
        this.tap(effect.target);
        return;
      case "doubleTap": {
        if (effect.target.nameOnly) return;
        const hit = effect.target.hit;
        const key = townHitKey(hit);
        if (
          hit &&
          (hit.kind === "agent" ||
            hit.kind === "desk" ||
            hit.kind === "pane") &&
          key
        )
          this.ports.activateAgent(key);
        else {
          camera.zoomAt(2, effect.at.x, effect.at.y);
          stage.invalidate("zoom");
        }
        return;
      }
      default:
        // Lines, groups and picks are Board's; Town has none.
        return;
    }
  }

  private feed(event: GestureEvent<TownGestureTarget>) {
    const before = this.gesture.mode.name;
    const result = stepGesture(this.gesture, event, TOWN_GESTURES);
    this.gesture = result.state;
    this.ports.trace?.(before, this.gesture.mode.name, event, result.effects);
    if (this.gesture.mode.name !== "pinching") this.pinch = null;
    for (const effect of result.effects) this.apply(effect);
  }
}
