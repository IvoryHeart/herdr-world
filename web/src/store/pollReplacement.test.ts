/**
 * T2: parity for replacing the 5 s focused poll (openspec/changes/
 * shared-acquisition). The real Bridge and focused store run against a
 * simulated World service with two ready hosts: "alpha" is active and "beta"
 * is loaded as an Inspector's host. Timers fire only when a test runs them.
 *
 * `test.failing` marks behaviour the contract requires and today's code lacks;
 * the implementation flips each one. The other cases guard behaviour that must
 * not change when the timer goes.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { sortAgentPanes } from "../agentOrder";
import { bridge } from "../api";
import { set, store } from "../store";
import type { Pane, PaneLayout } from "../types";
import {
  ManualClock,
  microtasks,
  OBSERVATION_METHODS,
  SimulatedDocument,
  type SimulatedHost,
  SimulatedWorld,
} from "./testing/simulatedWorld";

const PERIOD_MS = 5_000;

function gitStatus(branch: string, dirty = false) {
  return {
    branch,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: dirty ? 1 : 0,
    untracked: 0,
    conflicted: 0,
    dirty,
  };
}

function layoutFor(
  host: string,
  tabId: string,
  panes: Pane[],
  width: number,
): PaneLayout {
  return {
    workspace_id: `w-${host}`,
    tab_id: tabId,
    zoomed: false,
    area: { x: 0, y: 0, width, height: 24 * panes.length },
    focused_pane_id: panes.find((pane) => pane.focused)!.pane_id,
    panes: panes.map((pane, index) => ({
      pane_id: pane.pane_id,
      focused: pane.focused,
      rect: { x: 0, y: index * 24, width, height: 24 },
    })),
    splits: [],
  };
}

function agentPane(
  host: string,
  name: string,
  agent: string,
  status: string,
): Pane {
  return {
    pane_id: `p-${host}-${name}`,
    terminal_id: `term-${host}-${name}`,
    workspace_id: `w-${host}`,
    tab_id: `t-${host}`,
    focused: false,
    agent,
    agent_session: { value: `s-${host}-${name}` },
    agent_status: status,
    revision: 1,
  };
}

function hostFixture(id: string, generation: number): SimulatedHost {
  const tabId = `t-${id}`;
  const panes: Pane[] = [
    {
      pane_id: `p-${id}-shell`,
      terminal_id: `term-${id}-shell`,
      workspace_id: `w-${id}`,
      tab_id: tabId,
      focused: true,
      agent_status: "unknown",
      revision: 1,
    },
    agentPane(id, "a", "claude", "idle"),
    agentPane(id, "b", "codex", "idle"),
    agentPane(id, "status", "claude", "idle"),
    agentPane(id, "task", "codex", "working"),
  ];
  return {
    id,
    generation,
    workspaces: [
      {
        workspace_id: `w-${id}`,
        number: 1,
        label: `Synthetic ${id} workspace`,
        focused: true,
        pane_count: panes.length,
        tab_count: 1,
        active_tab_id: tabId,
        agent_status: "working",
        worktree: {
          repo_key: `repo-${id}`,
          repo_name: "synthetic",
          repo_root: `/synthetic/${id}`,
          checkout_path: `/synthetic/${id}`,
          is_linked_worktree: false,
          git_status: gitStatus("main"),
        },
      },
    ],
    tabs: [
      {
        tab_id: tabId,
        workspace_id: `w-${id}`,
        number: 1,
        label: "Synthetic tab",
        focused: true,
        pane_count: panes.length,
        agent_status: "working",
      },
    ],
    panes,
    layouts: new Map([[tabId, layoutFor(id, tabId, panes, 80)]]),
    activity: new Map([
      [`p-${id}-a`, 1_000],
      [`p-${id}-b`, 2_000],
    ]),
    endpointAvailability: {},
  };
}

const clock = new ManualClock();
const page = new SimulatedDocument();
const world = new SimulatedWorld([
  hostFixture("alpha", 7),
  hostFixture("beta", 3),
]);
type Notice = NonNullable<ReturnType<typeof store.get>["notice"]>;
const notices: Notice[] = [];
const saved = {
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch,
  location: Object.getOwnPropertyDescriptor(globalThis, "location"),
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
};

async function until(predicate: () => boolean, what: string) {
  for (let round = 0; round < 200; round++) {
    if (predicate()) return;
    await microtasks(10);
  }
  throw new Error(`never happened: ${what}`);
}

function paneOf(connectionId: string, paneId: string) {
  return store
    .getConnection(connectionId)
    .panes.find((pane) => pane.pane_id === paneId);
}

function setStatus(connectionId: string, paneId: string, status: string) {
  const pane = world
    .host(connectionId)
    .panes.find((item) => item.pane_id === paneId)!;
  pane.agent_status = status;
  world.event(connectionId, "pane.agent_status_changed", {
    pane_id: paneId,
    workspace_id: pane.workspace_id,
    agent_status: status,
  });
}

/** Idle agents in the attention order the Spaces tree shows. */
function idleOrder(connectionId: string) {
  return sortAgentPanes(
    store
      .getConnection(connectionId)
      .panes.filter((pane) => pane.agent && pane.agent_status === "idle"),
    [],
    "attention",
  ).map((pane) => pane.pane_id);
}

/** The owners this browser last declared; none before its first declaration. */
function lastDeclaredOwners(): unknown[] {
  const owners = world.declarations[world.declarations.length - 1]?.owners;
  return Array.isArray(owners) ? owners : [];
}

beforeAll(async () => {
  clock.install();
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
      protocol: "http:",
      host: "localhost:5173",
      origin: "http://localhost:5173",
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: page,
  });
  globalThis.WebSocket = world.socketClass();
  globalThis.fetch = (async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  store.init();
  await until(
    () =>
      store.getConnection("alpha").panes.length > 0 &&
      store.get().bridgeStatus !== null,
    "the active host and the catalogue load",
  );
  await store.loadConnectionSession("beta");
  await until(
    () => store.getConnection("beta").panes.length > 0,
    "the Inspector's host loads",
  );
  set({
    taskNotificationsEnabled: true,
    taskNotificationPreferences: { completed: true, blocked: true },
  });
  store.subscribe(() => {
    const notice = store.get().notice;
    if (notice && notices[notices.length - 1] !== notice) notices.push(notice);
  });
});

afterAll(() => {
  // Leave the shared Bridge disconnected, as other files in a run expect.
  bridge.disconnect("simulated World test finished");
  clock.uninstall();
  globalThis.WebSocket = saved.WebSocket;
  globalThis.fetch = saved.fetch;
  for (const key of ["location", "document"] as const) {
    const descriptor = saved[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

// Beta's recency on load depends on the Inspector's hold, which the
// implementation adds (tasks 3.4); this case checks only what both share.
test("both hosts load, with the active host's recency and the catalogue", async () => {
  await until(
    () => idleOrder("alpha").join() === "p-alpha-b,p-alpha-a,p-alpha-status",
    "the active host's idle agents are ordered by recency",
  );
  expect(store.getConnection("beta").panes).toHaveLength(5);
  expect(store.get().bridgeStatus?.clients).toBe(1);
  expect(store.get().connections.map((owner) => owner.generation)).toEqual([
    7, 3,
  ]);
});

test("a status event updates that host's panes, on the active and the Inspector's host", async () => {
  setStatus("alpha", "p-alpha-status", "working");
  setStatus("beta", "p-beta-status", "working");
  await clock.flushTimeouts();
  await until(
    () =>
      paneOf("alpha", "p-alpha-status")?.agent_status === "working" &&
      paneOf("beta", "p-beta-status")?.agent_status === "working",
    "both hosts show the new status",
  );
});

test("a focus event re-lists only the host that sent it", async () => {
  const since = world.calls.length;
  for (const pane of world.host("beta").panes)
    pane.focused = pane.pane_id === "p-beta-a";
  world.event("beta", "pane.focused", {
    pane_id: "p-beta-a",
    workspace_id: "w-beta",
  });
  await clock.flushTimeouts();
  await until(
    () => paneOf("beta", "p-beta-a")?.focused === true,
    "the focus hint arrives",
  );
  expect(
    world
      .callsSince(since, "alpha")
      .filter((call) => OBSERVATION_METHODS.has(call.method)),
  ).toEqual([]);
});

test("this browser's own attachment updates availability at once", () => {
  const client = bridge.connection("alpha", 7);
  const since = world.calls.length;
  const attempt = store.beginTerminalAttachment(client, "term-alpha-a");
  expect(store.get().endpointAvailability["term-alpha-a"]).toBeNull();
  store.completeTerminalAttachment(client, "term-alpha-a", attempt, {
    methods: ["pane.scroll"],
    capabilities: [],
  });
  expect(store.get().endpointAvailability["term-alpha-a"]).toEqual({
    methods: ["pane.scroll"],
    capabilities: [],
  });
  expect(world.callsSince(since)).toEqual([]);
});

test("layout.updated re-reads the active tab's layout", async () => {
  const host = world.host("alpha");
  const wider = layoutFor("alpha", "t-alpha", host.panes, 120);
  host.layouts.set("t-alpha", wider);
  world.event("alpha", "layout.updated", { layout: wider });
  await clock.flushTimeouts();
  await until(
    () => store.get().layout?.area.width === 120,
    "the wider layout is shown",
  );
});

test("a working→idle transition notifies once; later re-lists do not", async () => {
  const completions = () =>
    notices.filter((notice) => notice.actionPaneId === "p-beta-task").length;
  expect(completions()).toBe(0);
  setStatus("beta", "p-beta-task", "idle");
  await clock.flushTimeouts();
  await until(() => completions() === 1, "the completion is announced");
  world.event("beta", "pane.updated", {
    pane: world.host("beta").panes.find((pane) => pane.pane_id === "p-beta-a"),
  });
  await clock.flushTimeouts();
  await microtasks(200);
  expect(completions()).toBe(1);
});

test.failing("no browser timer re-lists a host or fetches the catalogue", async () => {
  const since = world.calls.length;
  await clock.advance(12 * PERIOD_MS);
  expect(
    world
      .callsSince(since)
      .filter((call) => OBSERVATION_METHODS.has(call.method))
      .map((call) => `${call.connectionId ?? "bridge"} ${call.method}`),
  ).toEqual([]);
});

test.failing("recency moves without a status change, on both hosts", async () => {
  const since = world.calls.length;
  for (const id of ["alpha", "beta"]) {
    world.host(id).activity.set(`p-${id}-a`, 3_000);
    world.pushActivity(id);
  }
  await clock.flushTimeouts();
  await until(
    () =>
      idleOrder("alpha")[0] === "p-alpha-a" &&
      idleOrder("beta")[0] === "p-beta-a",
    "the more recent idle agent moves first on both hosts",
  );
  expect(
    world
      .callsSince(since)
      .filter((call) => OBSERVATION_METHODS.has(call.method)),
  ).toEqual([]);

  // A late push for a retired generation changes nothing.
  world.host("beta").activity.set("p-beta-b", 9_000);
  world.pushActivity("beta", 2);
  await microtasks(200);
  expect(idleOrder("beta")[0]).toBe("p-beta-a");
  world.host("beta").activity.set("p-beta-b", 2_000);
});

test.failing("a focused change notice re-lists that host only", async () => {
  const since = world.calls.length;
  world.host("alpha").workspaces[0]!.worktree!.git_status = gitStatus(
    "feature",
    true,
  );
  world.control({
    type: "world_focused_changed",
    connection_id: "alpha",
    connection_generation: 7,
    revision: 1,
  });
  await clock.flushTimeouts();
  await until(
    () =>
      store.getConnection("alpha").workspaces[0]?.worktree?.git_status
        ?.branch === "feature",
    "the new branch is shown",
  );
  expect(
    world
      .callsSince(since, "beta")
      .filter((call) => OBSERVATION_METHODS.has(call.method)),
  ).toEqual([]);
});

test.failing("another browser connecting updates the browser count", async () => {
  world.clients = 2;
  world.control({ type: "world_connections_changed", revision: 1 });
  await clock.flushTimeouts();
  await until(
    () => store.get().bridgeStatus?.clients === 2,
    "the browser count changes",
  );
});

test("a failed re-list is retried within one period", async () => {
  world.failNext("alpha", "pane.list");
  world.host("alpha").tabs[0]!.label = "Renamed tab";
  world.event("alpha", "tab.renamed", {
    tab_id: "t-alpha",
    workspace_id: "w-alpha",
    label: "Renamed tab",
  });
  await clock.flushTimeouts();
  await until(
    () => store.getConnection("alpha").error !== null,
    "the re-list fails",
  );
  await clock.advance(PERIOD_MS);
  await until(
    () =>
      store.getConnection("alpha").tabs[0]?.label === "Renamed tab" &&
      store.getConnection("alpha").error === null,
    "the retried re-list succeeds",
  );
});

test.failing("hiding the page releases interest; showing it declares again and catches up", async () => {
  const alpha = { connection_id: "alpha", connection_generation: 7 };
  try {
    expect(world.declarations.length).toBeGreaterThan(0);
    expect(lastDeclaredOwners()).toContainEqual(alpha);
    page.setVisibility("hidden");
    await microtasks(200);
    expect(lastDeclaredOwners()).toEqual([]);
    const since = world.calls.length;
    page.setVisibility("visible");
    await clock.flushTimeouts();
    await until(
      () =>
        lastDeclaredOwners().some(
          (owner) => JSON.stringify(owner) === JSON.stringify(alpha),
        ),
      "the active host is declared again",
    );
    const methods = world.callsSince(since).map((call) => call.method);
    expect(methods).toContain("bridge.status");
    expect(methods).toContain("pane.list");
  } finally {
    page.visibilityState = "visible";
  }
});

test.failing("a runtime replaced elsewhere is admitted after a catalogue notice", async () => {
  const host = world.host("beta");
  host.generation = 4;
  const created = agentPane("beta", "new", "claude", "idle");
  host.panes = [...host.panes, created];
  host.layouts.set("t-beta", layoutFor("beta", "t-beta", host.panes, 80));
  world.control({ type: "world_connections_changed", revision: 2 });
  await clock.flushTimeouts();
  await until(
    () =>
      store.get().connections.find((owner) => owner.id === "beta")
        ?.generation === 4,
    "the new generation is admitted",
  );
  world.event("beta", "pane.created", { pane: created });
  await clock.flushTimeouts();
  await until(
    () => paneOf("beta", "p-beta-new") !== undefined,
    "the new runtime's event is admitted",
  );
});
