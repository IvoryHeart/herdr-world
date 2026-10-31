import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { WorldRuntimeConnection, WorldRuntimeState } from "./runtimeStore";
import { installTestClock } from "./testing/testClock";

if (process.env.WORLD_OBSERVATION_POLICY_TEST !== "1") {
  test("watch coverage policy in the production observation hook on test time", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_OBSERVATION_POLICY_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code) throw new Error(`${out}\n${err}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  const dom = new Window({ url: "https://world.example.test" });
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    CustomEvent: dom.CustomEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const clock = installTestClock(dom as unknown as Window & typeof globalThis, {
    now: () => 0,
  });
  for (const key of [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const)
    Object.defineProperty(globalThis, key, {
      value: dom[key].bind(dom),
      configurable: true,
    });
  const { createRoot } = await import("react-dom/client");
  const { useWorldObservation } = await import("./useWorldObservation");
  const { worldRuntimeStore } = await import("./runtimeStore");
  const { writeHostsFilter } = await import("./hostsFilter");
  const { worldLocalStorage } = await import("../browserStorage");
  const { store, __storeTesting } = await import("../store");
  const { bridge } = await import("../api");
  const previous = store.get();
  const previousCall = bridge.call;
  let root: ReturnType<typeof createRoot>;
  let observed: WorldRuntimeState;
  let observation: ReturnType<typeof useWorldObservation>;
  let runtimeGet: ReturnType<typeof spyOn>;
  let reply: ReturnType<typeof Promise.withResolvers<unknown>> | null;
  const calls: string[] = [];
  const presented = () => {};
  const admission = (revision = 2) => ({
    revision,
    registered: 1,
    admitted: 1,
    missing: 0,
    unresolved: 0,
    matched: 1,
    admissionFailed: 0,
  });
  function connection(id: string): WorldRuntimeConnection {
    return {
      connectionId: id,
      label: `Synthetic ${id}`,
      source: "test",
      isDefault: id === "alpha",
      state: id === "offline" ? "disconnected" : "ready",
      generation: 7,
      snapshotGeneration: id === "offline" ? null : 7,
      stale: false,
      actionable: id !== "offline",
      snapshot:
        id === "offline"
          ? null
          : {
              workspaces: [],
              tabs: [],
              panes: [],
              agents: [],
              watchAdmission: admission(),
            },
    };
  }
  function Harness() {
    observation = useWorldObservation({ onPresentedWorldChange: presented });
    return null;
  }
  const render = () => act(() => root.render(createElement(Harness)));
  const currentStatus =
    "2 pinned in filter · 2 admitted · 0 missing · 0 unresolved · 0 not admitted · 1 host unavailable";
  beforeEach(async () => {
    calls.length = 0;
    reply = null;
    worldLocalStorage.clear();
    observed = {
      status: "ready",
      revision: 1,
      observedAt: 0,
      error: null,
      connections: ["alpha", "beta", "offline"].map(connection),
    };
    runtimeGet = spyOn(worldRuntimeStore, "get").mockImplementation(
      () => observed,
    );
    __storeTesting.replaceState({
      ...previous,
      status: "connected",
      catalogueReady: true,
      activeConnectionId: "alpha",
      defaultConnectionId: "alpha",
      connections: observed.connections.map((c) => ({
        id: c.connectionId,
        label: c.label,
        source: c.source,
        is_default: c.isDefault,
        generation: c.generation,
        state: c.state,
      })),
    });
    bridge.call = (async (method: string) => {
      calls.push(method);
      if (method === "world.board.get") return {};
      if (method !== "world.watchlist.list")
        throw new Error(`Unexpected ${method}`);
      if (reply) return reply.promise;
      return { revision: 2, records: [] };
    }) as typeof bridge.call;
    dom.document.body.innerHTML = "<div id='root'></div>";
    root = createRoot(document.getElementById("root")!);
    await render();
    await act(() => observation.watchlistStore.refresh());
  });
  afterEach(async () => {
    reply?.resolve({ revision: 2, records: [] });
    await act(() => root.unmount());
    runtimeGet.mockRestore();
    bridge.call = previousCall;
    __storeTesting.replaceState(previous);
    worldLocalStorage.clear();
  });

  test("unavailable peer does not mask healthy counts; older revision stays pending until current", async () => {
    expect(observation.watchStatus).toBe(currentStatus);
    observed = {
      ...observed,
      revision: 2,
      connections: observed.connections.map((c) =>
        c.snapshot
          ? { ...c, snapshot: { ...c.snapshot, watchAdmission: admission(1) } }
          : c,
      ),
    };
    await render();
    expect(observation.watchStatus).toBe(
      "Watch availability pending for filtered hosts",
    );
    await act(() => clock.advance(150));
    expect(observation.watchStatus).toBe(
      "Watch availability pending for filtered hosts",
    );
    observed = {
      ...observed,
      revision: 3,
      connections: observed.connections.map((c) =>
        c.snapshot
          ? { ...c, snapshot: { ...c.snapshot, watchAdmission: admission() } }
          : c,
      ),
    };
    await render();
    expect(observation.watchStatus).toBe(currentStatus);
  });

  test("unavailable-only scope is empty coverage rather than pending or another host's counts", async () => {
    observed = {
      ...observed,
      connections: observed.connections.map((c) =>
        c.snapshot
          ? { ...c, snapshot: { ...c.snapshot, watchAdmission: admission(1) } }
          : c,
      ),
    };
    await render();
    expect(observation.watchStatus).toBe(
      "Watch availability pending for filtered hosts",
    );
    const before = calls.length;
    await act(() => writeHostsFilter(["offline"]));
    expect(observation.world.hosts.map((host) => host.connectionId)).toEqual([
      "offline",
    ]);
    expect(observation.watchStatus).toBe(
      "0 pinned in filter · 0 admitted · 0 missing · 0 unresolved · 0 not admitted · 1 host unavailable",
    );
    expect(store.get().activeConnectionId).toBe("alpha");
    expect(calls.slice(before)).toEqual([]);
  });

  test("missing admission is pending, and a hidden stale peer cannot mask current selected-host counts", async () => {
    observed = {
      ...observed,
      connections: observed.connections.map((c) =>
        c.connectionId === "beta"
          ? { ...c, snapshot: { ...c.snapshot!, watchAdmission: undefined } }
          : c,
      ),
    };
    await render();
    expect(observation.watchStatus).toBe(
      "Watch availability pending for filtered hosts",
    );
    await act(() => writeHostsFilter(["alpha"]));
    expect(observation.watchStatus).toBe(
      "1 pinned in filter · 1 admitted · 0 missing · 0 unresolved · 0 not admitted",
    );
  });

  test("watchlist refresh completion publishes pending and current states without sleeps", async () => {
    reply = Promise.withResolvers<unknown>();
    let refresh: Promise<void>;
    await act(() => {
      refresh = observation.watchlistStore.refresh();
    });
    expect(calls[calls.length - 1]).toBe("world.watchlist.list");
    expect(observation.watchStatus).toBe(currentStatus);
    await act(async () => {
      reply!.resolve({ revision: 3, records: [] });
      await refresh;
    });
    expect(observation.watchStatus).toBe(
      "Watch availability pending for filtered hosts",
    );
  });
}
