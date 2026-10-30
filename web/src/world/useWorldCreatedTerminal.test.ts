import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { installTestClock, type ClockTarget } from "./testing/testClock";
import type { WorldRuntimeConnection, WorldRuntimeState } from "./runtimeStore";

// React captures its environment on import. Keep this DOM and its controlled
// timers separate from other tests, including native sequential Bun runs.
if (process.env.WORLD_CREATED_TERMINAL_TEST !== "1") {
  test("created-terminal hook on the test clock in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_CREATED_TERMINAL_TEST: "1" },
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
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });

  const { createRoot } = await import("react-dom/client");
  const { store, __storeTesting } = await import("../store");
  const { coordinateCreation } = await import("../creationRequests");
  const { worldRuntimeStore } = await import("./runtimeStore");
  const { useWorldCreatedTerminal } = await import("./useWorldCreatedTerminal");
  const { useWorldInspectorIntentLease } = await import(
    "./useWorldInspectorIntentLease"
  );
  const { buildWorldObject } = await import("./worldObject");
  const { CREATED_PANE_ADMISSION_TIMEOUT_MS } = await import(
    "./officeRoomActions"
  );
  const previous = store.get();
  const owner = { connectionId: "alpha", runtimeGeneration: 7 };
  const rootPane = {
    workspace_id: "studio",
    tab_id: "created-tab",
    pane_id: "created-pane",
    terminal_id: "created-terminal",
    focused: false,
    revision: 1,
    agent_status: "idle",
  };
  function connection(available: boolean): WorldRuntimeConnection {
    return {
      connectionId: "alpha",
      label: "Alpha",
      source: "test",
      isDefault: true,
      state: "ready",
      generation: 7,
      snapshotGeneration: 7,
      stale: false,
      actionable: true,
      snapshot: {
        workspaces: [
          {
            workspace_id: "studio",
            number: 1,
            label: "Studio",
            focused: false,
            pane_count: 1,
            tab_count: 1,
            agent_status: "idle",
          },
        ],
        tabs: [
          {
            workspace_id: "studio",
            tab_id: "created-tab",
            number: 1,
            label: "Created",
            focused: false,
            pane_count: 1,
            agent_status: "idle",
          },
        ],
        panes: available ? [rootPane] : [],
        agents: [],
      },
    };
  }
  const clockTarget = {} as ClockTarget;
  let clock: ReturnType<typeof installTestClock>;
  let root: ReturnType<typeof createRoot>;
  let observed: WorldRuntimeState;
  const observers = new Set<() => void>();
  const intent = { current: 0 };
  let active = true;
  let presented = "reviewer";
  let opening: ReturnType<typeof Promise.withResolvers<void>>;
  let opened: Array<{ id: string; signal: AbortSignal }>;
  const mocks: Array<{ mockRestore(): void }> = [];
  const releaseCreations: Array<() => void> = [];
  let intentOpening = true;
  const setIntentOpening = (value: boolean) => {
    intentOpening = value;
  };
  function Harness() {
    useWorldInspectorIntentLease(
      buildWorldObject(observed.connections).leaves[0] ?? null,
      store.get().connections,
      intent,
      setIntentOpening,
    );
    useWorldCreatedTerminal({
      active,
      intentRequestRef: intent,
      openTerminalById: async (id, signal) => {
        intent.current++;
        opened.push({ id, signal: signal! });
        await opening.promise;
        if (!signal!.aborted) presented = id;
      },
    });
    return null;
  }
  const render = () => act(() => root.render(createElement(Harness)));
  const advance = (ms = 16) => act(() => clock.advance(ms));
  function publish(host = connection(true)) {
    observed = {
      ...observed,
      observedAt: observed.observedAt + 1,
      connections: [host],
    };
    for (const listener of observers) listener();
  }
  function create(
    kind: "tab" | "workspace" = "tab",
    gate?: ReturnType<typeof Promise.withResolvers<void>>,
  ) {
    if (gate) releaseCreations.push(gate.resolve);
    return coordinateCreation(owner, kind, "studio", async (dispatching) => {
      dispatching();
      await gate?.promise;
      return { root_pane: rootPane };
    });
  }
  beforeEach(async () => {
    clock = installTestClock(clockTarget, { now: () => 0 });
    mocks.push(
      spyOn(globalThis, "setTimeout").mockImplementation(
        clockTarget.setTimeout,
      ),
    );
    mocks.push(
      spyOn(globalThis, "clearTimeout").mockImplementation(
        clockTarget.clearTimeout,
      ),
    );
    intent.current = 0;
    active = true;
    intentOpening = true;
    presented = "reviewer";
    opening = Promise.withResolvers<void>();
    opened = [];
    observed = {
      status: "ready",
      revision: 1,
      observedAt: 1,
      connections: [connection(true)],
      error: null,
    };
    mocks.push(
      spyOn(worldRuntimeStore, "get").mockImplementation(() => observed),
    );
    mocks.push(
      spyOn(worldRuntimeStore, "refresh").mockResolvedValue(undefined),
    );
    mocks.push(
      spyOn(worldRuntimeStore, "subscribe").mockImplementation((listener) => {
        observers.add(listener);
        return () => observers.delete(listener);
      }),
    );
    __storeTesting.replaceState({
      ...previous,
      status: "connected",
      activeConnectionId: "alpha",
      notice: null,
      connections: [
        {
          id: "alpha",
          label: "Alpha",
          source: "test",
          is_default: true,
          state: "ready",
          generation: 7,
        },
      ],
    });
    root = createRoot(
      dom.document.createElement("div") as unknown as HTMLElement,
    );
    await render();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    for (const release of releaseCreations.splice(0)) release();
    opening.resolve();
    await advance();
    expect(observers.size).toBe(0);
    for (const mock of mocks.splice(0).reverse()) mock.mockRestore();
    __storeTesting.replaceState(previous);
  });

  test("handoff: one in-flight open; transient failure retries only a new observation", async () => {
    await create();
    expect(opened).toHaveLength(1);
    const first = opening;
    publish();
    publish();
    await advance();
    expect(opened).toHaveLength(1);
    expect(presented).toBe("reviewer");
    opening = Promise.withResolvers<void>();
    first.reject(new Error("Synthetic transient focus rejection"));
    await advance();
    // The observation changed while the first attempt was pending: retry it.
    expect(opened).toHaveLength(2);
    await advance();
    expect(opened).toHaveLength(2);
    publish();
    await advance();
    expect(opened).toHaveLength(2);
    opening.resolve();
    await advance();
    expect(presented).toBe(
      JSON.stringify(["alpha", "terminal", "created-terminal"]),
    );
    expect(store.get().notice).toBeNull();
    expect(observers.size).toBe(0);
  });

  test.each(["shared", "browser-local"] as const)(
    "handoff: %s deadline aborts the opener and late completion cannot replace the prior Inspector",
    async (navigationMode) => {
      __storeTesting.replaceState({ ...store.get(), navigationMode });
      await create();
      expect(opened).toHaveLength(1);
      await advance(CREATED_PANE_ADMISSION_TIMEOUT_MS - 16);
      expect(opened[0]!.signal.aborted).toBe(false);
      expect(store.get().notice?.loading).toBe(true);
      await advance(16);
      expect(opened[0]!.signal.aborted).toBe(true);
      expect(store.get().notice?.message).toBe(
        "Tab created, but Inspector focus failed",
      );
      expect(observers.size).toBe(0);
      opening.resolve();
      publish();
      await advance();
      expect(presented).toBe("reviewer");
      expect(opened).toHaveLength(1);
    },
  );

  test.each(["tab", "workspace"] as const)(
    "shared creation: a stale observation is not newer intent for %s",
    async (kind) => {
      const gate = Promise.withResolvers<void>();
      const pending = create(kind, gate);
      const stale = { ...connection(true), stale: true, actionable: false };
      publish(stale);
      // Run the real controller's selection-lease effect while creation is
      // pending, before its result can attempt to open the new Inspector.
      await render();
      expect(intent.current).toBe(0);
      expect(intentOpening).toBe(true);
      gate.resolve();
      await pending;
      expect(opened).toHaveLength(0);
      await advance(160);
      expect(opened).toHaveLength(0);
      expect(store.get().notice?.loading).toBe(true);
      publish();
      expect(opened).toHaveLength(1);
      opening.resolve();
      await advance();
      expect(presented).toBe(opened[0]!.id);
      expect(store.get().notice).toBeNull();
    },
  );

  test("shared creation: explicit newer intent before the result suppresses automatic opening", async () => {
    const gate = Promise.withResolvers<void>();
    const pending = create("tab", gate);
    intent.current++;
    gate.resolve();
    await pending;
    await advance();
    expect(opened).toHaveLength(0);
    expect(store.get().notice?.detail).toContain("superseded");
    expect(observers.size).toBe(0);
  });

  test.each(["disconnected", "replaced", "removed"])(
    "selection lease: a %s owner retires intent while creation is pending",
    async (change) => {
      const gate = Promise.withResolvers<void>();
      const pending = create("tab", gate);
      const connection = store.get().connections[0]!;
      __storeTesting.replaceState({
        ...store.get(),
        connections:
          change === "removed"
            ? []
            : [
                {
                  ...connection,
                  state: change === "disconnected" ? "reconnecting" : "ready",
                  generation: change === "replaced" ? 8 : 7,
                },
              ],
      });
      await render();
      expect(intent.current).toBe(1);
      expect(intentOpening).toBe(false);
      gate.resolve();
      await pending;
      await advance();
      expect(opened).toHaveLength(0);
      expect(observers.size).toBe(0);
    },
  );
}
