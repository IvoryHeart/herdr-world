/**
 * Where Town's camera goes, headless: home and re-framing, keyboard pans and
 * zooms, the zoom steps, focusing a target or room, room requests, the camera
 * as last drawn and the pose kept per town shape. The renderer steps the
 * camera's motion each frame; every intent here asks it for a frame through
 * the `invalidate` port, with the reason the frame trace reports.
 */

import { buildingZoom, roomZoom } from "../townCameraTargets";
import {
  TownCamera,
  type TownBoardHeights,
  townHomeSpan,
  townHostsWidth,
  townRoomFocus,
  type TownLevel,
  type TownViewport,
} from "../townCamera";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townGeometryKey,
  townReflowShift,
  townShapeKey,
  type TownLayout,
} from "../townLayout";
import { townRoomsMoved } from "../townRoomPlace";
import type { TownTarget } from "../townTargets";
import { townCenterEmblem } from "../townCenter";
import { TOWN_TRANSITION_SECONDS } from "../townTransition";

/** Screen pixels kept above a reception board's foot for the board. */
const RECEPTION_BOARD_ROOM = 260;

/** A saved camera; `home` marks the home view, framed again when restored. */
export type TownPose = { x: number; y: number; z: number; home?: boolean };

/** Screen pixels covered by panels on wide screens (rail, chat dock). */
export type TownChrome = { left: number; right: number };

/** The camera's viewport for a host of this size beside this chrome. */
export function townViewport(
  width: number,
  height: number,
  chrome: TownChrome,
): TownViewport {
  const narrow = width < 640;
  return {
    width,
    height,
    inset: {
      top: narrow ? 12 : 16,
      right: narrow ? 12 : Math.max(72, chrome.right),
      bottom: narrow ? 12 : 16,
      left: narrow ? 12 : Math.max(16, chrome.left),
    },
  };
}

export class TownSceneCamera {
  /** The renderer's camera while one is ready; intents wait for it. */
  camera: TownCamera | null = null;
  /** The camera as last drawn, which the canvas shows until the next frame. */
  readonly drawn = { x: 0, y: 0, z: 0, width: 0, height: 0 };
  /** The level as last drawn. */
  level: TownLevel = "overview";
  private home: TownPose | null = null;
  private signature = "";
  private lastShape: string | null = null;
  private lastLayout: TownLayout | null = null;
  /** The layout the camera frames now, from attach on. */
  private layout: TownLayout | null = null;
  /** The reception boards as last measured (townBoardPlacement). */
  private boardHeights: TownBoardHeights = new Map();
  private consumedRoomFocus: number | null = null;

  /**
   * `poses` keeps the camera per town shape for the page's lifetime, across
   * visits; `invalidate` asks the renderer for a frame.
   */
  constructor(
    private readonly poses: Map<string, TownPose>,
    private readonly invalidate: (reason: string) => void,
  ) {}

  /** A ready renderer's camera, placed at the saved pose or home. */
  attach(camera: TownCamera, layout: TownLayout, viewport: TownViewport) {
    this.camera = camera;
    this.layout = layout;
    camera.boardHeights = this.boardHeights;
    camera.configure(layout, viewport);
    const saved = this.poses.get(townShapeKey(layout.shape));
    if (saved && !saved.home) {
      camera.x = saved.x;
      camera.y = saved.y;
      camera.setZoom(
        saved.z,
        camera.viewport.width / 2,
        camera.viewport.height / 2,
      );
    } else this.frameHome(layout, viewport, false);
    this.lastShape = townShapeKey(layout.shape);
  }

  detach() {
    this.camera = null;
  }

  /**
   * The reception boards were measured anew: the home zoom and framing keep
   * them whole, and a town still at home is framed again.
   */
  boardsResized(heights: TownBoardHeights) {
    this.boardHeights = heights;
    const camera = this.camera;
    const layout = this.layout;
    if (!camera || !layout) return;
    const wasHome = this.atHome();
    camera.boardHeights = heights;
    camera.configure(layout, camera.viewport);
    if (wasHome) this.frameHome(layout, camera.viewport, false);
  }

  /**
   * Frame the town's home view: every building, or the first on a phone.
   * `follow` (a town at home that changed) flies there in step with the
   * buildings and still counts as home once it arrives.
   */
  frameHome(
    layout: TownLayout,
    viewport: TownViewport,
    animate: boolean,
    follow = false,
  ) {
    const camera = this.camera;
    const limits = camera?.limits;
    if (!camera || !limits) return;
    if (layout.formFactor === "narrow") {
      const first = layout.buildings[0];
      // The stacked buildings share one axis; side roads run to its right.
      // The view opens on the town center at the top, the first building
      // under it, down to its lounge where idle agents rest. A screen too
      // short for both keeps the whole building and slides the center up,
      // never past its plaque and doors.
      const x = first ? (first.x + first.w / 2) * T : (layout.width * T) / 2;
      const focus = camera.focusPoint();
      const flag = layout.center.y * T - 40;
      const plaque = townCenterEmblem(layout.center, T).y - 28;
      const shown =
        (viewport.height - viewport.inset.top - viewport.inset.bottom) /
        limits.home;
      const top = first
        ? Math.min(
            plaque,
            Math.max(flag, (first.y + first.h + TOWN_FACADE) * T - shown),
          )
        : flag;
      const y = top + (focus.y - viewport.inset.top) / limits.home;
      if (follow) camera.flyTo(x, y, limits.home, TOWN_TRANSITION_SECONDS);
      else if (animate) camera.flyTo(x, y, limits.home);
      else camera.jumpTo(x, y, limits.home);
    } else {
      // The hosts' buildings, centred but never past the town's left edge,
      // from the city billboard and the reception boards down to their
      // street (townHomeSpan); ALL frames the whole town.
      const focus = camera.focusPoint();
      const usable =
        viewport.width - viewport.inset.left - viewport.inset.right;
      const x =
        layout.width * T * limits.home <= usable
          ? (layout.width * T) / 2
          : Math.max(
              (townHostsWidth(layout) * T) / 2,
              (focus.x - viewport.inset.left) / limits.home,
            );
      const span = townHomeSpan(layout, camera.boardHeights);
      const y = (span.top(limits.home) + span.bottom) / 2;
      if (follow) camera.flyTo(x, y, limits.home, TOWN_TRANSITION_SECONDS);
      else if (animate) camera.flyTo(x, y, limits.home);
      else camera.jumpTo(x, y, limits.home);
    }
    this.home = follow
      ? camera.destination
      : !animate && !camera.flying
        ? { x: camera.x, y: camera.y, z: camera.z }
        : null;
    this.invalidate("home");
  }

  /** Still where the last instant home framing put it. */
  atHome() {
    const home = this.home;
    const camera = this.camera;
    return (
      camera !== null &&
      home !== null &&
      Math.abs(camera.z - home.z) < home.z * 0.01 &&
      Math.hypot(camera.x - home.x, camera.y - home.y) * camera.z < 4
    );
  }

  /** Flying to the home framing that `follow` set. */
  private flyingHome() {
    const camera = this.camera;
    const home = this.home;
    if (!camera?.flying || !home) return false;
    const to = camera.destination;
    return (
      Math.abs(to.z - home.z) < home.z * 0.01 &&
      Math.hypot(to.x - home.x, to.y - home.y) * to.z < 4
    );
  }

  /**
   * Panels opened or closed: apply the new viewport, and re-frame the town
   * only if it was still at home.
   */
  reframe(
    layout: TownLayout,
    viewport: TownViewport,
    apply: (viewport: TownViewport) => void,
  ) {
    if (!this.camera) return;
    const wasHome = this.atHome();
    apply(viewport);
    if (wasHome) this.frameHome(layout, viewport, false);
  }

  /**
   * A new layout: a new shape returns to its saved pose (or home); a town at
   * home is framed again, flying with the buildings as they glide; rooms
   * that moved under a still camera elsewhere keep the room in view where it
   * was, the camera gliding with them (townTransition.ts).
   */
  follow(layout: TownLayout, viewport: TownViewport) {
    const camera = this.camera;
    if (!camera) return;
    const shapeKey = townShapeKey(layout.shape);
    const shapeChanged = camera.limits !== null && shapeKey !== this.lastShape;
    const previous = this.lastLayout;
    // Still flying home after the last change counts as home.
    const homeBound = this.flyingHome();
    const wasHome = homeBound || this.atHome();
    // The camera as drawn, before the new town's bounds clamp it: a reflow
    // glides from here, so what the user was looking at stays put.
    const drawn = { x: camera.x, y: camera.y };
    const focus = camera.focusPoint();
    const at = camera.toWorld(focus.x, focus.y);
    camera.configure(layout, viewport);
    if (shapeChanged) {
      const saved = this.poses.get(shapeKey);
      if (saved && !saved.home) camera.jumpTo(saved.x, saved.y, saved.z);
      else this.frameHome(layout, viewport, false);
    } else if (
      wasHome &&
      (homeBound || !camera.flying) &&
      previous &&
      previous !== layout &&
      townGeometryKey(previous) !== townGeometryKey(layout)
    ) {
      // A town viewed whole stays whole as it grows or shrinks.
      this.frameHome(layout, viewport, true, true);
    } else if (
      previous &&
      previous !== layout &&
      !camera.flying &&
      townGeometryKey(previous) !== townGeometryKey(layout) &&
      // A moved room lands where the user dropped it, in view: the camera
      // stays rather than follow a room that made way.
      !townRoomsMoved(previous, layout)
    ) {
      const shift = townReflowShift(previous, layout, at);
      if (shift.x || shift.y || camera.x !== drawn.x || camera.y !== drawn.y) {
        camera.glideBy(shift.x, shift.y, TOWN_TRANSITION_SECONDS, drawn);
        this.invalidate("reflow");
      }
    }
    this.lastShape = shapeKey;
    this.lastLayout = layout;
    this.layout = layout;
  }

  /**
   * The renderer drew a frame. Returns whether the camera moved since the
   * last one, and whether its pose (as saved) changed.
   */
  drew(camera: TownCamera, level: TownLevel, layout: TownLayout) {
    const drawn = this.drawn;
    const moved =
      drawn.x !== camera.x ||
      drawn.y !== camera.y ||
      drawn.z !== camera.z ||
      drawn.width !== camera.viewport.width ||
      drawn.height !== camera.viewport.height;
    drawn.x = camera.x;
    drawn.y = camera.y;
    drawn.z = camera.z;
    drawn.width = camera.viewport.width;
    drawn.height = camera.viewport.height;
    this.level = level;
    const signature = `${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.z.toFixed(4)}`;
    const posed = signature !== this.signature;
    if (posed) {
      this.signature = signature;
      this.poses.set(townShapeKey(layout.shape), {
        x: camera.x,
        y: camera.y,
        z: camera.z,
        home: this.atHome(),
      });
    }
    return { moved, posed };
  }

  /** A canvas key: arrows pan, plus and minus zoom. True when handled. */
  key(key: string) {
    const camera = this.camera;
    if (!camera) return false;
    const step = 60;
    if (key === "ArrowLeft") camera.panBy(step, 0);
    else if (key === "ArrowRight") camera.panBy(-step, 0);
    else if (key === "ArrowUp") camera.panBy(0, step);
    else if (key === "ArrowDown") camera.panBy(0, -step);
    else if (key === "+" || key === "=")
      camera.zoomAt(1.3, camera.viewport.width / 2, camera.viewport.height / 2);
    else if (key === "-")
      camera.zoomAt(
        1 / 1.3,
        camera.viewport.width / 2,
        camera.viewport.height / 2,
      );
    else return false;
    this.invalidate("keyboard");
    return true;
  }

  zoomBy(factor: number) {
    const camera = this.camera;
    if (!camera) return;
    camera.zoomAt(
      factor,
      camera.viewport.width / 2,
      camera.viewport.height / 2,
    );
    this.invalidate("zoom");
  }

  /** Show the whole town. */
  fitAll(layout: TownLayout) {
    const camera = this.camera;
    if (!camera?.limits) return;
    camera.flyTo(
      (layout.width * T) / 2,
      (layout.height * T) / 2,
      camera.limits.all,
    );
    this.invalidate("fit");
  }

  /**
   * The zoom buttons step between whole town, one building, one room and one
   * desk, choosing whatever is nearest the centre of the screen. The current
   * step is read from the zoom, so pinching and wheel zoom mix freely.
   */
  stepZoom(direction: 1 | -1, layout: TownLayout, viewport: TownViewport) {
    const camera = this.camera;
    if (!camera?.limits) return;
    const limits = camera.limits;
    const focus = camera.focusPoint();
    const at = camera.toWorld(focus.x, focus.y);
    const distance = (x: number, y: number, w: number, h: number) =>
      Math.hypot(
        Math.max(x * T - at.x, 0, at.x - (x + w) * T),
        Math.max(y * T - at.y, 0, at.y - (y + h) * T),
      );
    const building = [...layout.buildings].sort(
      (a, b) =>
        distance(a.x, a.y, a.w, a.h + TOWN_FACADE) -
        distance(b.x, b.y, b.w, b.h + TOWN_FACADE),
    )[0];
    if (!building) return;
    const room = [...building.rooms].sort(
      (a, b) => distance(a.x, a.y, a.w, a.h) - distance(b.x, b.y, b.w, b.h),
    )[0];
    const cell = room
      ? [...room.cells]
          .filter((candidate) => candidate.deskKey)
          .sort(
            (a, b) => distance(a.x, a.y, 6, 4) - distance(b.x, b.y, 6, 4),
          )[0]
      : undefined;
    // Steps out to in: the whole town (when it differs from home, as on a
    // phone where home fits one building's width), home, the nearest
    // building, its nearest room and a desk.
    const whole = limits.all < limits.home * 0.93;
    const steps: { z: number; go(z: number): void }[] = [
      ...(whole
        ? [
            {
              z: limits.all,
              go: (z: number) =>
                camera.flyTo(
                  (layout.width * T) / 2,
                  (layout.height * T) / 2,
                  z,
                ),
            },
          ]
        : []),
      { z: limits.home, go: () => this.frameHome(layout, viewport, true) },
      {
        // Stop where the building's room summaries show, as on a phone, so
        // the next step goes into a room.
        z: Math.min(buildingZoom(camera, building), limits.card * 0.95),
        go: (z) =>
          camera.flyTo(
            (building.x + building.w / 2) * T,
            (building.y + (building.h + TOWN_FACADE) / 2) * T,
            z,
            0.7,
          ),
      },
      ...(room
        ? [
            {
              z: roomZoom(camera, room),
              // A room larger than the view opens at its first desks, as
              // when its card is chosen.
              go: (z: number) => {
                const target = townRoomFocus(room, camera.viewport, z);
                camera.flyTo(target.x, target.y, z, 0.6);
              },
            },
          ]
        : []),
      ...(cell
        ? [
            {
              z: Math.max(limits.desk * 1.2, limits.desk + 0.2),
              go: (z: number) =>
                camera.flyTo((cell.x + 3) * T, (cell.y + 2) * T, z, 0.6),
            },
          ]
        : []),
    ];
    for (let i = 1; i < steps.length; i += 1)
      steps[i]!.z = Math.min(
        limits.max,
        Math.max(steps[i]!.z, steps[i - 1]!.z * 1.2),
      );
    let step = 0;
    steps.forEach(({ z }, index) => {
      if (camera.z >= z * 0.93) step = index;
    });
    const next = step + direction;
    if (next < 0) {
      steps[0]!.go(steps[0]!.z);
      return;
    }
    if (next >= steps.length) {
      this.zoomBy(1.4);
      return;
    }
    steps[next]!.go(steps[next]!.z);
    this.invalidate("zoom-step");
  }

  /** Bring a focused target into view when it is off-screen or tiny. */
  focusTarget(target: TownTarget) {
    const camera = this.camera;
    if (!camera) return;
    const centre = camera.toScreen(
      target.rect.x + target.rect.width / 2,
      target.rect.y + target.rect.height / 2,
    );
    const { width, height } = camera.viewport;
    if (
      centre.x < 40 ||
      centre.y < 40 ||
      centre.x > width - 40 ||
      centre.y > height - 40 ||
      this.level === "town"
    ) {
      const z = Math.max(camera.z, camera.limits?.card ?? camera.z);
      camera.flyTo(
        target.rect.x + target.rect.width / 2,
        target.rect.y + target.rect.height / 2,
        z,
        0.4,
      );
      this.invalidate("focus");
    }
  }

  /**
   * Bring a world point to the middle of the view, for Town's edge arrows
   * and Next: a glide that keeps the zoom, zooming in to `room` first when
   * the camera is out at town or building level; a jump under calm or
   * reduced motion. Returns the glide's seconds (0 for a jump).
   */
  goTo(
    point: { x: number; y: number },
    room: TownLayout["buildings"][number]["rooms"][number] | null,
    calm: boolean,
  ) {
    const camera = this.camera;
    if (!camera) return 0;
    const out = this.level === "town" || this.level === "overview";
    const z =
      out && room ? Math.max(camera.z, roomZoom(camera, room)) : camera.z;
    this.invalidate("go-to");
    if (calm || camera.reducedMotion) {
      camera.jumpTo(point.x, point.y, z);
      return 0;
    }
    const seconds = 0.6;
    camera.flyTo(point.x, point.y, z, seconds, { level: !out });
    // A flight that dips out for a long trip takes a quarter second more.
    return out ? seconds + 0.25 : seconds;
  }

  zoomToRoom(layout: TownLayout, roomKey: string) {
    const camera = this.camera;
    if (!camera) return;
    const room = layout.buildings
      .flatMap((b) => b.rooms)
      .find((r) => r.key === roomKey);
    if (!room) return;
    const z = roomZoom(camera, room);
    const focus = townRoomFocus(room, camera.viewport, z);
    camera.flyTo(focus.x, focus.y, z, 0.6);
    this.invalidate("room");
  }

  /**
   * Keep the zoom and pan so a building's reception board, which stands in
   * the yard above its front door, has room on screen above the lobby.
   */
  revealReception(layout: TownLayout, hostKey: string) {
    const camera = this.camera;
    if (!camera) return;
    const building = layout.buildings.find((b) => b.hostKey === hostKey);
    if (!building) return;
    // The board's foot (TownWorldLayer), and the screen it should show in.
    const x = (building.entryX + 0.5) * T;
    const y = building.y * T - 18;
    const at = camera.toScreen(x, y);
    const { width, height, inset } = camera.viewport;
    const room = Math.min(
      RECEPTION_BOARD_ROOM,
      (height - inset.top - inset.bottom) / 2,
    );
    if (
      at.x >= inset.left + 100 &&
      at.x <= width - inset.right - 100 &&
      at.y >= inset.top + room &&
      at.y <= height - inset.bottom
    )
      return;
    // flyTo puts its point at the focus point: the foot lands `room` below
    // the top, the lobby under it. A level flight: dipping out would leave
    // desk level, which puts the board away again (TownCanvas).
    const focus = camera.focusPoint();
    camera.flyTo(
      x,
      y - (inset.top + room - focus.y) / camera.z,
      camera.z,
      0.4,
      { level: true },
    );
    this.invalidate("reception");
  }

  zoomToBuilding(layout: TownLayout, hostKey: string) {
    const camera = this.camera;
    if (!camera) return;
    const building = layout.buildings.find((b) => b.hostKey === hostKey);
    if (!building) return;
    const z = buildingZoom(camera, building);
    camera.flyTo(
      (building.x + building.w / 2) * T,
      (building.y + (building.h + TOWN_FACADE) / 2) * T,
      z,
      0.8,
    );
    this.invalidate("building");
  }

  /**
   * A room to move to (a new `seq` asks again). It waits for a ready camera
   * and a layout that has the room, then runs once.
   */
  roomFocus(
    request: { roomKey: string; seq: number } | null,
    layout: TownLayout,
  ) {
    if (
      !request ||
      !this.camera ||
      this.consumedRoomFocus === request.seq ||
      !layout.buildings.some((building) =>
        building.rooms.some((room) => room.key === request.roomKey),
      )
    )
      return;
    this.zoomToRoom(layout, request.roomKey);
    this.consumedRoomFocus = request.seq;
  }
}
