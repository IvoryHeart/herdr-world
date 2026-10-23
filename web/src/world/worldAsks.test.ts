import { expect, test } from "bun:test";
import type { BridgeControlMsg } from "../api";
import { WorldAsksStore, type WorldAsk } from "./worldAsks";

const ask = (id: string, answered = false): WorldAsk => ({
  id,
  at: 1,
  actor: { label: "codex in w1:p1", verified: true },
  question: "Which host?",
  options: [],
  owner_only: false,
  ...(answered ? { answer: { text: "studio", at: 2, by: "owner" } } : {}),
});

test("open questions follow the ledger; the owner's answer goes to the service", async () => {
  let control: (msg: BridgeControlMsg) => void = () => {};
  let ledger = { revision: 1, asks: [ask("q-1"), ask("q-2", true)] };
  const calls: unknown[] = [];
  const store = new WorldAsksStore({
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "world.ask.answer")
        ledger = { revision: 2, asks: [ask("q-1", true), ask("q-2", true)] };
      return ledger;
    },
    onControl: (callback) => {
      control = callback;
      return () => {};
    },
    onStatus: () => () => {},
  });
  store.start();
  await store.refresh();
  expect(store.get().map((entry) => entry.id)).toEqual(["q-1"]);
  expect(await store.answer("q-1", "studio")).toBeNull();
  expect(store.get()).toEqual([]);
  expect(calls).toContainEqual({
    method: "world.ask.answer",
    params: { id: "q-1", answer: "studio" },
  });
  // A Board move or a result changes no question: nothing is fetched.
  const fetched = calls.length;
  control({ type: "world_ledger_changed", revision: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls.length).toBe(fetched);
  // A new question from another client refreshes the list, alone.
  ledger = { revision: 4, asks: [ask("q-3")] };
  control({ type: "world_ledger_changed", revision: 4, asks: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.get().map((entry) => entry.id)).toEqual(["q-3"]);
  expect(calls[calls.length - 1]).toEqual({
    method: "world.asks.get",
    params: undefined,
  });
  store.stop();
});
