import { expect, test } from "bun:test";
import type { BridgeControlMsg, ConnectionStatus } from "../api";
import {
  WorldAnswerDeliveriesStore,
  type AnswerNotice,
} from "./worldAnswerDeliveries";
const notice = (id: string): AnswerNotice => ({
  ask: {
    id,
    at: 1,
    question: "Proceed?",
    options: [],
    actor: { label: "Fixture", verified: true },
    owner_only: true,
    answer: { text: "Proceed", at: 2, by: "owner", occurrence: "a-fixture" },
  },
  delivery: { state: "uncertain", attempt: 4 },
  can_resend: true,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("answer recovery uses its own subscription and exact decision witness, with a bounded page", async () => {
  let control: (msg: BridgeControlMsg) => void = () => {};
  let page = {
    revision: 1,
    incarnation: "first",
    deliveries: [notice("q-1")],
    next: "o-next" as string | null,
  };
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const store = new WorldAnswerDeliveriesStore({
    call: async (method, params) => {
      calls.push({ method, params });
      if (method.endsWith("resend"))
        page = { ...page, revision: 2, deliveries: [], next: null };
      return page;
    },
    onControl: (callback) => {
      control = callback;
      return () => {};
    },
    onStatus: () => () => {},
  });
  store.start();
  await tick();
  expect(store.get().entries).toEqual([notice("q-1")]);
  const queries = calls.length;
  control({ type: "world_ledger_changed", asks: true, revision: 20 });
  await tick();
  expect(calls).toHaveLength(queries);
  expect(await store.decide(notice("q-1"), "resend")).toBeNull();
  expect(calls).toContainEqual({
    method: "world.ask.delivery.resend",
    params: {
      id: "q-1",
      occurrence: "a-fixture",
      attempt: 4,
      confirm_duplicate: true,
    },
  });
  expect(store.get().entries).toEqual([]);
  page = {
    revision: 3,
    incarnation: "first",
    deliveries: Array.from({ length: 65 }, (_, i) => notice(`q-${i}`)),
    next: "o-next",
  };
  control({
    type: "world_ask_delivery_changed",
    revision: 3,
    incarnation: "first",
  });
  await tick();
  expect(store.get().entries).toHaveLength(60);
  await store.older();
  expect(calls[calls.length - 1]).toEqual({
    method: "world.ask.deliveries.get",
    params: { after: "o-next" },
  });
  expect(store.get().older).toBe(true);
  store.stop();
});
test("a late response from a disconnected service cannot restore old delivery controls", async () => {
  let status: (value: ConnectionStatus) => void = () => {};
  const old = Promise.withResolvers<unknown>();
  let query = 0;
  const store = new WorldAnswerDeliveriesStore({
    call: async () =>
      ++query === 1
        ? old.promise
        : { revision: 0, incarnation: "second", deliveries: [], next: null },
    onControl: () => () => {},
    onStatus: (callback) => {
      status = callback;
      return () => {};
    },
  });
  store.start();
  status("disconnected");
  status("connected");
  await tick();
  old.resolve({
    revision: 900,
    incarnation: "first",
    deliveries: [notice("q-stale")],
    next: null,
  });
  await tick();
  expect(store.get().entries).toEqual([]);
  store.stop();
});

test("resend success needs an exact positive receipt, keeps a bounded local Sent card and clears it on refresh", async () => {
  const original = notice("q-queued");
  let answered = false;
  const store = new WorldAnswerDeliveriesStore({
    call: async (method) => {
      if (method === "world.ask.delivery.resend") {
        answered = true;
        return {};
      }
      if (method === "world.ask.delivery.get")
        return { ...original, delivery: { state: "delivered", attempt: 6 } };
      return {
        revision: answered ? 2 : 1,
        incarnation: "fixture",
        deliveries: answered ? [] : [original],
        next: null,
        counts: {
          checks: answered ? 0 : 1,
          waiting: 70,
          connections: { studio: answered ? 70 : 71 },
        },
      };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  store.start();
  await tick();
  expect(store.get().counts?.waiting).toBe(70);
  await store.decide(original, "resend");
  expect(store.get().entries[0]?.delivery.state).toBe("delivered");
  expect(store.get().counts?.checks).toBe(0);
  await store.refresh();
  expect(store.get().entries).toEqual([]);
  store.stop();
});
