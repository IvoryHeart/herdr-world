import { expect, test } from "bun:test";
import { Window } from "happy-dom";

const order = process.env.BOARD_MOUNT_ORDER;
const readTiming = process.env.BOARD_MOUNT_READ;

if (!order) {
  test.each([
    ["placement-first", "immediate"],
    ["frame-first", "immediate"],
    ["frame-before-build", "immediate"],
    ["frame-during-build", "immediate"],
    ["placement-first", "deferred"],
    ["frame-first", "deferred"],
    ["frame-before-build", "deferred"],
    ["frame-during-build", "deferred"],
  ])(
    "dense Board mount: %s, %s read rejection",
    async (order, readTiming) => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: {
          ...process.env,
          BOARD_MOUNT_ORDER: order,
          BOARD_MOUNT_READ: readTiming,
        },
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
    },
    15_000,
  );
} else {
  test("only placed, fitted geometry publishes overview and visible cards", async () => {
    const browser = new Window({
      url: "https://world.example.test",
      width: 390,
      height: 844,
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

    const observers = new Set<{ targets: Set<Element>; deliver(): void }>();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        targets = new Set<Element>();
        constructor(
          private callback: (entries: ResizeObserverEntry[]) => void,
        ) {
          observers.add(this);
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
        deliver() {
          if (this.targets.size) this.callback([]);
        }
      },
    });
    Object.defineProperty(browser.HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList.contains("board-controls-space") ? 366 : 390;
      },
    });
    Object.defineProperty(browser.HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 500,
    });
    browser.HTMLElement.prototype.getBoundingClientRect = function () {
      const measurement = this.closest(".board-controls-measure");
      return new browser.DOMRect(
        0,
        0,
        measurement
          ? this.classList.contains("board-control-work")
            ? 76
            : 44
          : 390,
        measurement ? 44 : 500,
      );
    };
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = ".board-controls-space { --board-control-phone: 1; }";

    const {
      act,
      createElement: h,
      Fragment,
      Profiler,
      startTransition,
      useState,
    } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { flushSync } = await import("react-dom");
    const { bridge } = await import("../api");
    const { fixtureHost, fixtureWorld } = await import("./board/boardFixture");
    const { default: BoardView } = await import("./BoardView");
    const { initializeLayoutPreferences } = await import(
      "../layoutPreferences"
    );
    const { initializeShortcutPreferences } = await import(
      "../shortcutPreferences"
    );
    initializeLayoutPreferences();
    initializeShortcutPreferences();

    const requests: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
    // The dense browser fixture has no connected global Bridge. Exercise
    // both immediate rejection and a reply held across the first frame.
    bridge.call = (() => {
      if (readTiming === "immediate")
        return Promise.reject(new Error("WebSocket not connected"));
      const request = Promise.withResolvers<unknown>();
      requests.push(request);
      return request.promise;
    }) as typeof bridge.call;
    bridge.connection = (
      connectionId = "synthetic",
      serverRuntimeGeneration = null,
    ) => ({
      connectionId,
      generation: 1,
      serverRuntimeGeneration,
      isCurrent: () => true,
      acceptsServerGeneration: (value) => value === serverRuntimeGeneration,
      call: async () => ({}),
    });
    bridge.onControl = () => () => {};
    bridge.onStatus = () => () => {};

    const tasks = new Map<number, { callback(): void; delay: number }>();
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    // React keeps its real scheduler; only the Board's native tasks and
    // animation frames are delivered explicitly, without advancing time.
    for (const target of [globalThis, browser]) {
      Object.defineProperties(target, {
        setTimeout: {
          configurable: true,
          writable: true,
          value: (callback: () => void, delay = 0) => {
            const id = ++sequence;
            tasks.set(id, { callback, delay });
            return id;
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
            const id = ++sequence;
            frames.set(id, callback);
            return id;
          },
        },
        cancelAnimationFrame: {
          configurable: true,
          writable: true,
          value: (id: number) => frames.delete(id),
        },
      });
    }
    const deliverTasks = (delay: number) => {
      for (const [id, task] of [...tasks])
        if (task.delay === delay) {
          tasks.delete(id);
          task.callback();
        }
    };
    let frameTime = 0;
    const deliverFrame = () => {
      deliverTasks(16);
      frameTime += 16;
      for (const [id, frame] of [...frames]) {
        frames.delete(id);
        frame(frameTime);
      }
    };
    const deliverObservers = () => {
      for (const observer of observers) observer.deliver();
    };
    const world = fixtureWorld(
      Array.from({ length: 64 }, (_, index) =>
        fixtureHost(
          `host-${index}`,
          Array.from({ length: 20 }, (_, space) => ({
            label: `space-${space}`,
            tabs: [{ label: "terminal", panes: [["idle", false]] }],
          })),
        ),
      ),
    );
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let commits = 0;
    try {
      const gate = Promise.withResolvers<void>();
      let gateRendered = false;
      let holdBuild: (held: boolean) => void = () => {};
      const Gate = () => {
        const [held, setHeld] = useState(false);
        holdBuild = setHeld;
        if (held && !gateRendered) {
          gateRendered = true;
          throw gate.promise;
        }
        return null;
      };
      const render = () =>
        root.render(
          h(
            Fragment,
            null,
            h(
              Profiler,
              { id: "board", onRender: () => commits++ },
              h(BoardView, {
                world,
                selectedId: null,
                onSelect() {},
                onOpen() {},
                onNodeAnchorsChange() {},
                onSelectedAnchorChange() {},
              }),
            ),
            h(Gate),
          ),
        );
      if (order === "frame-during-build") {
        // A dense transition renders in slices, so a frame can run after
        // BoardView's render and before its commit. A sibling suspending in
        // the same batch of transitions holds that render uncommitted while
        // the frame armed at mount runs.
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
        const turn = () => new Promise((resolve) => setImmediate(resolve));
        try {
          flushSync(render);
          startTransition(() => holdBuild(true));
          for (let turns = 0; !gateRendered; turns++) {
            if (turns > 1_000)
              throw new Error("dense transition never rendered");
            await turn();
          }
          expect(host.querySelector(".board-zone-label")).toBeNull();
          expect(
            frames.size > 0 ||
              [...tasks.values()].some((task) => task.delay === 16),
          ).toBe(true);
          const heldCommits = commits;
          deliverFrame();
          // Anything that frame published would render and commit in these
          // turns, ahead of the held transitions.
          for (let turns = 0; turns < 20; turns++) await turn();
          expect(commits).toBe(heldCommits);
          gate.resolve();
          for (
            let turns = 0;
            !host.querySelector(".board-zone-label");
            turns++
          ) {
            if (turns > 1_000)
              throw new Error("dense transition never committed");
            await turn();
          }
        } finally {
          Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        }
      } else
        await act(async () => {
          if (order === "frame-before-build") {
            flushSync(render);
            deliverFrame();
          } else render();
        });
      expect([...tasks.values()].some((task) => task.delay === 0)).toBe(true);
      if (order === "placement-first" || order === "frame-first")
        expect([...tasks.values()].some((task) => task.delay === 16)).toBe(
          true,
        );
      expect(
        host.querySelector(".board")?.classList.contains("board-far"),
      ).toBe(true);
      const mountedCommits = commits;
      await act(async () => deliverObservers());
      expect(commits).toBe(mountedCommits);
      let earlyFrameCommits = mountedCommits;
      if (order === "frame-first") {
        // An older scheduler task can be ready when the dense transition
        // registers placeModel's new 0ms task: rAF may precede placement.
        await act(async () => deliverFrame());
        earlyFrameCommits = commits;
      }
      await act(async () => deliverTasks(0));
      await act(async () => deliverFrame());
      await act(async () => {
        for (const request of requests)
          request.reject(new Error("WebSocket not connected"));
      });
      await act(async () => {
        deliverObservers();
        deliverFrame();
      });
      console.info(`${order}/${readTiming}: ${commits} Board commits`);
      // Every order commits the same work: scheduling adds no commit.
      expect(commits).toBe(5);
      expect(earlyFrameCommits).toBe(mountedCommits);
      expect(host.querySelectorAll(".board-card").length).toBeGreaterThan(0);
      expect(
        host.querySelector(".board")?.classList.contains("board-far"),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      await browser.happyDOM.close();
    }
  });
}
