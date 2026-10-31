import { clock } from "./install";
import { createRoot } from "react-dom/client";
import { WebGLRenderer } from "pixi.js";
import { TownCanvas, type TownRoomActions } from "../../town/TownCanvas";
import { buildWorldObject } from "../../worldObject";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../../officeObservability";
import { goldenConnections } from "./scene";
import { comparePixels } from "./pixels";
import "../../../styles/tokens.css";
import "../../../styles/base.css";
import "../../world.css";
import "./fonts.css";

const noAction = () => {};
const unavailable = async () => "returned" as const;
const roomActions: TownRoomActions = {
  showCreateSeat: () => true,
  canCreateSeat: () => true,
  createSeatReason: () => null,
  onNewAgent: noAction,
  showCreateRoom: () => true,
  canCreateRoom: () => true,
  createRoomReason: () => null,
  onCreateRoom: noAction,
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

async function prepare() {
  // Fonts load before any DOM measurements, canvas labels or texture generation.
  await Promise.all([
    document.fonts.load('400 14px "Golden Sans"'),
    document.fonts.load('700 14px "Golden Sans"'),
    document.fonts.load('400 14px "Silkscreen"'),
    document.fonts.load('700 14px "Silkscreen"'),
    document.fonts.load('400 14px "Golden Sans"', "✓"),
  ]);
  await document.fonts.ready;
  if (document.fonts.size < 5) throw new Error("Reference fonts did not load");
  // Pay shader compilation/upload before the measured scene is mounted.
  const warm = document.createElement("canvas");
  const gl = warm.getContext("webgl2")!;
  if (!gl) throw new Error("WebGL2 unavailable");
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = String(gl.getParameter(extension!.UNMASKED_RENDERER_WEBGL));
  if (!/SwiftShader/i.test(gpu))
    throw new Error(`Expected SwiftShader: ${gpu}`);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.finish();
  gl.getExtension("WEBGL_lose_context")?.loseContext();

  // Keep every production scene/animation step, but rasterize only the first
  // warm-up frame and the final checkpoint. Intermediate GPU paints are not
  // observed by a still-image comparison and dominate SwiftShader CI cost.
  const originalPaint = WebGLRenderer.prototype.render;
  const paints = { count: 0, pending: () => {} };
  WebGLRenderer.prototype.render = function (...args: unknown[]) {
    const paint = () => {
      paints.count++;
      Reflect.apply(originalPaint, this, args);
    };
    if (paints.count === 0) paint();
    else paints.pending = paint;
  };

  const projection = projectWorldOffice(
    buildWorldObject(goldenConnections(), "host-0"),
    Date.now(),
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  createRoot(document.getElementById("root")!).render(
    <div className="town-stage" style={{ position: "fixed", inset: 0 }}>
      <TownCanvas
        projection={projection}
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
    </div>,
  );
  await clock.until(
    () => !!window.__HERDR_TOWN_RENDERER__?.ready,
    "Town never rendered",
    30_000,
  );
  const firstFrame = clock.now();
  // Motion stays enabled. Fixed steps settle camera, roofs and walking actors;
  // elapsed simulation time is relative to the first production renderer frame.
  await clock.advance(6000);
  paints.pending();
  WebGLRenderer.prototype.render = originalPaint;
  const stats = window.__HERDR_TOWN_RENDERER__!;
  if (stats.lastError || stats.flying || stats.walking || stats.desks !== 16)
    throw new Error(`Town did not settle: ${JSON.stringify(stats)}`);
  return {
    gpu,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    firstFrame,
    captureAt: clock.now(),
    frames: stats.frames,
    gpuPaints: paints.count,
    desks: stats.desks,
    layout: stats.layout,
  };
}

async function compare(expected: string, actual: string) {
  async function decode(png: string) {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return {
      canvas,
      context,
      data: context.getImageData(0, 0, image.width, image.height).data,
    };
  }
  const [a, b] = await Promise.all([decode(expected), decode(actual)]);
  if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height)
    throw new Error("Golden dimensions differ");
  const { changed, diff } = comparePixels(
    a.data,
    b.data,
    a.canvas.width,
    a.canvas.height,
  );
  if (changed)
    b.context.putImageData(
      new ImageData(diff, b.canvas.width, b.canvas.height),
      0,
      0,
    );
  return {
    changed,
    diff: changed ? b.canvas.toDataURL("image/png").split(",")[1] : null,
  };
}

Object.assign(window, { golden: { ready: prepare(), compare } });
