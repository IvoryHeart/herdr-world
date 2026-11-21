import { expect, test } from "bun:test";

if (process.env.TOWN_BUS_COUNTDOWN_DOM !== "1") {
  test("Town's stop clocks and the bin read one countdown at every instant", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        new URL("../../testing/reactDomPreload.ts", import.meta.url).pathname,
        import.meta.path,
      ],
      {
        env: { ...process.env, TOWN_BUS_COUNTDOWN_DOM: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 20_000);
} else {
  const { act, createElement, Fragment } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { bridge } = await import("../../api");
  const { WorldBin } = await import("../bin/WorldBin");
  const { TownBusLayer, useTownBin } = await import("./TownBusLayer");
  const { resetTownBusDemo, townBusDemoShown } = await import("./townBusDemo");
  const { layoutTown, TOWN_SHAPES } = await import("./townLayout");
  type BinState = import("../../../../shared/bin").BinState;
  type BinEntry = import("../../../../shared/bin").BinEntry;
  type TownModel = import("./townModel").TownModel;

  // A manual clock for the page's second clock (setInterval) and the bus
  // (performance.now()); React keeps the real timers it captured on import.
  let clock = 0;
  let nextId = 1;
  const timers = new Map<
    number,
    { at: number; every: number; run: () => void }
  >();
  Object.defineProperty(performance, "now", {
    value: () => clock,
    configurable: true,
  });
  globalThis.setInterval = ((run: () => void, every = 0) => {
    const id = nextId++;
    timers.set(id, { at: clock + every, every, run });
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    timers.delete(id);
  }) as unknown as typeof clearInterval;
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.matchMedia = ((query: string) =>
    window.matchMedia(query)) as unknown as typeof matchMedia;
  const advanceTo = (time: number) => {
    for (;;) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= time)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock = due.at;
      due.at += due.every;
      due.run();
    }
    clock = time;
  };

  // The service's bin, as World's bridge serves it.
  let served: BinState;
  let notify: ((control: { type: string }) => void) | null = null;
  bridge.call = (async (method: string) => {
    if (method !== "world.bin.list") throw new Error(`unexpected ${method}`);
    return served;
  }) as typeof bridge.call;
  bridge.onControl = ((callback: (control: { type: string }) => void) => {
    notify = callback;
    return () => (notify = null);
  }) as unknown as typeof bridge.onControl;
  bridge.onStatus = (() => () => {}) as typeof bridge.onStatus;

  // Agents in three buildings, so riders wait at different stops.
  const hosts = { a: [1], b: [1], c: [1] };
  const { layout } = layoutTown(
    {
      hosts: Object.keys(hosts).map((key, displayOrder) => ({
        key,
        displayOrder,
      })),
      rooms: Object.entries(hosts).flatMap(([hostKey, counts]) =>
        counts.map((count, order) => ({
          key: `${hostKey}/r${order}`,
          hostKey,
          order,
          deskKeys: Array.from(
            { length: count },
            (_, i) => `${hostKey}/r${order}/t${i}`,
          ),
        })),
      ),
    },
    TOWN_SHAPES.wide,
  );
  const agents = Object.keys(hosts).map((host) => ({
    key: `${host}/agent`,
    hostKey: host,
    roomKey: `${host}/r0`,
    currentPaneRef: {
      connectionId: host,
      generation: 1,
      kind: "pane",
      nativeId: `${host}-pane`,
      worldId: `${host}-pane`,
    },
    currentTerminalRef: {
      connectionId: host,
      generation: 1,
      kind: "terminal",
      nativeId: `term-${host}`,
      worldId: `term-${host}`,
    },
  }));
  const model = {
    agents: new Map(agents.map((agent) => [agent.key, agent])),
  } as unknown as TownModel;
  const entry = (host: string, riding: boolean): BinEntry => ({
    id: `bin-${host}`,
    connection_id: host,
    connection_generation: 1,
    workspace_id: "w",
    tab_id: "t",
    pane_id: `${host}-pane`,
    terminal_id: `term-${host}`,
    label: `Agent ${host}`,
    view: "town",
    riding,
    preserve_tab: false,
  });
  const INTERVAL = 240_000;
  const TRIP = 45_000;
  let revision = 0;
  const serve = (
    entries: BinEntry[],
    bus: Partial<BinState["bus"]> & { next_ms: number },
  ) => {
    revision += 1;
    served = {
      epoch: "run",
      revision,
      entries,
      closing: [],
      outcomes: [],
      bus: {
        interval_ms: INTERVAL,
        trip_ms: TRIP,
        elapsed_ms: null,
        stopped: false,
        trip: null,
        ...bus,
      },
    };
  };

  function Stops() {
    const town = useTownBin(model, layout);
    return createElement(TownBusLayer, {
      bin: town.bin,
      route: town.route,
      riders: town.riders,
      returning: town.returning,
      lookOf: town.lookOf,
      framed: { current: null },
      renderer: { current: null },
    });
  }
  /** The bin's chip, and Town's stops once Town is open. */
  const Scene = ({ town }: { town: boolean }) =>
    createElement(
      Fragment,
      null,
      createElement(WorldBin, { always: true, bus: true }),
      town ? createElement(Stops) : null,
    );

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  /** The bin chip's words for the bus, and every stop sign's clock. */
  const shown = () => {
    const chip = host.querySelector(".world-bin-chip span")?.textContent ?? "";
    const stops = [...host.querySelectorAll(".town-bus-clock")].map(
      (clock) => clock.textContent ?? "",
    );
    return { chip, stops };
  };
  /** Both read the same countdown now; returns it. */
  const agree = () => {
    const { chip, stops } = shown();
    expect(stops.length).toBeGreaterThan(0);
    const countdown = chip.replace(/^bus (in )?/, "");
    expect(chip).not.toBe(countdown);
    for (const stop of stops) expect(stop).toBe(countdown);
    return countdown;
  };
  const changed = async () => {
    await act(async () => {
      notify?.({ type: "world_bin_changed" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  /** Steps a quarter second at a time to `time`, checking both each step. */
  const runTo = async (time: number) => {
    while (clock < time) {
      await act(async () => advanceTo(Math.min(time, clock + 250)));
      agree();
    }
  };

  test("stop clocks and the bin read one countdown at every instant", async () => {
    // One rider waits for a bus that sets off in a minute.
    serve([entry("a", false)], { next_ms: 60_000 });
    await act(async () => {
      root.render(createElement(Scene, { town: false }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(shown().chip).toBe("bus in 1:00");
    // Town opens a little later: its stops tick with the bin, not out of
    // step with it.
    await act(async () => advanceTo(600));
    await act(async () => root.render(createElement(Scene, { town: true })));
    expect(agree()).toBe("1:00");
    await runTo(3_600);
    expect(agree()).toBe("0:57");

    // A late rider joins at another stop: both stops and the bin still agree.
    clock = 3_700;
    serve([entry("a", false), entry("b", false)], {
      next_ms: 60_000 - 3_700,
    });
    await changed();
    expect(shown().stops).toHaveLength(2);
    expect(agree()).toBe("0:57");
    await runTo(9_100);
    expect(agree()).toBe("0:51");

    // The trip sets off: on its way, everywhere.
    clock = 60_000;
    serve([entry("a", true), entry("b", true)], {
      next_ms: INTERVAL,
      elapsed_ms: 0,
      trip: 1,
    });
    await changed();
    expect(agree()).toBe("on its way");
    // One joins while it is out: it waits for the next, and agrees too.
    clock = 70_000;
    serve([entry("a", true), entry("b", true), entry("c", false)], {
      next_ms: INTERVAL - 10_000,
      elapsed_ms: 10_000,
      trip: 1,
    });
    await changed();
    expect(agree()).toBe("on its way");
    await runTo(72_000);
    // Stopped on the map: the same word at the stop and on the bin.
    serve([entry("a", true), entry("b", true), entry("c", false)], {
      next_ms: INTERVAL - 12_000,
      elapsed_ms: 12_000,
      stopped: true,
      trip: 1,
    });
    await changed();
    expect(agree()).toBe("stopped");

    // The trip ends and the timetable restarts for the one left waiting.
    clock = 110_000;
    serve([entry("c", false)], { next_ms: INTERVAL - 50_000 });
    await changed();
    expect(agree()).toBe("3:10");
    await runTo(114_500);
    expect(agree()).toBe("3:06");
    // Its trip sets off on time.
    clock = 300_000;
    serve([entry("c", true)], {
      next_ms: INTERVAL,
      elapsed_ms: 0,
      trip: 2,
    });
    await changed();
    expect(agree()).toBe("on its way");
    await act(async () => root.unmount());
  });

  test("with ?townBusDemo, the bin counts down from the demo's bus too", async () => {
    serve([], { next_ms: 60_000 });
    Object.assign(globalThis, {
      location: window.location,
      history: window.history,
    });
    window.history.replaceState(null, "", "/?townBusDemo");
    resetTownBusDemo();
    const demoRoot = createRoot(host);
    await act(async () => {
      demoRoot.render(createElement(Scene, { town: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(window.location.search).toBe("");
    expect(agree()).toBe("0:06");
    await runTo(clock + 2_200);
    expect(agree()).toBe("0:04");
    await act(async () => demoRoot.unmount());
    // Town closed, the bin is the service's again.
    expect(townBusDemoShown.get()).toBeNull();
  });
}
