import { clock } from "./install";
import { createRoot } from "react-dom/client";
import { WebGLRenderer } from "pixi.js";
import { TownCanvas, type TownRoomActions } from "../../town/TownCanvas";
import { TownPostProvider } from "../../town/TownPostOffice";
import { buildWorldObject } from "../../worldObject";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../../herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "../../officeObservability";
import { goldenConnections, goldenUsage } from "./scene";
import { bridge } from "../../../api";
import { comparePixels } from "./pixels";
import { setTownDaylightMode } from "../../town/townDaylight";
import { setTownWeatherMode } from "../../town/townWeather";
import { TOWN_GOLDEN_WEATHER } from "./weatherScenes";
import { holdTownOverlay } from "./overlayHold";
import { shipyardStore } from "../../shipyard/shipyardStore";
import {
  shipyardFixtureCatalog,
  shipyardFixtureSnapshot,
} from "../../shipyard/shipyardFixture";
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

  // The town's usage read answers with synthetic context readings, so nearly
  // full agents look tired at their desks; nothing contacts a runtime.
  const call = bridge.call.bind(bridge);
  bridge.call = (method, ...rest) =>
    method === "world.usage.get"
      ? Promise.resolve(goldenUsage())
      : call(method, ...rest);

  // The harbour reads the synthetic release pipeline in memory: the fixture
  // server has no Shipyard API, and a network answer would race the clock.
  shipyardStore.useFetch((input) => {
    const repo = new URL(String(input), location.href).searchParams.get("repo");
    const now = Date.now();
    return Promise.resolve(
      Response.json(
        repo
          ? shipyardFixtureSnapshot("ready", now, repo)
          : shipyardFixtureCatalog("ready", now),
      ),
    );
  });

  // Hold Town's time of day: following the clock would make the image depend
  // on the runner's time zone. Night shows the status lighting: lit and dark
  // rooms, each desk's state light and a waiting reception. Without a scene,
  // Town follows the real weather, which this fixture never has: the image
  // is Town without weather. A weather scene (?scene=) holds one weather.
  const scene = TOWN_GOLDEN_WEATHER.find(
    (s) => s.scene === new URLSearchParams(location.search).get("scene"),
  );
  setTownDaylightMode(scene?.time ?? "night");
  setTownWeatherMode(scene?.weather ?? "real");
  const projection = projectWorldOffice(
    buildWorldObject(goldenConnections(), "host-0"),
    Date.now(),
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  // The DOM overlay paints only at the checkpoint (overlayHold.ts, #1289).
  const revealOverlay = holdTownOverlay(document);
  const GOLDEN_POST = {
    counts: { asks: 1, needs: 2, done: 3, outbox: 1 },
  } as const;
  createRoot(document.getElementById("root")!).render(
    <div className="town-stage" style={{ position: "fixed", inset: 0 }}>
      {/* Fixed counts: the post office's sign reads them at a glance. */}
      <TownPostProvider source={GOLDEN_POST}>
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
      </TownPostProvider>
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
  const realFrame = clock.real.requestAnimationFrame;
  if (!realFrame) throw new Error("Real animation frames are unavailable");
  await revealOverlay(realFrame);
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
