import { afterAll, beforeAll, expect, test } from "bun:test";
import { bridge } from "../api";
import { store } from "../store";
import {
  installSimulatedBrowser,
  ManualClock,
  settles,
  SimulatedDocument,
  SimulatedWorld,
} from "./testing/simulatedWorld";
import { hostFixture } from "./testing/syntheticHosts";
import { storeReaches } from "./testing/storeSignals";

const clock = new ManualClock(),
  page = new SimulatedDocument();
const world = new SimulatedWorld([hostFixture("alpha", 7)]);
const time = () =>
  store.get().panes.find((pane) => pane.pane_id === "p-alpha-a")
    ?.last_activity_at;
let restore = () => {};
beforeAll(async () => {
  world.restart({});
  clock.install();
  restore = installSimulatedBrowser(world, page);
  store.init();
  await storeReaches(
    () => store.get().panes.length > 0,
    "initial owner without the capability loads",
  );
});
afterAll(() => {
  bridge.disconnect("recency capability test complete");
  clock.uninstall();
  restore();
});

async function push(time: number) {
  const seen = Promise.withResolvers<void>();
  const stop = bridge.onControl((control) => {
    if (control.type === "world_agent_activity") seen.resolve();
  });
  try {
    world.host("alpha").activity.set("p-alpha-a", time);
    world.deliverToAll(world.activity("alpha"));
    await settles(seen.promise, "the activity frame is dispatched");
  } finally {
    stop();
  }
}

test("initial capability absence and removal on reconnect disable pushed acquisition", async () => {
  await push(9000);
  expect(time()).toBe(1000);
  expect(world.declarations).toEqual([]);
  world.host("alpha").activity.set("p-alpha-a", 1000);
  world.restart({ world_shared_acquisition: true });
  let ready = storeReaches(
    () =>
      store.get().status === "connected" &&
      bridge.hello?.capabilities?.world_shared_acquisition === true &&
      store.get().catalogueReady,
    "capability is negotiated",
  );
  await clock.advance(2000);
  await ready;
  await clock.flushTimeouts();
  await push(9000);
  expect(time()).toBe(9000);
  const since = world.calls.length;
  world.host("alpha").activity.set("p-alpha-a", 1000);
  world.restart({});
  ready = storeReaches(
    () =>
      store.get().status === "connected" &&
      bridge.hello?.capabilities?.world_shared_acquisition !== true &&
      store.get().catalogueReady,
    "capability removal is negotiated",
  );
  await clock.advance(2000);
  await ready;
  await clock.flushTimeouts();
  await push(12000);
  expect(time()).toBe(9000);
  expect(
    world
      .callsSince(since)
      .filter((call) => call.method === "world.focused.observe"),
  ).toEqual([]);
});
