import { afterAll, beforeAll, expect, test } from "bun:test";
import { bridge } from "../api";
import { store, refreshBridgeStatus } from "../store";
import {
  installSimulatedBrowser,
  ManualClock,
  SimulatedDocument,
  SimulatedWorld,
  settles,
} from "./testing/simulatedWorld";
import { relisted, storeReaches } from "./testing/storeSignals";
import { hostFixture } from "./testing/syntheticHosts";

const clock = new ManualClock(),
  page = new SimulatedDocument();
const world = new SimulatedWorld([
  hostFixture("alpha", 7),
  hostFixture("beta", 3),
]);
const beta = { connection_id: "beta", connection_generation: 3 };
let restore = () => {};
const owners = () =>
  world.declarations[world.declarations.length - 1]?.owners as unknown[];
const calls = (method: string, since: number, id?: string) =>
  world.callsSince(since, id).filter((call) => call.method === method);
beforeAll(async () => {
  clock.install();
  restore = installSimulatedBrowser(world, page);
  store.init();
  await storeReaches(() => store.get().panes.length > 0, "active host loads");
  await store.loadConnectionSession("beta");
  await clock.flushTimeouts();
});
afterAll(() => {
  bridge.disconnect("shared acquisition tests complete");
  clock.uninstall();
  restore();
});

test("Inspector admissions hold independently, refresh an already-held owner and receive its recency", async () => {
  expect(owners()).not.toContainEqual(beta);
  const declared = world.nextCall("world.focused.observe"),
    firstRead = relisted("beta");
  const first = store.holdFocusedOwner(beta);
  try {
    await settles(declared, "Inspector declares beta");
    await clock.flushTimeouts();
    await firstRead;
    expect(owners()).toContainEqual(beta);
    const active = store.get().activeConnectionId;
    world.host("beta").activity.set("p-beta-a", 9000);
    world.pushActivity("beta");
    await storeReaches(
      () =>
        store
          .getConnection("beta")
          .panes.find((pane) => pane.pane_id === "p-beta-a")
          ?.last_activity_at === 9000,
      "Inspector receives recency",
    );
    const again = relisted("beta"),
      second = store.holdFocusedOwner(beta);
    try {
      await clock.flushTimeouts();
      await again;
      first();
      await clock.flushTimeouts();
      expect(owners()).toContainEqual(beta);
      expect(store.get().activeConnectionId).toBe(active);
    } finally {
      second();
    }
    await clock.flushTimeouts();
    expect(owners()).not.toContainEqual(beta);
  } finally {
    first();
  }
});

test("showing the page refreshes every held owner; obsolete and unknown holds never acquire", async () => {
  const release = store.holdFocusedOwner(beta);
  const old = store.holdFocusedOwner({ ...beta, connection_generation: 2 });
  const unknown = store.holdFocusedOwner({ ...beta, connection_id: "unknown" });
  try {
    await clock.flushTimeouts();
    page.setVisibility("hidden");
    await clock.flushTimeouts();
    expect(owners()).toEqual([]);
    const alphaRead = relisted("alpha"),
      betaRead = relisted("beta");
    page.setVisibility("visible");
    await clock.flushTimeouts();
    await Promise.all([alphaRead, betaRead]);
    expect(owners()).toEqual([
      { connection_id: "alpha", connection_generation: 7 },
      beta,
    ]);
    const since = world.calls.length;
    world.deliverToAll({
      type: "world_focused_changed",
      ...beta,
      connection_generation: 2,
    });
    world.deliverToAll({
      type: "world_focused_changed",
      ...beta,
      connection_id: "unknown",
    });
    await clock.flushTimeouts();
    expect(world.callsSince(since)).toEqual([]);
  } finally {
    release();
    old();
    unknown();
    await clock.flushTimeouts();
  }
});

test("failed Inspector re-lists retry per period, stop on success and cancel on last release or hide", async () => {
  const release = store.holdFocusedOwner(beta);
  try {
    await clock.flushTimeouts();
    const since = world.calls.length;
    world.failNext("beta", "workspace.list", 2);
    world.notifyFocused("beta");
    await clock.flushTimeouts();
    await storeReaches(
      () => !!store.getConnection("beta").error,
      "held read fails",
    );
    await clock.advance(5000);
    expect(calls("workspace.list", since, "beta")).toHaveLength(2);
    await clock.advance(5000);
    await storeReaches(
      () => store.getConnection("beta").error === null,
      "held retry succeeds",
    );
    await clock.advance(15000);
    expect(calls("workspace.list", since, "beta")).toHaveLength(3);
    world.failNext("beta", "workspace.list");
    world.notifyFocused("beta");
    await clock.flushTimeouts();
    await storeReaches(
      () => !!store.getConnection("beta").error,
      "next read fails",
    );
    const dropped = world.calls.length;
    release();
    await clock.advance(10000);
    expect(calls("workspace.list", dropped, "beta")).toEqual([]);
    world.failNext("alpha", "workspace.list");
    world.notifyFocused("alpha");
    await clock.flushTimeouts();
    await storeReaches(
      () => !!store.getConnection("alpha").error,
      "active read fails",
    );
    page.setVisibility("hidden");
    const hidden = world.calls.length;
    await clock.advance(10000);
    expect(calls("workspace.list", hidden)).toEqual([]);
    page.setVisibility("visible");
    await clock.flushTimeouts();
    await storeReaches(() => !store.get().error, "show repairs active host");
  } finally {
    release();
    page.setVisibility("visible");
  }
});

test("catalogue notices coalesce to one in flight and one successor carrying the latest browser count", async () => {
  const call = bridge.call,
    gate = Promise.withResolvers<void>();
  let blocked = true;
  bridge.call = ((method, ...args) => {
    const read = call.call(bridge, method, ...args);
    if (method !== "bridge.status" || !blocked) return read;
    blocked = false;
    return read.then(async (result) => {
      await gate.promise;
      return result;
    });
  }) as typeof bridge.call;
  const since = world.calls.length;
  try {
    world.clients = 2;
    const arrived = world.nextCall("bridge.status");
    world.control({
      type: "world_connections_changed",
      revision: world.nextRevision(),
    });
    await settles(arrived, "catalogue read starts");
    world.clients = 3;
    for (let index = 0; index < 20; index++)
      world.control({
        type: "world_connections_changed",
        revision: world.nextRevision(),
      });
    expect(calls("bridge.status", since)).toHaveLength(1);
    gate.resolve();
    await storeReaches(
      () => store.get().bridgeStatus?.clients === 3,
      "queued catalogue read sees latest count",
    );
    await clock.flushTimeouts();
    expect(calls("bridge.status", since)).toHaveLength(2);
    await clock.advance(15000);
    expect(calls("bridge.status", since)).toHaveLength(2);
  } finally {
    gate.resolve();
    bridge.call = call;
  }
});

test("a deferred catalogue from a retired socket neither blocks nor overwrites reconnect", async () => {
  const call = bridge.call,
    gate = Promise.withResolvers<void>();
  let blocked = true;
  bridge.call = ((method, ...args) => {
    const read = call.call(bridge, method, ...args);
    if (method !== "bridge.status" || !blocked) return read;
    blocked = false;
    return read.then(async (result) => {
      await gate.promise;
      return result;
    });
  }) as typeof bridge.call;
  try {
    world.clients = 2;
    const arrived = world.nextCall("bridge.status");
    const old = refreshBridgeStatus();
    await settles(arrived, "old catalogue read starts");
    world.clients = 4;
    world.restart({ world_shared_acquisition: true });
    await clock.advance(2000);
    await clock.flushTimeouts();
    await storeReaches(
      () =>
        store.get().catalogueReady && store.get().bridgeStatus?.clients === 4,
      "new socket catalogue completes independently",
    );
    gate.resolve();
    await old;
    expect(store.get().bridgeStatus?.clients).toBe(4);
    const since = world.calls.length;
    await clock.advance(15000);
    expect(calls("bridge.status", since)).toEqual([]);
  } finally {
    gate.resolve();
    bridge.call = call;
  }
});

test("catalogue failures retry only while visible and stop after success", async () => {
  const call = bridge.call;
  let failures = 2;
  bridge.call = ((method, ...args) =>
    method === "bridge.status" && failures-- > 0
      ? Promise.reject(new Error("synthetic catalogue failure"))
      : call.call(bridge, method, ...args)) as typeof bridge.call;
  try {
    await refreshBridgeStatus();
    await clock.advance(5000);
    expect(failures).toBe(0);
    const arrived = world.nextCall("bridge.status");
    await clock.advance(5000);
    await settles(arrived, "catalogue retry succeeds");
    const since = world.calls.length;
    await clock.advance(15000);
    expect(calls("bridge.status", since)).toEqual([]);
    failures = 1;
    await refreshBridgeStatus();
    page.setVisibility("hidden");
    await clock.advance(10000);
    expect(failures).toBe(0);
    page.setVisibility("visible");
    await clock.flushTimeouts();
  } finally {
    bridge.call = call;
    page.setVisibility("visible");
  }
});
