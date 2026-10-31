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
import type { TownTarget } from "../townTargets";

export type TownPose = { x: number; y: number; z: number };

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
    camera.configure(layout, viewport);
    const saved = this.poses.get(townShapeKey(layout.shape));
    if (saved) {
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

  /** Frame the town's home view: every building, or the first on a phone. */
  frameHome(layout: TownLayout, viewport: TownViewport, animate: boolean) {
    const camera = this.camera;
    const limits = camera?.limits;
    if (!camera || !limits) return;
    if (layout.formFactor === "narrow") {
      const first = layout.buildings[0];
      const x = (layout.width * T) / 2;
      const focus = camera.focusPoint();
      const y = first
        ? first.y * T - 24 + (focus.y - viewport.inset.top) / limits.home
        : (layout.height * T) / 2;
      if (animate) camera.flyTo(x, y, limits.home);
      else camera.jumpTo(x, y, limits.home);
    } else if (animate)
      camera.flyTo(
        (layout.width * T) / 2,
        (layout.height * T) / 2,
        limits.home,
      );
    else
      camera.jumpTo(
        (layout.width * T) / 2,
        (layout.height * T) / 2,
        limits.home,
      );
    this.home =
      !animate && !camera.flying
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
   * A new layout: a new shape returns to its saved pose (or home); rooms that
   * moved under a still camera keep the room in view where it was.
   */
  follow(layout: TownLayout, viewport: TownViewport) {
    const camera = this.camera;
    if (!camera) return;
    const shapeKey = townShapeKey(layout.shape);
    const shapeChanged = camera.limits !== null && shapeKey !== this.lastShape;
    const previous = this.lastLayout;
    camera.configure(layout, viewport);
    if (shapeChanged) {
      const saved = this.poses.get(shapeKey);
      if (saved) camera.jumpTo(saved.x, saved.y, saved.z);
      else this.frameHome(layout, viewport, false);
    } else if (
      previous &&
      previous !== layout &&
      !camera.flying &&
      townGeometryKey(previous) !== townGeometryKey(layout)
    ) {
      const focus = camera.focusPoint();
      const at = camera.toWorld(focus.x, focus.y);
      const shift = townReflowShift(previous, layout, at);
      if (shift.x || shift.y) {
        camera.jumpTo(at.x + shift.x, at.y + shift.y, camera.z);
        this.invalidate("reflow");
      }
    }
    this.lastShape = shapeKey;
    this.lastLayout = layout;
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
