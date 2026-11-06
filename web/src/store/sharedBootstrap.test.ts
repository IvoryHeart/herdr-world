import { afterAll, beforeAll, expect, test } from "bun:test";
import { bridge } from "../api";
import { store } from "../store";
import {
  installSimulatedBrowser,
  ManualClock,
  SimulatedDocument,
  SimulatedWorld,
  settles,
} from "./testing/simulatedWorld";
import { storeReaches } from "./testing/storeSignals";
import { hostFixture } from "./testing/syntheticHosts";
const clock = new ManualClock(),
  page = new SimulatedDocument();
const world = new SimulatedWorld([hostFixture("alpha", 7)]);
let restore = () => {},
  failures = 2;
let original: typeof bridge.call;
beforeAll(() => {
  clock.install();
  restore = installSimulatedBrowser(world, page);
  original = bridge.call;
  bridge.call = ((method, ...args) =>
    method === "connections.list" ||
    (method === "bridge.status" && failures-- > 0)
      ? Promise.reject(new Error("synthetic bootstrap failure"))
      : original.call(bridge, method, ...args)) as typeof bridge.call;
});
afterAll(() => {
  bridge.call = original;
  bridge.disconnect("bootstrap test complete");
  clock.uninstall();
  restore();
});
test("a failed initial catalogue recovers through failure retries without a browser poll", async () => {
  store.init();
  await storeReaches(
    () => store.get().status === "connected",
    "socket connects",
  );
  await clock.flushTimeouts();
  expect(store.get().catalogueReady).toBe(false);
  const arrived = world.nextCall("bridge.status");
  await clock.advance(10000);
  await settles(arrived, "bootstrap status retry reaches the service");
  await clock.flushTimeouts();
  await storeReaches(
    () => store.get().catalogueReady && store.get().panes.length > 0,
    "bootstrap catalogue admits and loads the owner",
  );
  expect(world.declarations[world.declarations.length - 1]?.owners).toEqual([
    { connection_id: "alpha", connection_generation: 7 },
  ]);
  const since = world.calls.length;
  await clock.advance(15000);
  expect(
    world
      .callsSince(since)
      .filter((call) =>
        ["bridge.status", "workspace.list"].includes(call.method),
      ),
  ).toEqual([]);
});
