import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { bridge } from "../api";
import { store } from "../store";
import {
  installSimulatedBrowser,
  ManualClock,
  OBSERVATION_METHODS,
  settles,
  SimulatedDocument,
  SimulatedWorld,
} from "./testing/simulatedWorld";
import { hostFixture } from "./testing/syntheticHosts";
import { relisted, storeReaches } from "./testing/storeSignals";

const clock = new ManualClock(),
  page = new SimulatedDocument();
const world = new SimulatedWorld([
  hostFixture("alpha", 7),
  hostFixture("beta", 3),
]);
let restore = () => {};
const time = (owner: string, pane = "a") =>
  store
    .getConnection(owner)
    .panes.find((p) => p.pane_id === `p-${owner}-${pane}`)?.last_activity_at;

beforeAll(async () => {
  clock.install();
  restore = installSimulatedBrowser(world, page);
  store.init();
  await storeReaches(
    () =>
      store.getConnection("alpha").panes.length > 0 &&
      store.get().bridgeStatus !== null,
    "active owner loads",
  );
  await store.loadConnectionSession("beta");
});
afterAll(() => {
  bridge.disconnect("recency test complete");
  clock.uninstall();
  restore();
});

test("real Bridge controls push recency into both ready owners without re-listing or changing focus", async () => {
  const since = world.calls.length;
  const selected = store.get().selectedPaneId;
  const done = storeReaches(
    () => time("alpha") === 3000 && time("beta") === 4000,
    "both recency pushes apply",
  );
  world.host("alpha").activity.set("p-alpha-a", 3000);
  world.host("beta").activity.set("p-beta-a", 4000);
  world.deliverToAll(world.activity("alpha"));
  world.deliverToAll(world.activity("beta"));
  await done;
  expect(
    world
      .callsSince(since)
      .filter((call) => OBSERVATION_METHODS.has(call.method)),
  ).toEqual([]);
  expect(store.get().activeConnectionId).toBe("alpha");
  expect(store.get().selectedPaneId).toBe(selected);
});

test("late generations, other sessions and older list replies cannot undo pushed recency", async () => {
  const done = storeReaches(
    () => time("alpha") === 3500,
    "the following current push applies",
  );
  world.deliverToAll({
    ...world.activity("alpha", 6),
    agents: [
      {
        pane_id: "p-alpha-a",
        terminal_id: "term-alpha-a",
        agent: "codex",
        session: "s-alpha-a",
        last_activity_at: 9000,
      },
    ],
  });
  world.deliverToAll({
    ...world.activity("alpha"),
    agents: [
      {
        pane_id: "p-alpha-b",
        terminal_id: "term-alpha-b",
        agent: "codex",
        session: "other-session",
        last_activity_at: 9000,
      },
    ],
  });
  world.host("alpha").activity.set("p-alpha-a", 3500);
  world.deliverToAll(world.activity("alpha"));
  await done;
  expect(time("alpha", "b")).toBe(2000);
  world.host("alpha").activity.set("p-alpha-a", 100);
  const refreshed = relisted("alpha");
  world.event("alpha", "pane.updated", { pane_id: "p-alpha-a" });
  await clock.flushTimeouts();
  await refreshed;
  expect(time("alpha")).toBe(3500);
});

test("a push during a pending layout read survives publication of the older re-list", async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = bridge.connection.bind(bridge);
  const intercepted = spyOn(bridge, "connection").mockImplementation(
    (...args) => {
      const client = original(...args);
      return {
        ...client,
        async call(method, params, timeout) {
          const result = await client.call(method, params, timeout);
          if (method === "pane.layout" && client.connectionId === "alpha") {
            entered.resolve();
            await release.promise;
          }
          return result;
        },
      };
    },
  );
  try {
    world.host("alpha").activity.set("p-alpha-a", 100);
    const refreshed = relisted("alpha");
    world.event("alpha", "pane.updated", { pane_id: "p-alpha-a" });
    await clock.flushTimeouts();
    await settles(entered.promise, "the old re-list waits on its layout");
    const pushed = storeReaches(
      () => time("alpha") === 4500,
      "the newer push applies during the read",
    );
    world.host("alpha").activity.set("p-alpha-a", 4500);
    world.deliverToAll(world.activity("alpha"));
    await pushed;
    release.resolve();
    await refreshed;
    expect(time("alpha")).toBe(4500);
  } finally {
    release.resolve();
    intercepted.mockRestore();
  }
});
