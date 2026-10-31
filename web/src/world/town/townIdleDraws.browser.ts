import { TownSceneDiff } from "./scene/townSceneDiff";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import type { TestClock } from "../testing/testClock";
import {
  TOWN_STATIC_WORK_CEILINGS,
  workViolations,
} from "../testing/workCeilings";
import { layoutTown, townShapeFor, TOWN_TILE } from "./townLayout";
import { townModelFromProjection } from "./townModel";
import { checkTownContextRecovery } from "./townContextRecovery.browser";
import { createTownRenderer } from "./townRenderer";
import type { TownFrameTrace } from "./townDiagnostics";
import {
  advancePixiSystemTicker,
  holdPixiSystemTicker,
} from "./pixiSystemTicker";

/** Production Pixi and scheduler; only observation and elapsed time are synthetic. */
export async function checkTownIdleDraws(
  clock: TestClock,
  connections: WorldRuntimeConnection[],
  check: (condition: boolean, message: string) => void,
  failures: string[],
) {
  const element = document.createElement("div");
  element.style.cssText = "position:fixed;inset:0";
  document.body.append(element);
  const topology = townModelFromProjection(
    projectWorldOffice(
      buildWorldObject(connections, "alpha"),
      1,
      null,
      TOWN_PRESENTATION_BOUNDS,
    ),
  );
  const model = {
    ...topology,
    agents: new Map(
      [...topology.agents].map(([key, agent]) => [
        key,
        { ...agent, semanticStatus: "working" as const },
      ]),
    ),
  };
  const { layout } = layoutTown(
    model.input,
    townShapeFor(innerWidth, innerHeight),
  );
  let trace: TownFrameTrace | null = null;
  const renderer = await createTownRenderer(
    element,
    () => advancePixiSystemTicker(),
    undefined,
    undefined,
    (frame) => {
      trace = frame;
    },
  );
  holdPixiSystemTicker();
  const canvas = element.querySelector("canvas")!;
  try {
    const camera = renderer.camera;
    const state = {
      selectedKey: null,
      hoverKey: null,
      completionSeenKeys: new Set<string>(),
      summonedKeys: new Set<string>(),
      openHostKey: null,
      calm: false,
    };
    renderer.apply(new TownSceneDiff().next(model, layout, state));
    renderer.setViewport({
      width: innerWidth,
      height: innerHeight,
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    camera.jumpTo(
      (layout.width * TOWN_TILE) / 2,
      (layout.height * TOWN_TILE) / 2,
      camera.limits!.min,
    );
    renderer.invalidate();
    const town = () => window.__HERDR_TOWN_RENDERER__!;
    // Wait for actual camera/roof/actor/materialization completion, not a
    // fixed animation tail. Do not wait for next === null: unwanted ambient
    // requests must reach the zero-draw assertions below.
    const settle = () =>
      clock.until(
        () => trace !== null && trace.causes.length === 0,
        "Town state transitions never settled",
      );
    await clock.until(
      () => town().ready && town().frames > 0,
      "Town never drew a frame",
    );
    await settle();
    check(
      renderer.level === "town",
      "Static case must cover animated interiors with roofs",
    );
    for (let second = 0; second < 3; second += 1) {
      const before = town().frames;
      await clock.advance(1000);
      failures.push(
        ...workViolations(
          { idle: { draws: town().frames - before } },
          TOWN_STATIC_WORK_CEILINGS,
          `Town second ${second + 1}`,
        ),
      );
    }
    await checkTownContextRecovery(canvas, clock, () => town().frames, check);
    check(
      town().lastError === null,
      `Context recovery draw failed: ${town().lastError}`,
    );
    const stateBefore = town().frames;
    renderer.invalidate("test-state");
    renderer.invalidate("test-state-coalesced");
    await clock.advance(100);
    check(
      town().frames === stateBefore + 1,
      "A sleeping Town must coalesce one state paint",
    );
    // A state change must wake a sleeping scene and retain visible motion.
    const before = town().frames;
    const room = layout.buildings[0]!.rooms[0]!;
    trace = null;
    camera.flyTo(
      (room.x + room.w / 2) * TOWN_TILE,
      (room.y + room.h / 2) * TOWN_TILE,
      camera.limits!.desk,
      0.16,
    );
    renderer.invalidate("test-flight");
    await clock.advance(128);
    check(
      town().frames - before >= 6,
      "Camera flight lost its smooth frame cadence",
    );
    await settle();
    const animated = town().frames;
    // Eight frames distinguish a continuing pulse from a lone state paint.
    // Drawing seconds of the same pulse adds GPU cost, not coverage.
    await clock.advance(128);
    check(
      !town().flying && town().walking === 0,
      "Ambient measurement must be settled",
    );
    check(
      town().frames - animated >= 6,
      "Visible pulses lost their smooth frame cadence",
    );
    trace = null;
    camera.jumpTo(
      (layout.width * TOWN_TILE) / 2,
      (layout.height * TOWN_TILE) / 2,
      camera.limits!.min,
    );
    renderer.invalidate("test-cover-again");
    await settle();
    const covered = town().frames;
    await clock.advance(1000);
    failures.push(
      ...workViolations(
        { idle: { draws: town().frames - covered } },
        TOWN_STATIC_WORK_CEILINGS,
        "Town covered again",
      ),
    );
  } finally {
    renderer.destroy();
    const frames = window.__HERDR_TOWN_RENDERER__!.frames;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await clock.advance(1000);
    check(
      window.__HERDR_TOWN_RENDERER__!.frames === frames,
      "Disposed animation woke the renderer",
    );
    element.remove();
  }
}
