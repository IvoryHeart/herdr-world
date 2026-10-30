/**
 * T2: parity for replacing the 5 s focused poll (openspec/changes/
 * shared-acquisition). The real Bridge and focused store run against a
 * simulated World service with two ready hosts: "alpha" is active and "beta"
 * is loaded as an Inspector's host. Timers fire only when a test runs them.
 *
 * Waits await completion signals registered before their trigger: a store
 * emission that meets a named condition, a completed re-list
 * (`lastTopologyObservationStartedAt`), or the service receiving a call.
 * Frames are handled in order, so a frame the browser must ignore is followed
 * by one it applies before the check.
 *
 * `test.failing` marks behaviour the contract requires and today's code lacks;
 * the implementation flips each one. The other cases guard behaviour that must
 * not change when the timer goes.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { sortAgentPanes } from "../agentOrder";
import { bridge } from "../api";
import type { BridgeControlMsg } from "../bridgeControl";
import { set, store } from "../store";
import {
  clearPendingFocusWorkspace,
  stampPendingFocusWorkspace,
} from "./refresh";
import {
  installSimulatedBrowser,
  LIST_METHODS,
  ManualClock,
  OBSERVATION_METHODS,
  settles,
  SimulatedDocument,
  SimulatedWorld,
} from "./testing/simulatedWorld";
import { relisted, storeReaches } from "./testing/storeSignals";
import {
  agentPane,
  gitStatus,
  hostFixture,
  layoutFor,
} from "./testing/syntheticHosts";

const PERIOD_MS = 5_000;

const clock = new ManualClock();
const page = new SimulatedDocument();
const world = new SimulatedWorld([
  hostFixture("alpha", 7),
  hostFixture("beta", 3),
]);
type Notice = NonNullable<ReturnType<typeof store.get>["notice"]>;
const notices: Notice[] = [];
let restoreBrowser = () => {};

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

function observations(since: number, connectionId?: string) {
  return world
    .callsSince(since, connectionId)
    .filter((call) => OBSERVATION_METHODS.has(call.method))
    .map((call) => `${call.connectionId ?? "bridge"} ${call.method}`);
}

/** The owners this browser last declared; none before its first declaration. */
function lastDeclaredOwners(): unknown[] {
  const owners = world.declarations[world.declarations.length - 1]?.owners;
  return Array.isArray(owners) ? owners : [];
}

beforeAll(async () => {
  clock.install();
  restoreBrowser = installSimulatedBrowser(world, page);
  store.init();
  await storeReaches(
    () =>
      store.getConnection("alpha").panes.length > 0 &&
      store.get().bridgeStatus !== null,
    "the active host and the catalogue load",
  );
  await store.loadConnectionSession("beta");
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
  restoreBrowser();
});

test("both hosts load; the active host's first re-list carries its recency", async () => {
  // No recency push has been sent, so this order comes from agent.list.
  await storeReaches(
    () => idleOrder("alpha").join() === "p-alpha-b,p-alpha-a,p-alpha-status",
    "the active host's idle agents are ordered by recency",
  );
  expect(store.getConnection("beta").panes).toHaveLength(5);
  expect(store.get().bridgeStatus?.clients).toBe(1);
  expect(store.get().connections.map((owner) => owner.generation)).toEqual([
    7, 3,
  ]);
});

test("control frames reach the bridge's control handlers", () => {
  const received: BridgeControlMsg[] = [];
  const stop = bridge.onControl((control) => received.push(control));
  // No generation in the catalogue matches, so the store must ignore it.
  const control = {
    type: "world_focused_changed",
    connection_id: "alpha",
    connection_generation: 999,
  } as const;
  try {
    world.deliverToAll(control);
  } finally {
    stop();
  }
  expect(received).toEqual([control as unknown as BridgeControlMsg]);
});

test("a status event updates that host's panes, on the active and the Inspector's host", async () => {
  const alpha = relisted("alpha");
  const beta = relisted("beta");
  setStatus("alpha", "p-alpha-status", "working");
  setStatus("beta", "p-beta-status", "working");
  await clock.flushTimeouts();
  await alpha;
  await beta;
  expect(paneOf("alpha", "p-alpha-status")?.agent_status).toBe("working");
  expect(paneOf("beta", "p-beta-status")?.agent_status).toBe("working");
});

test("a focus event on one host keeps the active host's navigation", async () => {
  set({ selectedPaneId: "p-alpha-a" });
  const seq = stampPendingFocusWorkspace("w-alpha");
  const navigation = () => ({
    selectedPaneId: store.get().selectedPaneId,
    pendingFocusWorkspaceId: store.get().pendingFocusWorkspaceId,
    layout: store.get().layout,
  });
  const before = navigation();
  const since = world.calls.length;
  try {
    const done = relisted("beta");
    for (const pane of world.host("beta").panes)
      pane.focused = pane.pane_id === "p-beta-a";
    world.event("beta", "pane.focused", {
      pane_id: "p-beta-a",
      workspace_id: "w-beta",
    });
    await clock.flushTimeouts();
    await done;
    expect(paneOf("beta", "p-beta-a")?.focused).toBe(true);
    expect(observations(since, "alpha")).toEqual([]);
    expect(navigation()).toEqual(before);
  } finally {
    clearPendingFocusWorkspace(seq);
  }
});

test("this browser's own attachment updates availability at once", () => {
  const client = bridge.connection("alpha", 7);
  const advertisement = { methods: ["pane.scroll"], capabilities: [] };
  const since = world.calls.length;
  const attempt = store.beginTerminalAttachment(client, "term-alpha-a");
  expect(store.get().endpointAvailability["term-alpha-a"]).toBeNull();
  store.completeTerminalAttachment(
    client,
    "term-alpha-a",
    attempt,
    advertisement,
  );
  expect(store.get().endpointAvailability["term-alpha-a"]).toEqual(
    advertisement,
  );
  expect(world.callsSince(since)).toEqual([]);
  // The service's terminal registry now lists it, as for a real attachment.
  world.host("alpha").endpointAvailability["term-alpha-a"] = advertisement;
});

test("layout.updated re-reads the active tab's layout", async () => {
  const host = world.host("alpha");
  const wider = layoutFor("alpha", "t-alpha", host.panes, 120);
  host.layouts.set("t-alpha", wider);
  const done = relisted("alpha");
  world.event("alpha", "layout.updated", { layout: wider });
  await clock.flushTimeouts();
  await done;
  expect(store.get().layout?.area.width).toBe(120);
});

test("a working→idle transition notifies once; a later re-list does not", async () => {
  const completions = () =>
    notices.filter((notice) => notice.actionPaneId === "p-beta-task").length;
  expect(completions()).toBe(0);
  let done = relisted("beta");
  setStatus("beta", "p-beta-task", "idle");
  await clock.flushTimeouts();
  await done;
  expect(completions()).toBe(1);
  done = relisted("beta");
  world.event("beta", "pane.updated", {
    pane: world.host("beta").panes.find((pane) => pane.pane_id === "p-beta-a"),
  });
  await clock.flushTimeouts();
  await done;
  expect(completions()).toBe(1);
});

test("showing the page re-lists the active host and fetches the catalogue", async () => {
  const relist = relisted("alpha");
  const status = world.nextCall("bridge.status");
  page.setVisibility("visible");
  await clock.flushTimeouts();
  await relist;
  await settles(status, "the catalogue is fetched");
});

test("a failed re-list is retried within one period", async () => {
  world.failNext("alpha", "pane.list");
  world.host("alpha").tabs[0]!.label = "Renamed tab";
  const failed = storeReaches(
    () => store.getConnection("alpha").error !== null,
    "the re-list fails",
  );
  world.event("alpha", "tab.renamed", {
    tab_id: "t-alpha",
    workspace_id: "w-alpha",
    label: "Renamed tab",
  });
  await clock.flushTimeouts();
  await failed;
  const retried = storeReaches(
    () =>
      store.getConnection("alpha").tabs[0]?.label === "Renamed tab" &&
      store.getConnection("alpha").error === null,
    "the retried re-list succeeds",
  );
  await clock.advance(PERIOD_MS);
  await clock.flushTimeouts();
  await retried;
});

test.failing("no browser timer re-lists a host or fetches the catalogue", async () => {
  const since = world.calls.length;
  await clock.advance(12 * PERIOD_MS);
  await clock.flushTimeouts();
  expect(observations(since)).toEqual([]);
});

test.failing("the focused re-list marks its four list calls", async () => {
  // Only marked replies update the service's record of what this browser
  // received; other callers of the same methods leave it alone (design D1).
  const since = world.calls.length;
  const done = relisted("alpha");
  world.event("alpha", "pane.updated", {
    pane: world
      .host("alpha")
      .panes.find((pane) => pane.pane_id === "p-alpha-b"),
  });
  await clock.flushTimeouts();
  await done;
  const lists = world
    .callsSince(since, "alpha")
    .filter((call) => LIST_METHODS.has(call.method));
  expect(lists.map((call) => call.method).sort()).toEqual([
    "agent.list",
    "pane.list",
    "tab.list",
    "workspace.list",
  ]);
  expect(lists.filter((call) => !call.focusedObservation)).toEqual([]);
});

test.failing("recency moves without a status change, with no re-list", async () => {
  const since = world.calls.length;
  const activityOf = (paneId: string) =>
    paneOf("alpha", paneId)?.last_activity_at;
  world.host("alpha").activity.set("p-alpha-a", 3_000);
  world.pushActivity("alpha");
  await storeReaches(
    () => activityOf("p-alpha-a") === 3_000,
    "the pushed recency applies",
  );
  expect(idleOrder("alpha")[0]).toBe("p-alpha-a");
  expect(observations(since)).toEqual([]);

  // Two frames the browser must ignore: another session's entry, and a late
  // push for a retired generation. Then one it applies.
  const later = {
    pane_id: "p-alpha-b",
    terminal_id: "term-alpha-b",
    agent: "codex",
    last_activity_at: 9_000,
  };
  world.deliverToAll({
    ...world.activity("alpha"),
    agents: [{ ...later, session: "s-another-session" }],
  });
  world.deliverToAll({
    ...world.activity("alpha", 6),
    agents: [{ ...later, session: "s-alpha-b" }],
  });
  world.host("alpha").activity.set("p-alpha-a", 3_500);
  world.pushActivity("alpha");
  await storeReaches(
    () => activityOf("p-alpha-a") === 3_500,
    "the following push applies",
  );
  expect(activityOf("p-alpha-b")).toBe(2_000);
});

test.failing("a focused change notice re-lists that host only", async () => {
  const since = world.calls.length;
  const host = world.host("alpha");
  host.workspaces[0]!.worktree!.git_status = gitStatus("feature", true);
  host.endpointAvailability["term-alpha-b"] = {
    methods: ["pane.scroll"],
    capabilities: [],
  };
  const done = relisted("alpha");
  world.notifyFocused("alpha");
  await clock.flushTimeouts();
  await done;
  expect(
    store.getConnection("alpha").workspaces[0]?.worktree?.git_status?.branch,
  ).toBe("feature");
  expect(store.get().endpointAvailability["term-alpha-b"]).toEqual({
    methods: ["pane.scroll"],
    capabilities: [],
  });
  expect(observations(since, "beta")).toEqual([]);
});

test.failing("another browser connecting updates the browser count", async () => {
  world.clients = 2;
  const fetched = world.nextCall("bridge.status");
  world.control({
    type: "world_connections_changed",
    revision: world.nextRevision(),
  });
  await clock.flushTimeouts();
  await settles(fetched, "the catalogue is fetched");
  await storeReaches(
    () => store.get().bridgeStatus?.clients === 2,
    "the browser count changes",
  );
});

test.failing("hiding the page releases interest; showing it declares again", async () => {
  const alpha = { connection_id: "alpha", connection_generation: 7 };
  try {
    expect(lastDeclaredOwners()).toContainEqual(alpha);
    const released = world.nextCall("world.focused.observe");
    page.setVisibility("hidden");
    await settles(released, "the hidden page releases its interest");
    expect(lastDeclaredOwners()).toEqual([]);
    const declared = world.nextCall("world.focused.observe");
    page.setVisibility("visible");
    await clock.flushTimeouts();
    await settles(declared, "the shown page declares again");
    expect(lastDeclaredOwners()).toContainEqual(alpha);
  } finally {
    page.visibilityState = "visible";
  }
});

test.failing("a runtime replaced elsewhere is repaired by the catalogue notice", async () => {
  const host = world.host("alpha");
  host.generation = 8;
  const created = agentPane("alpha", "new", "claude", "idle");
  // Working in generation 7, idle in generation 8's first list.
  host.panes.find((pane) => pane.pane_id === "p-alpha-task")!.agent_status =
    "idle";
  host.panes = [...host.panes, created];
  host.layouts.set("t-alpha", layoutFor("alpha", "t-alpha", host.panes, 80));
  // Generation 8 isn't admitted yet, so its event is dropped.
  world.event("alpha", "pane.created", { pane: created });
  expect(paneOf("alpha", "p-alpha-new")).toBeUndefined();

  const noticesBefore = notices.length;
  world.control({
    type: "world_connections_changed",
    revision: world.nextRevision(),
  });
  await clock.flushTimeouts();
  await storeReaches(
    () => paneOf("alpha", "p-alpha-new") !== undefined,
    "admitting generation 8 re-lists the host",
  );
  expect(
    store.get().connections.find((owner) => owner.id === "alpha")?.generation,
  ).toBe(8);
  expect(
    notices
      .slice(noticesBefore)
      .filter((notice) => notice.actionPaneId === "p-alpha-task"),
  ).toEqual([]);
  expect(lastDeclaredOwners()).toContainEqual({
    connection_id: "alpha",
    connection_generation: 8,
  });

  // Late generation-7 frames change nothing and cause no generation-7 call.
  const since = world.calls.length;
  world.deliverToAll({
    type: "world_focused_changed",
    connection_id: "alpha",
    connection_generation: 7,
  });
  world.deliverToAll({
    ...world.activity("alpha", 7),
    agents: [
      {
        pane_id: "p-alpha-b",
        terminal_id: "term-alpha-b",
        agent: "codex",
        session: "s-alpha-b",
        last_activity_at: 9_000,
      },
    ],
  });
  host.activity.set("p-alpha-a", 4_000);
  world.pushActivity("alpha");
  await clock.flushTimeouts();
  await storeReaches(
    () => paneOf("alpha", "p-alpha-a")?.last_activity_at === 4_000,
    "generation 8's push applies",
  );
  expect(paneOf("alpha", "p-alpha-b")?.last_activity_at).not.toBe(9_000);
  expect(
    world.callsSince(since, "alpha").filter((call) => call.generation === 7),
  ).toEqual([]);
});

// Last: it restarts the service. A service that doesn't advertise
// `world_shared_acquisition`, because it is older or was told to stop, still
// gets today's 5 s re-list and catalogue fetch (design D9).
test("after reconnecting to a service without the capability, the 5 s re-list and catalogue fetch resume", async () => {
  world.restart({});
  const reconnected = storeReaches(
    () => store.get().status === "connected",
    "the browser reconnects",
  );
  await clock.advance(2_000);
  await reconnected;
  await clock.flushTimeouts();
  const relist = relisted("alpha");
  const status = world.nextCall("bridge.status");
  await clock.advance(PERIOD_MS);
  await clock.flushTimeouts();
  await relist;
  await settles(status, "the catalogue is fetched");
});
