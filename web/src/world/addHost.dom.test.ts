import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useSyncExternalStore } from "react";
import {
  addedConnection,
  hostArrivals,
  hostsFilterWith,
  onAddHostRequest,
  requestAddHost,
} from "./addHost";
import type { HostsFilter } from "./hostsFilter";

if (process.env.ADD_HOST_DOM_TEST !== "1") {
  test("the added connection is the newest one the flow did not start with", () => {
    const before = new Set(["local", "build"]);
    // Cancelled, or only edited or tested: nothing was added.
    expect(addedConnection(before, [{ id: "local" }, { id: "build" }])).toBe(
      null,
    );
    // Removed one: still nothing added.
    expect(addedConnection(before, [{ id: "local" }])).toBe(null);
    expect(
      addedConnection(before, [
        { id: "local" },
        { id: "first" },
        { id: "build" },
        { id: "second" },
      ]),
    ).toBe("second");
  });

  test("the Hosts filter takes the new host in; All hosts stays All hosts", () => {
    expect(hostsFilterWith(null, "new")).toBe(null);
    const ids: HostsFilter = ["local"];
    expect(hostsFilterWith(ids, "new")).toEqual(["local", "new"]);
    const shown: HostsFilter = ["local", "new"];
    expect(hostsFilterWith(shown, "new")).toBe(shown);
  });

  test("an arrival lasts until a view settles it; an older settle keeps a newer one", () => {
    hostArrivals.arrive("first");
    const first = hostArrivals.get()!;
    hostArrivals.arrive("second");
    const second = hostArrivals.get()!;
    expect(second.connectionId).toBe("second");
    expect(second.seq).toBeGreaterThan(first.seq);
    hostArrivals.settle(first.seq);
    expect(hostArrivals.get()).toBe(second);
    hostArrivals.settle(second.seq);
    expect(hostArrivals.get()).toBe(null);
  });

  test("Add building and Add host reach the flow's one opener", () => {
    const had = "window" in globalThis;
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = new EventTarget();
    try {
      let opened = 0;
      const stop = onAddHostRequest(() => (opened += 1));
      requestAddHost();
      stop();
      requestAddHost();
      expect(opened).toBe(1);
    } finally {
      if (had) (globalThis as { window?: unknown }).window = previous;
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  test("Manage connections opens from Add building, and only an added host arrives", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, ADD_HOST_DOM_TEST: "1" },
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
  test("the dialog host opens Manage connections and records what it adds", async () => {
    const browser = new Window({ url: "https://world.example.test" });
    for (const [key, value] of Object.entries({
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      HTMLElement: browser.HTMLElement,
      Element: browser.Element,
      Node: browser.Node,
      Event: browser.Event,
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });

    // The store's connections: Herdr profiles and herdr-core alike.
    type Sources = {
      connections: { id: string; label: string; state: string }[];
      coreConnections: { id: string; label: string; state: string }[];
    };
    let state: Sources = {
      connections: [{ id: "local", label: "Local", state: "connected" }],
      coreConnections: [],
    };
    const listeners = new Set<() => void>();
    const setState = (next: Sources) => {
      state = next;
      listeners.forEach((listener) => listener());
    };
    mock.module("../store", () => ({
      store: { get: () => state },
      useStoreSelector: <T>(select: (snapshot: Sources) => T) =>
        useSyncExternalStore(
          (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          () => select(state),
        ),
    }));
    let closeDialog: () => void = () => {};
    mock.module("../components/ConnectionSwitcher", () => ({
      ConnectionManagerDialog: ({ onClose }: { onClose(): void }) => {
        closeDialog = onClose;
        return createElement("div", {
          role: "dialog",
          "aria-label": "Manage connections",
        });
      },
    }));
    const { createRoot } = await import("react-dom/client");
    const { AddHostDialogHost } = await import("./AddHostDialogHost");
    const { hostArrivals, requestAddHost } = await import("./addHost");

    let filter: HostsFilter = ["local"];
    const filterWrites: HostsFilter[] = [];
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const render = () =>
      root.render(
        createElement(AddHostDialogHost, {
          hostsFilter: {
            ids: filter,
            setIds: (ids: HostsFilter) => {
              filter = ids;
              filterWrites.push(ids);
            },
          },
        }),
      );
    await act(async () => render());
    const dialog = () =>
      document.body.querySelector(
        '[role="dialog"][aria-label="Manage connections"]',
      );
    expect(dialog()).toBe(null);

    // Cancel: the flow opens on its first step and closes; nothing changes.
    await act(async () => requestAddHost());
    expect(dialog()).not.toBe(null);
    await act(async () => closeDialog());
    expect(dialog()).toBe(null);
    expect(hostArrivals.get()).toBe(null);
    expect(filterWrites).toEqual([]);

    // A connection that appears while the flow is closed is not its arrival.
    await act(async () =>
      setState({
        ...state,
        connections: [
          ...state.connections,
          { id: "elsewhere", label: "Elsewhere", state: "connected" },
        ],
      }),
    );
    expect(hostArrivals.get()).toBe(null);

    // Add: a herdr-core connection added while open becomes the arrival, and
    // the Hosts filter takes it in so the views can show it.
    await act(async () => requestAddHost());
    await act(async () =>
      setState({
        ...state,
        coreConnections: [
          { id: "core-new", label: "New core", state: "connecting" },
        ],
      }),
    );
    expect(hostArrivals.get()?.connectionId).toBe("core-new");
    expect(filterWrites).toEqual([["local", "core-new"]]);
    await act(async () => render());
    // Seen once: later store changes do not make it arrive again.
    const seq = hostArrivals.get()!.seq;
    await act(async () =>
      setState({
        ...state,
        coreConnections: [
          { id: "core-new", label: "New core", state: "connected" },
        ],
      }),
    );
    expect(hostArrivals.get()?.seq).toBe(seq);
    await act(async () => closeDialog());
    expect(dialog()).toBe(null);
    expect(hostArrivals.get()?.connectionId).toBe("core-new");
    await act(async () => root.unmount());
  });
}
