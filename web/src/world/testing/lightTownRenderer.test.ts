import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { injectClock } from "../../clock";
import { createLightTownRenderer } from "./lightTownRenderer";
import { manualClock, office } from "../town/scene/townScene.fixture";
import { TownScene } from "../town/scene/townScene";
import { TownSceneDiff } from "../town/scene/townSceneDiff";
import { townShapeFor } from "../town/townLayout";

test("behaviour renderer keeps real scene/camera/actors, draws on demand and cannot certify pixels", async () => {
  const browser = new Window();
  Object.assign(browser, { __HERDR_WORLD_RENDERER_DEBUG__: "counters" });
  const names = ["window", "document", "Element"] as const;
  const saved = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  Object.assign(globalThis, {
    window: browser,
    document: browser.document,
    Element: browser.Element,
  });
  const tasks = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0,
    now = 0;
  const restoreClock = injectClock({
    now: () => now,
    monotonic: () => now,
    setTimeout: (run) => {
      tasks.set(++id, run);
      return id;
    },
    clearTimeout: (id) => {
      tasks.delete(id!);
    },
    setInterval: () => {
      throw new Error("no free-running ticker");
    },
    clearInterval() {},
    requestAnimationFrame: (run) => {
      frames.set(++id, run);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
  });
  const element = browser.document.createElement("div");
  browser.document.body.append(element);
  const scene = new TownScene(manualClock().clock, () => {});
  let sibling: Awaited<ReturnType<typeof createLightTownRenderer>> | undefined;
  let renderer: Awaited<ReturnType<typeof createLightTownRenderer>> | undefined;
  try {
    const semantics = scene.derive({
      projection: office({ room: ["working"] }),
      terminalColors: {},
      deskPins: {},
      relations: { relations: [], places: new Map() },
      sources: {
        observedAt: 0,
        refreshing: false,
        sources: [],
        items: [],
        links: [],
        actions: [],
      },
      shape: townShapeFor(390, 844),
      foldRevision: 0,
    });
    let drawn = 0,
      captures = 0;
    renderer = await createLightTownRenderer(
      element as unknown as HTMLElement,
      () => {
        drawn++;
      },
      undefined,
      (error) => {
        throw error;
      },
      undefined,
      undefined,
      () => {
        captures++;
      },
    );
    renderer.setViewport({
      width: 390,
      height: 844,
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const sceneFrame = new TownSceneDiff().next(
      semantics.model,
      semantics.layout,
      {
        selectedKey: null,
        hoverKey: null,
        completionSeenKeys: new Set(),
        summonedKeys: new Set(),
        openHostKey: null,
        calm: false,
      },
    );
    renderer.apply(sceneFrame);
    renderer.camera.jumpTo(
      semantics.layout.width * 16,
      semantics.layout.height * 16,
      renderer.camera.limits!.home,
    );
    expect(drawn).toBe(0);
    const step = () => {
      now += 16;
      const pending = [...tasks.values()];
      tasks.clear();
      for (const run of pending) run();
      const pendingFrames = [...frames.values()];
      frames.clear();
      for (const run of pendingFrames) run(now);
    };
    for (let frame = 0; frame < 100 && (tasks.size || frames.size); frame++)
      step();
    expect(drawn).toBeGreaterThan(0);
    const atRest = drawn;
    step();
    step();
    expect(drawn).toBe(atRest);
    const agent = [...semantics.model.agents.keys()][0]!;
    expect(renderer.actorPosition(agent)).not.toBeNull();
    expect(renderer.actorPosition("missing")).toBeNull();
    expect(
      element.querySelector('[data-test-renderer="light"]'),
    ).not.toBeNull();
    expect(element.querySelector("canvas")!.width).toBe(1);
    expect(captures).toBe(0);
    renderer.invalidate("selection");
    step();
    expect(drawn).toBe(atRest + 1);
    const siblingHost = browser.document.createElement("div");
    browser.document.body.append(siblingHost);
    sibling = await createLightTownRenderer(
      siblingHost as unknown as HTMLElement,
      () => {},
    );
    sibling.setViewport(renderer.camera.viewport);
    sibling.apply(sceneFrame);
    sibling.camera.jumpTo(
      renderer.camera.x,
      renderer.camera.y,
      renderer.camera.z,
    );
    for (let frame = 0; frame < 100 && (tasks.size || frames.size); frame++)
      step();
    renderer.invalidate("disposed");
    renderer.destroy();
    step();
    expect(drawn).toBe(atRest + 1);
    expect(tasks.size + frames.size).toBe(0);
    expect(element.childElementCount).toBe(0);
    expect(
      (
        browser as unknown as Window & {
          __HERDR_TOWN_RENDERER__: { ready: boolean };
        }
      ).__HERDR_TOWN_RENDERER__.ready,
    ).toBe(true);
    sibling.destroy();
    expect(
      (
        browser as unknown as Window & {
          __HERDR_TOWN_RENDERER__: { ready: boolean };
        }
      ).__HERDR_TOWN_RENDERER__.ready,
    ).toBe(false);
  } finally {
    renderer?.destroy();
    sibling?.destroy();
    scene.dispose();
    restoreClock();
    names.forEach((name, index) => {
      if (saved[index]) Object.defineProperty(globalThis, name, saved[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
    await browser.happyDOM.close();
  }
});
