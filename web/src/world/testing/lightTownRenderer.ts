/**
 * Behaviour-only TownRendererHandle. World projection, scene derivation,
 * layout, camera, actor goals, DOM controls and action authority stay real.
 * It omits Pixi textures/effects and never issues a capture draw receipt.
 * Raster, animation and native performance suites keep the production renderer.
 */
import {
  TownActors,
  townActorWorld,
  type TownActorWorld,
} from "../town/townActors";
import { TownCamera, townLevel } from "../town/townCamera";
import { townGeometryKey } from "../town/townLayout";
import { townPlaceBoxes } from "../town/townPlaces";
import { diagnostics } from "../town/townDiagnostics";
import { registerTownFrames } from "../town/townFrameLifecycle";
import type { createTownRenderer } from "../town/townRenderer";
import type { TownSceneFrame } from "../town/scene/townSceneDiff";

const active = new WeakMap<object, Set<{ ready: boolean }>>();

export const createLightTownRenderer: typeof createTownRenderer = async (
  element,
  onFrame,
  signal,
  onError,
  onTrace,
  camera = new TownCamera(),
  _onDrawn,
  onInvalidate,
) => {
  if (signal?.aborted) throw new Error("renderer disposed");
  const stats = diagnostics();
  stats.mounts++;
  const handles = active.get(stats) ?? new Set<{ ready: boolean }>();
  active.set(stats, handles);
  const self = { ready: false };
  handles.add(self);
  const canvas = document.createElement("canvas");
  canvas.dataset.officeCanvas = "true";
  canvas.dataset.testRenderer = "light";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;touch-action:none";
  // No backing pixels are needed: semantic targets use the actual Town camera.
  canvas.width = canvas.height = 1;
  element.replaceChildren(canvas);
  const actors = new TownActors();
  let actorWorld: TownActorWorld | null = null;
  let scene: TownSceneFrame | undefined;
  let last: number | undefined;
  let disposed = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  camera.reducedMotion = motion.matches;
  const request = (reason: string) => {
    if (disposed) return;
    if (reason !== "capture") onInvalidate?.(reason);
    frames.request("state");
  };
  const frames = registerTownFrames(
    element,
    canvas,
    (now) => {
      if (!scene || disposed) return;
      try {
        const elapsed =
          last === undefined ? 1 / 60 : Math.max(0, (now - last) / 1000);
        last = now;
        const moving = camera.update(Math.min(0.05, elapsed));
        const walking = actors.step(
          camera.reducedMotion ? 10 : Math.min(0.05, elapsed),
          elapsed,
        );
        const level = townLevel(camera.z, camera.limits!);
        onFrame(camera, level);
        stats.frames++;
        self.ready = stats.ready = true;
        stats.level = level;
        stats.zoom = camera.z;
        stats.camera = { x: camera.x, y: camera.y, ...camera.bounds };
        stats.flying = camera.flying;
        stats.transitioning = camera.gliding;
        stats.actors = actors.actors.size;
        stats.walking = [...actors.actors.values()].filter(
          (actor) => actor.mode === "walk",
        ).length;
        const next = moving || walking || camera.flying || camera.gliding;
        onTrace?.({
          reasons: ["behaviour"],
          next: next ? "state" : null,
          causes: next ? ["camera/actors"] : [],
        });
        // No ambient ticker. Advance only requested scene/camera/actor work.
        if (next) frames.request("state");
      } catch (error) {
        stats.lastError = String(error);
        onError?.(error);
      }
    },
    (paused) => {
      stats.interactionPaused = paused;
    },
  );
  const onMotion = () => {
    camera.reducedMotion = motion.matches;
    stats.reducedMotion = motion.matches;
    request("motion-preference");
  };
  motion.addEventListener("change", onMotion);
  return {
    camera,
    get level() {
      return townLevel(camera.z, camera.limits!);
    },
    apply(next) {
      scene = next;
      const { model, layout, state, dirty } = next;
      camera.calm = state.calm;
      camera.configure(layout, camera.viewport);
      if (dirty.scene || dirty.actors.size) {
        actorWorld = townActorWorld(layout, model, actorWorld);
        actors.sync(
          actorWorld,
          dirty.first || camera.reducedMotion,
          state.summonedKeys,
          state.askingKeys,
          dirty.first ? undefined : dirty.actors,
          state.awayKeys,
          state.heldKeys,
          state.arrivingKeys,
        );
      }
      stats.summoned = [...state.summonedKeys].filter(
        (key) => actors.actors.get(key)?.goal?.kind === "seat",
      );
      stats.held = [...(state.heldKeys ?? [])].filter(
        (key) => actors.actors.get(key)?.goal?.kind === "seat",
      );
      stats.desks = model.desks.size;
      stats.layout = {
        width: layout.width,
        height: layout.height,
        buildings: layout.buildings.length,
        rooms: layout.buildings.reduce((sum, b) => sum + b.rooms.length, 0),
        formFactor: layout.shape.formFactor,
        roomColumns: layout.shape.roomColumns,
        deskColumns: layout.shape.deskColumns,
        geometry: townGeometryKey(layout),
        places: Object.fromEntries(townPlaceBoxes(layout)),
      };
      request("scene");
    },
    setViewport(viewport) {
      camera.viewport = viewport;
      if (scene) camera.configure(scene.layout, viewport);
      request("viewport");
    },
    invalidate: request,
    actorPosition(key) {
      const actor = actors.actors.get(key);
      return actor && actor.mode !== "out"
        ? { x: actor.x, y: actor.y, seated: actor.mode === "seat" }
        : null;
    },
    // Effects are deliberately absent; interaction and move outcomes are
    // exercised by TownCanvas and its real World actions above this port.
    roofAlpha: () =>
      camera.limits && townLevel(camera.z, camera.limits) !== "overview"
        ? 0
        : 1,
    buildingMotion: () => null,
    setWaitingStops() {},
    beginDrag() {},
    moveDrag() {},
    endDrag() {},
    finishMove() {
      request("move-result");
    },
    beginGlide() {
      request("room-move");
    },
    finishGlide() {
      request("room-result");
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      frames.dispose();
      motion.removeEventListener("change", onMotion);
      canvas.remove();
      stats.destroys++;
      handles.delete(self);
      stats.ready = [...handles].some((handle) => handle.ready);
    },
  };
};
