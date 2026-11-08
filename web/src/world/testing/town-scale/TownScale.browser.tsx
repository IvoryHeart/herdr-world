/*
 * The Town scale scene in the production TownCanvas, for the legibility
 * report's captures and pan frame-time measurement (scripts/town-scale.ts).
 * Real time, real motion: this page measures, it does not compare pixels.
 */
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";

import { createRoot } from "react-dom/client";
import { WebGLRenderer } from "pixi.js";
import { TownCanvas, type TownRoomActions } from "../../town/TownCanvas";
import { buildWorldObject } from "../../worldObject";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../../officeObservability";
import { townScaleConnections } from "../../town/townScaleScene";
import { useState } from "react";
import { TownStepStore } from "../../town/townStepStore";
import { useTownStepReads } from "../../town/useTownStepReads";
import type { WorldLeafObject } from "../../worldObject";
import "../../../styles/tokens.css";
import "../../../styles/base.css";
import "../../world.css";

const noAction = () => {};
const unavailable = async () => "returned" as const;
const roomActions: TownRoomActions = {
  showCreateSeat: () => true,
  canCreateSeat: () => true,
  createSeatReason: () => null,
  onNewAgent: noAction,
  canCreateRoom: () => true,
  createRoomReason: () => null,
  onCreateRoom: noAction,
  addRoomState: () => ({ visible: true, enabled: true, reason: null }),
  onAddRoom: noAction,
  canRenameRoom: () => true,
  onRenameRoom: noAction,
  canCloseRoom: () => true,
  onCloseRoom: noAction,
  onChoosePanes: noAction,
  onMoveDesk: noAction,
  onMoveAgent: noAction,
  placeColor: () => null,
  onDropDesk: unavailable,
  onReorderDesk: unavailable,
  onDropAgent: unavailable,
  onGroupDesk: unavailable,
  onUngroupDesk: unavailable,
};

// GPU submission cost per Pixi render call, in milliseconds.
const renderCost: number[] = [];
const paint = WebGLRenderer.prototype.render;
WebGLRenderer.prototype.render = function (...args: unknown[]) {
  const began = performance.now();
  Reflect.apply(paint, this, args);
  renderCost.push(performance.now() - began);
};

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = () => window.__HERDR_TOWN_RENDERER__!;

/** Waits until the camera and actors stop moving, or `limit` ms pass. */
async function settle(limit = 6000) {
  const began = performance.now();
  let calm = 0;
  while (performance.now() - began < limit) {
    await frame();
    const s = stats();
    calm = s.flying || s.transitioning || s.walking ? 0 : calm + 1;
    if (calm >= 30) break;
  }
  return {
    level: stats().level,
    zoom: stats().zoom,
    bubbles: document.querySelectorAll(".town-step").length,
  };
}

function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `.town-zoom button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No ${label} button`);
  button.click();
}

/** Percentile of a sorted copy. */
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
}

/** `?steps=off` measures the town without thought bubbles. */
const withSteps = new URLSearchParams(location.search).get("steps") !== "off";

/** The scene's working agents show synthetic steps, as on `?scene=town-scale`. */
function SceneSteps({
  leaves,
  children,
}: {
  leaves: readonly WorldLeafObject[];
  children: (steps: TownStepStore | undefined) => React.ReactNode;
}) {
  const [store] = useState(() => new TownStepStore());
  useTownStepReads(store, withSteps ? leaves : [], true);
  return children(withSteps ? store : undefined);
}

const scale = {
  ready: (async () => {
    const world = buildWorldObject(townScaleConnections(), "scene-atlas");
    const projection = projectWorldOffice(
      world,
      Date.now(),
      null,
      TOWN_PRESENTATION_BOUNDS,
    );
    createRoot(document.getElementById("root")!).render(
      <div className="town-stage" style={{ position: "fixed", inset: 0 }}>
        <SceneSteps leaves={world.leaves}>
          {(steps) => (
            <TownCanvas
              projection={projection}
              steps={steps}
              selectedKey={null}
              completionSeenKeys={new Set()}
              conversationTargets={[]}
              onSelect={noAction}
              onActivateAgent={noAction}
              onActivateRoom={noAction}
              roomActions={roomActions}
              selectedRoomKey={null}
              observability={EMPTY_OFFICE_OBSERVABILITY}
            />
          )}
        </SceneSteps>
      </div>,
    );
    while (!window.__HERDR_TOWN_RENDERER__?.ready) await frame();
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "",
      desks: stats().desks,
      actors: stats().actors,
      ...(await settle(10_000)),
    };
  })(),
  /** Whole town (ALL), then each Zoom in step: building, room, desk. */
  async zoom(step: "all" | "in") {
    click(step === "all" ? "Show the whole town" : "Zoom in");
    return settle();
  },
  /**
   * Starts recording frame intervals, Pixi render cost and camera motion:
   * `moved` counts frames whose drawn camera differs from the previous frame.
   */
  record() {
    renderCost.length = 0;
    const intervals: number[] = [];
    let last = performance.now();
    let pose = stats().camera.x;
    let moved = 0;
    let running = true;
    const tick = (now: number) => {
      intervals.push(now - last);
      last = now;
      if (stats().camera.x !== pose) moved++;
      pose = stats().camera.x;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return {
      stop() {
        running = false;
        const costs = [...renderCost];
        return {
          frames: intervals.length,
          moved,
          intervalP50: percentile(intervals, 0.5),
          intervalP95: percentile(intervals, 0.95),
          intervalMax: Math.max(0, ...intervals),
          over33: intervals.filter((ms) => ms > 33.4).length,
          renderP50: percentile(costs, 0.5),
          renderP95: percentile(costs, 0.95),
          renders: costs.length,
        };
      },
    };
  },
};

/** World pixels one arrow press pans (townSceneCamera's 60 screen pixels). */
const keyStep = () => 60 / stats().zoom;

/**
 * Pans with the arrow keys, one press per frame, back and forth between the
 * camera's horizontal bounds: it reverses before a press would reach an edge,
 * so every press moves the camera a full step. Returns the frame timing.
 */
async function pan(frames: number) {
  const host = document.querySelector<HTMLElement>(
    '[aria-label^="Office town."]',
  );
  if (!host) throw new Error("No town host");
  const { x: start, width } = stats().camera;
  const step = keyStep();
  if (width < 2 * step)
    throw new Error(`Town is ${width}px wide; one key step is ${step}px`);
  let x = start;
  let direction = 1;
  const recording = scale.record();
  for (let i = 0; i < frames; i++) {
    if (x + direction * step > width || x + direction * step < 0)
      direction = -direction;
    x += direction * step;
    const key = direction > 0 ? "ArrowRight" : "ArrowLeft";
    host.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await frame();
  }
  return recording.stop();
}

/** Records `frames` frames of the scene with no input. */
async function idle(frames: number) {
  const recording = scale.record();
  for (let i = 0; i < frames; i++) await frame();
  return recording.stop();
}
Object.assign(window, { townScale: { ...scale, pan, idle } });
