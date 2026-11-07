import { expect, test } from "bun:test";
import { awaySinceParam, OwnerPresence, parseServiceSeen } from "./presence";

const MIN = 60_000;

function fixture(
  service: () => Promise<{
    previous: number | null;
    now: number;
  } | null> = () => Promise.resolve(null),
) {
  const clock = { now: 1_000 * MIN };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const calls: number[] = [];
  const deps = {
    now: () => clock.now,
    storage,
    service: () => {
      calls.push(clock.now);
      return service();
    },
  };
  return { clock, storage, calls, presence: new OwnerPresence(deps), deps };
}

test("a first sighting records last seen without a return", async () => {
  const { presence } = fixture();
  await presence.sighted(true);
  expect(presence.get()).toEqual({ away: null, dismissed: false });
});

test("30 minutes away is a return; a short tab switch is not", async () => {
  const { clock, presence } = fixture();
  await presence.sighted(true);
  clock.now += 29 * MIN;
  await presence.sighted(true);
  expect(presence.get().away).toBeNull();
  const left = clock.now;
  clock.now += 3 * 60 * MIN;
  await presence.sighted(true);
  expect(presence.get().away).toEqual({
    since: left,
    at: clock.now,
    opened: [],
  });
});

test("input within ten seconds changes nothing; the service hears at most each minute", async () => {
  const { clock, calls, presence } = fixture();
  await presence.sighted(true);
  clock.now += 5_000;
  await presence.sighted();
  clock.now += 20_000;
  await presence.sighted();
  expect(calls).toHaveLength(1);
  clock.now += 60_000;
  await presence.sighted();
  expect(calls).toHaveLength(2);
});

test("another device's recent sighting on the service is not a return", async () => {
  let previous: number | null = null;
  const { clock, presence } = fixture(async () => ({
    previous,
    now: clock.now + 7 * MIN, // the service's clock runs ahead
  }));
  await presence.sighted(true);
  clock.now += 2 * 60 * MIN;
  // The owner used another device until two minutes ago.
  previous = clock.now + 5 * MIN;
  await presence.sighted(true);
  expect(presence.get().away).toBeNull();
  // A new browser with no last seen of its own learns from the service.
  const other = fixture(async () => ({ previous: 0, now: 45 * MIN }));
  await other.presence.sighted(true);
  expect(other.presence.get().away).toEqual({
    since: other.clock.now - 45 * MIN,
    at: other.clock.now,
    opened: [],
  });
});

test("an unreachable service leaves this browser's last seen to decide", async () => {
  const { clock, presence } = fixture(() => Promise.reject(new Error("down")));
  await presence.sighted(true);
  clock.now += 40 * MIN;
  await presence.sighted(true);
  expect(presence.get().away?.at).toBe(clock.now);
});

test("✕ clears the recap until the next return; opened items lose their dot", async () => {
  const { clock, deps, presence } = fixture();
  presence.begin({ since: clock.now - 120 * MIN, at: clock.now });
  presence.opened("ask:q1");
  presence.opened("ask:q1");
  expect(presence.get().away?.opened).toEqual(["ask:q1"]);
  presence.dismiss();
  expect(presence.get().dismissed).toBe(true);
  // A reload reads the same state back.
  expect(new OwnerPresence(deps).get()).toEqual(presence.get());
  clock.now += 90 * MIN;
  await presence.sighted(true);
  expect(presence.get()).toEqual({
    away: { since: clock.now - 90 * MIN, at: clock.now, opened: [] },
    dismissed: false,
  });
});

test("the testing parameter and the service reply are read strictly", () => {
  expect(awaySinceParam("?awaySince=120")).toBe(120 * MIN);
  expect(awaySinceParam("?awaySince=2h")).toBe(120 * MIN);
  expect(awaySinceParam("?awaySince=0")).toBeNull();
  expect(awaySinceParam("?awaySince=soon")).toBeNull();
  expect(awaySinceParam("")).toBeNull();
  expect(parseServiceSeen({ previous: null, now: 5 })).toEqual({
    previous: null,
    now: 5,
  });
  expect(parseServiceSeen({ previous: "x", now: 5 })).toBeNull();
  expect(parseServiceSeen(null)).toBeNull();
});
