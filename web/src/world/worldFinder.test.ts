import { afterEach, expect, test } from "bun:test";
import { worldFinder } from "./worldFinder";
import type { WorldSearchResult } from "./worldSearch";

const result: WorldSearchResult = {
  id: "agent-1",
  nodeId: "agent-1",
  kind: "agent",
  label: "Synthetic agent",
  place: ["example-host"],
  status: "working",
  stale: false,
  excerpt: null,
  rank: 0,
};

afterEach(() => worldFinder.end());

test("typing shares the box's search with its view; emptying ends it", () => {
  const seen: unknown[] = [];
  const stop = worldFinder.subscribe(() => seen.push(worldFinder.get()));
  worldFinder.type("town", "synth");
  expect(worldFinder.get()).toEqual({
    view: "town",
    query: "synth",
    chosen: null,
  });
  // The same text again changes nothing.
  worldFinder.type("town", "synth");
  expect(seen).toHaveLength(1);
  worldFinder.type("town", "  ");
  expect(worldFinder.get()).toBeNull();
  stop();
});

test("each choice goes again; closing keeps a chosen search, ends an unchosen one", () => {
  worldFinder.type("board", "synth");
  worldFinder.closed();
  expect(worldFinder.get()).toBeNull();
  worldFinder.choose("board", "synth", result);
  const first = worldFinder.get()!.chosen!;
  expect(first.result).toBe(result);
  worldFinder.choose("board", "synth", result);
  expect(worldFinder.get()!.chosen!.seq).toBeGreaterThan(first.seq);
  worldFinder.closed();
  expect(worldFinder.get()?.chosen).not.toBeNull();
  // Typing anew forgets the choice.
  worldFinder.type("board", "synthetic");
  expect(worldFinder.get()!.chosen).toBeNull();
});

test("a view ends only its own search", () => {
  worldFinder.type("town", "synth");
  worldFinder.end("board");
  expect(worldFinder.get()?.view).toBe("town");
  worldFinder.end("town");
  expect(worldFinder.get()).toBeNull();
});
