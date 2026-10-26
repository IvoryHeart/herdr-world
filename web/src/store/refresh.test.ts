import { expect, spyOn, test } from "bun:test";
import { bridge, type ConnectionClient } from "../api";
import {
  emptyBrowserNavigation,
  selectBrowserTarget,
} from "../browserNavigation";
import { __storeTesting, emptyServerSessionState, set, store } from "../store";
import type { Pane, PaneLayout, Tab, Workspace } from "../types";

async function withStaleLayout(
  run: (fixture: {
    calls: string[];
    pending: Map<number, () => void>;
    turn(): Promise<void>;
    retry(): Promise<void>;
    recover(): void;
    publications(): number;
  }) => Promise<void>,
) {
  const previous = store.get();
  const originalConnection = bridge.connection;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  let timerId = -1;
  let correct = false;
  const calls: string[] = [];
  const workspace: Workspace = {
    workspace_id: "shared",
    number: 1,
    label: "Synthetic workspace",
    focused: true,
    pane_count: 2,
    tab_count: 2,
    agent_status: "idle",
  };
  const tabs: Tab[] = ["first", "second"].map((id, index) => ({
    tab_id: id,
    workspace_id: "shared",
    number: index + 1,
    label: id,
    focused: index === 0,
    pane_count: 1,
    agent_status: "idle",
  }));
  const panes: Pane[] = tabs.map((tab) => ({
    pane_id: tab.tab_id,
    terminal_id: tab.tab_id,
    workspace_id: "shared",
    tab_id: tab.tab_id,
    focused: tab.focused,
    agent_status: "idle",
    revision: 1,
  }));
  const layout = (id: string): PaneLayout => ({
    workspace_id: "shared",
    tab_id: id,
    zoomed: false,
    area: { x: 0, y: 0, width: 80, height: 24 },
    focused_pane_id: id,
    panes: [
      {
        pane_id: id,
        focused: true,
        rect: { x: 0, y: 0, width: 80, height: 24 },
      },
    ],
    splits: [],
  });
  const session = {
    ...emptyServerSessionState(7),
    navigationMode: "browser-local" as const,
    workspaces: [workspace],
    tabs,
    panes,
    selectedPaneId: "second",
    browserNavigation: selectBrowserTarget(
      emptyBrowserNavigation(),
      "shared",
      "second",
      "second",
    ),
  };
  __storeTesting.replaceState({
    ...previous,
    ...session,
    status: "connected",
    catalogueReady: true,
    connectionPaused: false,
    activeConnectionId: "alpha",
    connectionGeneration: 7,
    connections: ["alpha", "beta"].map((id) => ({
      id,
      label: `Synthetic ${id}`,
      source: "test",
      is_default: id === "alpha",
      state: "ready",
      generation: 7,
    })),
    sessionsByConnectionId: { alpha: session, beta: session },
  });
  bridge.connection = ((
    connectionId: string = "alpha",
    generation: number = 7,
  ) =>
    ({
      connectionId,
      generation,
      serverRuntimeGeneration: generation,
      isCurrent: () =>
        store
          .get()
          .connections.some(
            (owner) =>
              owner.id === connectionId &&
              owner.generation === generation &&
              owner.state === "ready",
          ),
      acceptsServerGeneration: (value) => value === generation,
      call: async (method) => {
        if (method === "workspace.list")
          return { workspaces: [workspace], navigation_mode: "browser-local" };
        if (method === "tab.list") return { tabs };
        if (method === "pane.list") return { panes };
        if (method === "pane.layout") {
          calls.push(connectionId);
          // Bound the broken implementation too: a third eager retry fails
          // instead of starving the test runner in an endless microtask loop.
          if (!correct && calls.length > 2)
            throw new Error("eager stale-layout retry");
          return { layout: layout(correct ? "second" : "first") };
        }
        return {};
      },
    }) satisfies ConnectionClient) as typeof bridge.connection;
  const timers = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== 80) return realSetTimeout(callback, delay, ...args);
    const id = timerId--;
    pending.set(id, () => {
      if (typeof callback === "function") callback(...args);
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
    if (!pending.delete(Number(id))) realClearTimeout(id as unknown as number);
  });
  const time = spyOn(performance, "now").mockReturnValue(100);
  const turn = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));
  let publications = 0;
  const unsubscribe = store.subscribe(() => publications++);
  try {
    await run({
      calls,
      pending,
      turn,
      recover: () => {
        correct = true;
      },
      publications: () => publications,
      retry: async () => {
        expect(pending.size).toBe(1);
        const [id, callback] = pending.entries().next().value!;
        pending.delete(id);
        callback();
        await turn();
      },
    });
  } finally {
    unsubscribe();
    __storeTesting.replaceState(previous);
    bridge.connection = originalConnection;
    timers.mockRestore();
    clear.mockRestore();
    time.mockRestore();
  }
}

test.each(["scheduled", "explicit"])(
  "repeated stale layouts yield and recover through %s refreshes",
  async (refresh) => {
    await withStaleLayout(
      async ({ calls, pending, publications, retry, turn, recover }) => {
        await store.refresh();
        await turn();
        expect(calls).toEqual(["alpha"]);
        expect(publications()).toBe(1);
        expect(store.get().layout).toBeNull();
        expect(store.get().selectedPaneId).toBe("second");
        if (refresh === "scheduled") await retry();
        else {
          await store.refresh();
          await turn();
        }
        expect(calls).toEqual(["alpha", "alpha"]);
        expect(publications()).toBe(2);
        expect(store.get().layout).toBeNull();
        expect(pending.size).toBe(1);
        recover();
        await retry();
        expect(calls).toEqual(["alpha", "alpha", "alpha"]);
        expect(store.get().layout?.tab_id).toBe("second");
        expect(store.get().selectedPaneId).toBe("second");
        expect(pending.size).toBe(0);
      },
    );
  },
);

test.each(["focus switch", "runtime retirement"])(
  "a deferred stale-layout retry respects %s",
  async (transition) => {
    await withStaleLayout(async ({ calls, pending, retry, turn, recover }) => {
      await store.refresh();
      await turn();
      expect(calls).toEqual(["alpha"]);
      if (transition === "focus switch") {
        const active = spyOn(bridge, "setActiveConnection").mockReturnValue(8);
        try {
          expect(store.selectConnection("beta")).toBe(true);
        } finally {
          active.mockRestore();
        }
      } else {
        set({
          connections: store
            .get()
            .connections.map((owner) =>
              owner.id === "alpha" ? { ...owner, generation: 8 } : owner,
            ),
        });
      }
      const activeLayout = store.get().layout;
      recover();
      await retry();
      if (transition === "focus switch") {
        expect(calls).toEqual(["alpha", "alpha"]);
        expect(store.get().activeConnectionId).toBe("beta");
        expect(store.get().layout).toBe(activeLayout);
        expect(store.getConnection("alpha").layout?.tab_id).toBe("second");
      } else {
        expect(calls).toEqual(["alpha"]);
        expect(store.get().layout).toBeNull();
      }
      expect(pending.size).toBe(0);
    });
  },
);
