import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorldDeskStore } from "../deskStateStore";
import { NeedsYouList } from "../NeedsYouTab";
import { sharedPresence } from "../presence";
import type { WorldAsksStore } from "../worldAsks";
import type { WorldLeafObject } from "../worldObject";
import { TownSinceYouLeft } from "./TownSinceYouLeft";

// Markdown sanitizes in a DOM; presence keeps its state in localStorage.
const GLOBALS = [
  "DOMParser",
  "NodeFilter",
  "Node",
  "document",
  "Element",
  "localStorage",
];
const missing = GLOBALS.filter((name) => !(name in globalThis));
beforeAll(() => {
  const browser = new Window() as unknown as Record<string, unknown>;
  for (const name of missing)
    Object.assign(globalThis, { [name]: browser[name] });
});
afterAll(() => {
  // Later test files see no return.
  globalThis.localStorage?.clear();
  sharedPresence().reload();
  for (const name of missing) Reflect.deleteProperty(globalThis, name);
});

const MIN = 60_000;
const now = Date.now();
const leaf = (id: string, status: WorldLeafObject["status"], at: number) =>
  ({
    id,
    kind: "agent",
    nativeId: `w1:${id}`,
    connectionId: "local",
    generation: 1,
    label: `${id}-claude`,
    agentName: id,
    hostLabel: "Example host",
    spaceLabel: "example",
    status,
    stale: false,
    actionable: true,
    lastActivityAt: at,
    terminalId: `terminal-${id}`,
    pane: { pane_id: `w1:${id}` },
    stateLabels: {},
  }) as unknown as WorldLeafObject;
const leaves = [
  leaf("stuck", "blocked", now - 60 * MIN),
  leaf("built", "done", now - 30 * MIN),
  leaf("earlier", "done", now - 300 * MIN),
];
const world = {
  leaves,
  nodeById: new Map(leaves.map((entry) => [entry.id, entry])),
};
const noAsks = {
  get: () => [],
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
} as unknown as WorldAsksStore;
const list = () =>
  renderToStaticMarkup(
    createElement(NeedsYouList, {
      world,
      request: { sequence: 0 },
      now,
      onChat: () => {},
      onOpenTerminal: () => {},
      asksStore: noAsks,
      deskStore: new WorldDeskStore({
        call: async () => null,
        onControl: () => () => {},
        onStatus: () => () => {},
      }),
    }),
  );
const board = (variant: "board" | "chip") =>
  renderToStaticMarkup(createElement(TownSinceYouLeft, { world, variant }));

test("a return shows Since you left on the sign, the phone chip and as new dots", () => {
  expect(board("board")).toBe("");
  expect(list()).not.toContain("needs-you-new");
  const presence = sharedPresence();
  presence.begin({ since: now - 180 * MIN, at: now });
  const sign = new DOMParser().parseFromString(board("board"), "text/html");
  expect(sign.querySelector("header span")?.textContent).toContain(
    "· away 3 h",
  );
  expect(
    [...sign.querySelectorAll("li button")].map((line) => line.textContent),
  ).toEqual(["1 new for you ›", "1 finished ›"]);
  expect(board("chip")).toContain(": 1 for you, 1 finished");
  // Only what arrived while away carries a dot, until it is opened.
  const before = new DOMParser().parseFromString(list(), "text/html");
  expect(
    [...before.querySelectorAll(".needs-you-item")]
      .filter((item) => item.querySelector(".needs-you-new"))
      .map((item) => item.getAttribute("data-needs-you-item")),
  ).toEqual(["leaf:stuck", "leaf:built"]);
  presence.opened("leaf:stuck");
  expect(list().match(/needs-you-new/g)).toHaveLength(1);
  // ✕ clears the recap's lines only; Needs you keeps its items.
  presence.dismiss();
  expect(board("board")).toBe("");
  expect(board("chip")).toBe("");
  expect(list()).toContain('data-needs-you-item="leaf:stuck"');
});
