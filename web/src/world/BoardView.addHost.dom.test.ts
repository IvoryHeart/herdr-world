import { expect, test } from "bun:test";
import { Window } from "happy-dom";

// Board's half of Add host (addHost.ts): a host added with no workspaces
// still shows a zone, and Board frames it. Runs in its own process so
// happy-dom and the stubbed timers stay out of other tests.
if (process.env.BOARD_ADD_HOST_DOM_TEST !== "1") {
  test("Add host frames a new host that has no workspaces yet", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, BOARD_ADD_HOST_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  test("an empty host's zone shows, and its arrival frames it", async () => {
    const browser = new Window({
      url: "https://world.example.test",
      width: 1280,
      height: 800,
    });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      Event: browser.Event,
      CustomEvent: browser.CustomEvent,
      MutationObserver: browser.MutationObserver,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(browser.HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 800,
    });

    // Board's own tasks and frames are delivered explicitly.
    const tasks = new Map<number, () => void>();
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    for (const target of [globalThis, browser])
      Object.defineProperties(target, {
        setTimeout: {
          configurable: true,
          writable: true,
          value: (callback: () => void) => {
            tasks.set(++sequence, callback);
            return sequence;
          },
        },
        clearTimeout: {
          configurable: true,
          writable: true,
          value: (id: number) => tasks.delete(id),
        },
        requestAnimationFrame: {
          configurable: true,
          writable: true,
          value: (callback: FrameRequestCallback) => {
            frames.set(++sequence, callback);
            return sequence;
          },
        },
        cancelAnimationFrame: {
          configurable: true,
          writable: true,
          value: (id: number) => frames.delete(id),
        },
      });
    let now = 0;
    const run = (count: number) => {
      for (let i = 0; i < count; i++) {
        for (const [id, task] of [...tasks]) {
          tasks.delete(id);
          task();
        }
        now += 16;
        for (const [id, frame] of [...frames]) {
          frames.delete(id);
          frame(now);
        }
      }
    };

    const { act, createElement: h } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { bridge } = await import("../api");
    bridge.call = (() =>
      Promise.reject(new Error("not connected"))) as typeof bridge.call;
    bridge.onControl = () => () => {};
    bridge.onStatus = () => () => {};
    const { worldSourcesStore } = await import("./worldSources");
    worldSourcesStore.useFetch(() => new Promise<Response>(() => {}));
    const { initializeLayoutPreferences } = await import(
      "../layoutPreferences"
    );
    const { initializeShortcutPreferences } = await import(
      "../shortcutPreferences"
    );
    initializeLayoutPreferences();
    initializeShortcutPreferences();
    const { fixtureHost, fixtureWorld } = await import("./board/boardFixture");
    const { hostArrivals } = await import("./addHost");
    const { default: BoardView } = await import("./BoardView");

    const world = fixtureWorld([
      fixtureHost(
        "alpha",
        Array.from({ length: 4 }, (_, space) => ({
          label: `space-${space}`,
          tabs: [{ label: "terminal", panes: [["idle", false]] }],
        })),
      ),
      fixtureHost("fresh", []),
    ]);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          h(BoardView, {
            world,
            selectedId: null,
            onSelect() {},
            onOpen() {},
            onNodeAnchorsChange() {},
            onSelectedAnchorChange() {},
          }),
        ),
      );
      await act(async () => run(5));
      const zone = host
        .querySelector('[data-world-node-anchor="host:fresh"]')
        ?.closest<HTMLElement>(".board-zone");
      // Visible before it has any workspace, with its New workspace button.
      expect(zone?.hidden).toBe(false);
      expect(
        zone?.querySelector('[aria-label="New workspace on fresh"]'),
      ).not.toBeNull();

      const world_ = host.querySelector<HTMLElement>(".board-world")!;
      const before = world_.style.transform;
      await act(async () => hostArrivals.arrive("fresh"));
      await act(async () => run(120));
      // Board framed it and settled the arrival.
      expect(hostArrivals.get()).toBe(null);
      const [, x, y, s] = world_.style.transform
        .match(/translate\((.+)px, (.+)px\) scale\((.+)\)/)!
        .map(Number);
      expect(world_.style.transform).not.toBe(before);
      // The zone's centre is the middle of the board's view.
      const match = zone!.style.transform.match(/translate\((.+)px, (.+)px\)/)!;
      const zoneX = Number(match[1]) + Number.parseFloat(zone!.style.width) / 2;
      expect(Math.abs(x! + zoneX * s! - (12 + (1280 - 24) / 2))).toBeLessThan(
        2,
      );
      expect(Number.isFinite(y)).toBe(true);
    } finally {
      await act(async () => root.unmount());
      await browser.happyDOM.close();
    }
  });
}
