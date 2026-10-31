import { afterAll, beforeAll, expect, test } from "bun:test";
import { bridge } from "../api";
import { sortAgentPanes } from "../agentOrder";
import { store } from "../store";
import {
  installSimulatedBrowser,
  ManualClock,
  settles,
  SimulatedDocument,
  SimulatedWorld,
} from "./testing/simulatedWorld";
import { hostFixture } from "./testing/syntheticHosts";
import { relisted, storeReaches } from "./testing/storeSignals";

const clock = new ManualClock(),
  page = new SimulatedDocument();
const world = new SimulatedWorld([hostFixture("alpha", 7)]);
const time = () =>
  store.get().panes.find((pane) => pane.pane_id === "p-alpha-a")
    ?.last_activity_at;
const order = () =>
  sortAgentPanes(
    store.get().panes.filter((pane) => pane.agent_status === "idle"),
    [],
    "attention",
  ).map((pane) => pane.pane_id);
let restore = () => {};
beforeAll(async () => {
  clock.install();
  restore = installSimulatedBrowser(world, page);
  store.init();
  await storeReaches(() => store.get().panes.length > 0, "initial owner loads");
});
afterAll(() => {
  bridge.disconnect("recency reconnect test complete");
  clock.uninstall();
  restore();
});

async function reconnect(generation: number) {
  const observed = relisted("alpha");
  world.host("alpha").generation = generation;
  world.restart({ world_shared_acquisition: true });
  const ready = storeReaches(
    () =>
      store.get().status === "connected" &&
      store.get().serverRuntimeGeneration === generation &&
      store.get().panes.length > 0,
    "the restarted service admits its owner",
  );
  await clock.advance(2000);
  await clock.flushTimeouts();
  await ready;
  await observed;
}

test("the exact session keeps its maximum and ordering across reconnect and service counter reset", async () => {
  let pushed = storeReaches(() => time() === 9000, "first maximum arrives");
  world.host("alpha").activity.set("p-alpha-a", 9000);
  world.deliverToAll(world.activity("alpha"));
  await pushed;
  world.host("alpha").activity.set("p-alpha-a", 1000);
  await reconnect(7);
  expect(time()).toBe(9000);
  pushed = storeReaches(() => time() === 12000, "second maximum arrives");
  world.host("alpha").activity.set("p-alpha-a", 12000);
  world.deliverToAll(world.activity("alpha"));
  await pushed;
  for (const unavailable of [false, true]) {
    await reconnect(9);
    if (unavailable) world.host("alpha").activity.delete("p-alpha-a");
    else world.host("alpha").activity.set("p-alpha-a", 100);
    await reconnect(1);
    expect(time()).toBe(12000);
    expect(order()[0]).toBe("p-alpha-a");
  }
  const dispatched = Promise.withResolvers<void>();
  const stop = bridge.onControl((control) => {
    if (
      control.type === "world_agent_activity" &&
      control.connection_generation === 9
    )
      dispatched.resolve();
  });
  try {
    world.deliverToAll({
      ...world.activity("alpha", 9),
      agents: [
        {
          pane_id: "p-alpha-a",
          terminal_id: "term-alpha-a",
          agent: "codex",
          session: "s-alpha-a",
          last_activity_at: 99999,
        },
      ],
    });
    await settles(
      dispatched.promise,
      "obsolete generation frame is dispatched",
    );
    expect(time()).toBe(12000);
  } finally {
    stop();
  }
});
