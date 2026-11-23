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
  /** The routes Town measured and sent World (world.bin.route). */
  const reported: { id: string; route_m: number; stop: string }[] = [];
  /** When `served` was read; a later reply is the same state, read now. */
  let servedAt = 0;
  bridge.call = (async (method: string, params?: { routes?: never[] }) => {
    if (method === "world.bin.route") reported.push(...(params?.routes ?? []));
    else if (method !== "world.bin.list")
      throw new Error(`unexpected ${method}`);
    const since = clock - servedAt;
    const { bus } = served;
    return {
      ...served,
      bus: {
        ...bus,
        next_ms: bus.next_ms === null ? null : Math.max(0, bus.next_ms - since),
        elapsed_ms:
          bus.elapsed_ms === null || bus.stopped
            ? bus.elapsed_ms
            : bus.elapsed_ms + since,
      },
    };
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
    route_m: null,
    stop: null,
  });
  const TRIP = 45_000;
  let revision = 0;
  const serve = (entries: BinEntry[], bus: Partial<BinState["bus"]>) => {
    revision += 1;
    servedAt = clock;
    served = {
      epoch: "run",
      revision,
      entries,
      closing: [],
      outcomes: [],
      bus: {
        speed_kmh: 36,
        route_m: 0,
        trip_ms: 0,
        elapsed_ms: null,
        stopped: false,
        trip: null,
        next_ms: null,
        next_route_m: 0,
        next_trip_ms: 0,
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
    const countdown = chip.replace(/^bus (back in )?/, "");
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
    const sign = () => host.querySelector<HTMLElement>(".town-bus-sign");
    // One rider waits for a bus that sets off in a minute and is back at
    // Apartments 45 s after that.
    const waitA = { next_ms: 60_000, next_route_m: 300, next_trip_ms: TRIP };
    serve([entry("a", false)], waitA);
    await act(async () => {
      root.render(createElement(Scene, { town: false }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(shown().chip).toBe("bus back in 1:45");
    // Town opens a little later: its stops tick with the bin, not out of
    // step with it.
    await act(async () => advanceTo(600));
    await act(async () => {
      root.render(createElement(Scene, { town: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(agree()).toBe("1:45");
    // Town measured the rider's stop on its roads and told World.
    expect(reported).toEqual([
      { id: "bin-a", route_m: expect.any(Number), stop: expect.any(String) },
    ]);
    expect(reported[0]!.route_m).toBeGreaterThan(0);
    // Parked, the bus shows its speed and the route it is to drive.
    expect(sign()?.hidden).toBe(false);
    expect(sign()?.textContent).toBe("36 km/h · 300 m route");
    await runTo(3_600);
    expect(agree()).toBe("1:42");

    // A late rider joins at another stop, farther out: the next trip is
    // longer, and both stops and the bin still agree.
    clock = 3_700;
    serve([entry("a", false), entry("b", false)], {
      ...waitA,
      next_ms: 60_000 - 3_700,
      next_route_m: 400,
      next_trip_ms: TRIP + 10_000,
    });
    await changed();
    expect(shown().stops).toHaveLength(2);
    expect(reported.map((route) => route.id)).toEqual(["bin-a", "bin-b"]);
    expect(reported[1]!.stop).not.toBe(reported[0]!.stop);
    expect(agree()).toBe("1:52");
    await runTo(9_100);
    expect(agree()).toBe("1:46");

    // The trip sets off: its riders' countdown is the trip's end.
    clock = 60_000;
    const out = { route_m: 400, trip_ms: TRIP + 10_000, trip: 1 };
    serve([entry("a", true), entry("b", true)], { ...out, elapsed_ms: 0 });
    await changed();
    expect(agree()).toBe("0:55");
    expect(sign()?.textContent).toMatch(/^36 km\/h · \d+ m left$/);
    // One joins while it is out: it waits for the next, which leaves once
    // this one is back; the clocks show the bus out's riders.
    clock = 70_000;
    serve([entry("a", true), entry("b", true), entry("c", false)], {
      ...out,
      elapsed_ms: 10_000,
      next_ms: 45_000,
      next_route_m: 300,
      next_trip_ms: TRIP,
    });
    await changed();
    expect(agree()).toBe("0:45");
    await runTo(72_000);
    expect(agree()).toBe("0:43");
    // Stopped on the map: the same word at the stop and on the bin.
    serve([entry("a", true), entry("b", true), entry("c", false)], {
      ...out,
      elapsed_ms: 12_000,
      stopped: true,
    });
    await changed();
    expect(agree()).toBe("stopped");

    // The trip ends; the one left waiting is due a minute after joining.
    clock = 125_000;
    serve([entry("c", false)], {
      next_ms: 5_000,
      next_route_m: 300,
      next_trip_ms: TRIP,
    });
    await changed();
    expect(agree()).toBe("0:50");
    await runTo(129_500);
    expect(agree()).toBe("0:46");
    // Its trip sets off on time.
    clock = 130_000;
    serve([entry("c", true)], {
      route_m: 300,
      trip_ms: TRIP,
      elapsed_ms: 0,
      trip: 2,
    });
    await changed();
    expect(agree()).toBe("0:45");
    await act(async () => root.unmount());
  });

  test("with ?townBusDemo, the bin counts down from the demo's bus too", async () => {
    serve([], {});
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
    // The demo's bus sets off in 6 s and is back 45 s later.
    expect(agree()).toBe("0:51");
    await runTo(clock + 2_200);
    expect(agree()).toBe("0:49");
    await act(async () => demoRoot.unmount());
    // Town closed, the bin is the service's again.
    expect(townBusDemoShown.get()).toBeNull();
  });
}
