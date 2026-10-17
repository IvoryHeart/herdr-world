import { expect, test } from "bun:test";
import { nextTownCall, type TownCall } from "./TownRail";

const call = (key: string, kind: TownCall["kind"]) =>
  ({ agent: { key }, kind }) as unknown as TownCall;

test("Next visits every waiting agent in turn, then wraps", () => {
  const calls = [
    call("a", "blocked"),
    call("b", "blocked"),
    call("c", "blocked"),
    call("d", "done"),
  ];
  const visited: string[] = [];
  let current: string | null = null;
  for (let step = 0; step < 4; step += 1) {
    current = nextTownCall(calls, current)!.agent.key;
    visited.push(current);
  }
  // Waiting agents come before finished ones; the queue wraps after c.
  expect(visited).toEqual(["a", "b", "c", "a"]);
});

test("Next moves to a finished agent only when no other agent waits", () => {
  const calls = [call("a", "blocked"), call("d", "done"), call("e", "done")];
  expect(nextTownCall(calls, "a")?.agent.key).toBe("d");
  expect(nextTownCall(calls, "d")?.agent.key).toBe("a");
  expect(nextTownCall([call("a", "blocked")], "a")).toBeNull();
});
