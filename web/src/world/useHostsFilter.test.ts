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
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    Element: dom.Element,
    HTMLInputElement: dom.HTMLInputElement,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
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
  const { HostsControl } = await import("./HostsControl");
  const { worldLocalStorage } = await import("../browserStorage");
  const { store, __storeTesting, useStoreSelector } = await import("../store");
  const { bridge } = await import("../api");
  const { worldHosts } = await import("../worldHosts");
  const { publishHostGroupingOf } = await import(
    "./testing/publishedHostGrouping"
  );
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
    const catalogue = useStoreSelector(worldHosts);
    const ready = useStoreSelector((state) => state.catalogueReady);
    filter = useHostsFilter(catalogue, ready);
    return createElement(HostsControl, {
      connections: catalogue,
      ids: filter.ids,
      explanation: filter.explanation,
      onChange: filter.setIds,
    });
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
  // World publishes the grouping of the store's catalogue.
  let unpublish = () => {};
  beforeEach(() => {
    unpublish = publishHostGroupingOf(() => store.get());
    dom.document.body.innerHTML = "<div id='root'></div>";
    root = createRoot(document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    unpublish();
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
      expect(document.querySelector('[role="status"]')?.textContent ?? "").toBe(
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

  test("a herdr-core host is listed, kept and selectable like a Herdr host", async () => {
    await mount('["core-synthetic"]');
    const core = {
      id: "core-synthetic",
      label: "Synthetic core",
      type: "local",
      runtime: "herdr-core",
      state: "ready",
      generation: 3,
      core_session: "",
      core_state_dir: "",
      observation: null,
    };
    bridge.call = (async () => ({
      connections,
      core_connections: [core],
    })) as typeof bridge.call;
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    // The saved core selection survives admission instead of being pruned.
    expect(filter.ids).toEqual(["core-synthetic"]);
    expect(saved()).toBe('["core-synthetic"]');
    expect(filter.explanation).toBe("");
    // Operational (TUI) connections stay Herdr's alone.
    expect(store.get().connections).toEqual(connections);
    await act(async () =>
      (
        document.querySelector('button[aria-label="Hosts"]') as HTMLElement
      ).click(),
    );
    const row = document.querySelector<HTMLInputElement>(
      'input[aria-label="Synthetic core"]',
    );
    expect(row?.checked).toBe(true);
    expect(row?.parentElement?.textContent).toBe("Synthetic core · ready");
    // Ticking a Herdr host keeps the core host selected beside it.
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[aria-label="Synthetic alpha"]')!
        .click(),
    );
    expect(saved()).toBe('["core-synthetic","alpha"]');
    // A refresh with the same catalogue keeps the host list's identity.
    const before = worldHosts(store.get());
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    expect(worldHosts(store.get())).toBe(before);
    // The page's bridge.status poll from a service that sends no core field says
    // nothing about core hosts: the host stays listed and selected.
    bridge.call = (async () => ({ connections })) as typeof bridge.call;
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    expect(filter.ids).toEqual(["core-synthetic", "alpha"]);
    expect(worldHosts(store.get())).toBe(before);
    // A removed core profile prunes like a removed Herdr profile.
    bridge.call = (async () => ({
      connections,
      core_connections: [],
    })) as typeof bridge.call;
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    expect(filter.ids).toEqual(["alpha"]);
  });

  test("one row per machine: a saved runtime shows, and unchecks, its whole machine", async () => {
    // Saved before #1227: only the machine's Herdr TUI connection.
    await mount('["alpha"]');
    const local = (id: string) => ({
      id,
      label: `Synthetic ${id}`,
      source: "test",
      is_default: id === "alpha",
      state: "ready" as const,
      generation: 7,
      type: "local" as const,
      read_only: false,
      auto_connect: true,
      control_socket_path: "/tmp/example-control.sock",
      client_socket_path: "/tmp/example-client.sock",
    });
    const core = {
      id: "core-local",
      label: "Synthetic core",
      type: "local",
      runtime: "herdr-core",
      state: "reconnecting",
      generation: 3,
      core_session: "",
      core_state_dir: "",
      observation: null,
    };
    bridge.call = (async () => ({
      connections: [local("alpha"), connections[1]],
      core_connections: [core],
    })) as typeof bridge.call;
    await act(async () => {
      expect(await store.refreshConnections()).toBe(true);
    });
    // The saved runtime maps to its machine; storage is left as it was.
    expect(filter.ids).toEqual(["alpha", "core-local"]);
    expect(saved()).toBe('["alpha"]');
    await act(async () =>
      (
        document.querySelector('button[aria-label="Hosts"]') as HTMLElement
      ).click(),
    );
    const rows = [
      ...document.querySelectorAll<HTMLInputElement>(
        '.world-hosts-menu input[type="checkbox"]',
      ),
    ];
    expect(rows.map((row) => row.parentElement?.textContent)).toEqual([
      "Synthetic alpha · 1 of 2 reconnecting",
      "Synthetic beta · ready",
    ]);
    expect(rows.map((row) => row.checked)).toEqual([true, false]);
    expect(
      document.querySelector(".connection-switcher-label")?.textContent,
    ).toBe("1 hosts");
    // Unchecking the last selected machine hides both of its runtimes and
    // stays an explicit empty selection, not All hosts.
    await act(async () => rows[0]!.click());
    expect(saved()).toBe("[]");
    expect(filter.ids).toEqual([]);
    expect(rows.map((row) => row.checked)).toEqual([false, false]);
    expect(
      document.querySelector(".connection-switcher-label")?.textContent,
    ).toBe("No hosts");
    await act(async () => filter.setIds(["beta"]));
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[aria-label="Synthetic alpha"]')!
        .click(),
    );
    expect(saved()).toBe('["beta","alpha","core-local"]');
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[aria-label="Synthetic alpha"]')!
        .click(),
    );
    expect(saved()).toBe('["beta"]');
    expect(filter.ids).toEqual(["beta"]);
  });

  test("empty explicit selection shows no hosts without changing operational ownership", async () => {
    await mount('["beta"]', true);
    await act(() => filter.setIds([]));
    expect(filter.ids).toEqual([]);
    expect(saved()).toBe("[]");
    expect(store.get().activeConnectionId).toBe("alpha");
    expect(store.get().connections).toEqual(connections);
    // It survives a reload, and All hosts clears it.
    await act(() => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await act(() => root.render(createElement(Harness)));
    expect(filter.ids).toEqual([]);
    expect(filter.explanation).toBe("");
    await act(() => filter.setIds(null));
    expect(saved()).toBe("null");
  });

  test.each(["null", '{"id":"beta"}', '[""]', "[7]", "invalid"])(
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
