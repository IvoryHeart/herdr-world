import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { installTestClock } from "./testing/testClock";

// React and the focused store capture browser globals. Isolate them from
// native sequential tests, as in the other headless World hook consumers.
if (process.env.WORLD_HOSTS_FILTER_TEST !== "1") {
  test("host filter catalogue policy on test time in an isolated DOM", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, WORLD_HOSTS_FILTER_TEST: "1" },
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
  const { useHostsFilter } = await import("./hostsFilter");
  const { worldLocalStorage } = await import("../browserStorage");
  const { store, __storeTesting, useStoreSelector } = await import("../store");
  const { bridge } = await import("../api");
  const previous = store.get();
  const previousCall = bridge.call;
  const connections = ["alpha", "beta", "offline"].map((id) => ({
    id,
    label: `Synthetic ${id}`,
    source: "test",
    is_default: id === "alpha",
    state: id === "offline" ? ("disconnected" as const) : ("ready" as const),
    generation: 7,
  }));
  let root: ReturnType<typeof createRoot>;
  let filter: ReturnType<typeof useHostsFilter>;
  function Harness() {
    // Same production selectors and hook inputs as WorldFoundationApp.
    const catalogue = useStoreSelector((state) => state.connections);
    const ready = useStoreSelector((state) => state.catalogueReady);
    filter = useHostsFilter(
      catalogue.map(({ id }) => id),
      ready,
    );
    return null;
  }
  async function mount(saved: string, ready = false) {
    worldLocalStorage.setItem("worldHostsFilter.v1", saved);
    __storeTesting.replaceState({
      ...previous,
      status: "connected",
      connections: ready ? connections : [],
      catalogueReady: ready,
      activeConnectionId: "alpha",
      defaultConnectionId: "alpha",
    });
    await act(() => root.render(createElement(Harness)));
  }
  const saved = () => worldLocalStorage.getItem("worldHostsFilter.v1");
  beforeEach(() => {
    dom.document.body.innerHTML = "<div id='root'></div>";
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    bridge.call = previousCall;
    __storeTesting.replaceState(previous);
    worldLocalStorage.clear();
  });

  test.each([false, true])(
    "delayed catalogue preserves saved beta; empty=%s",
    async (empty) => {
      await mount('["beta"]');
      const reply = Promise.withResolvers<unknown>();
      const entered = Promise.withResolvers<void>();
      bridge.call = ((method: string) => {
        expect(method).toBe("connections.list");
        entered.resolve();
        return reply.promise;
      }) as typeof bridge.call;
      const refreshing = store.refreshConnections();
      await entered.promise;
      await act(() => clock.advance(150));
      expect(store.get().catalogueReady).toBe(false);
      expect(filter.ids).toEqual(["beta"]);
      expect(saved()).toBe('["beta"]');
      expect(filter.explanation).toBe("");
      await act(async () => {
        reply.resolve({ connections: empty ? [] : connections });
        expect(await refreshing).toBe(true);
      });
      expect(store.get().catalogueReady).toBe(true);
      expect(filter.ids).toEqual(empty ? null : ["beta"]);
      expect(saved()).toBe(empty ? "null" : '["beta"]');
      expect(filter.explanation).toBe(
        empty
          ? "Some selected host profiles were removed. Showing All hosts."
          : "",
      );
      expect(store.get().activeConnectionId).toBe("alpha");
    },
  );

  test("removed profiles prune only after admission, then persist across remount", async () => {
    await mount('["beta","removed"]');
    bridge.call = (async () => ({ connections })) as typeof bridge.call;
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    expect(filter.ids).toEqual(["beta"]);
    expect(saved()).toBe('["beta"]');
    expect(filter.explanation).toBe(
      "Some selected host profiles were removed. Showing the remaining selected hosts.",
    );
    await act(() => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await act(() => root.render(createElement(Harness)));
    expect(filter.ids).toEqual(["beta"]);
    expect(filter.explanation).toBe("");
  });

  test("empty explicit selection means All hosts without changing operational ownership", async () => {
    await mount('["beta"]', true);
    await act(() => filter.setIds([]));
    expect(filter.ids).toBeNull();
    expect(saved()).toBe("null");
    expect(store.get().activeConnectionId).toBe("alpha");
    expect(store.get().connections).toEqual(connections);
  });

  test.each(["[]", "null", '{"id":"beta"}', '[""]', "[7]", "invalid"])(
    "invalid saved scope falls back to All hosts: %s",
    async (value) => {
      await mount(value, true);
      expect(filter.ids).toBeNull();
    },
  );
  test("duplicate saved IDs normalize without dropping a valid host", async () => {
    await mount('["beta","beta"]', true);
    expect(filter.ids).toEqual(["beta"]);
  });
}
