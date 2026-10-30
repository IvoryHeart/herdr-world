import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouWindow } from "./NeedsYouWindow";
import { needsYouCount, needsYouItems } from "./needsYou";
import type { WorldAsk, WorldAsksStore } from "./worldAsks";
import type { WorldLeafObject } from "./worldObject";

// Chat's Markdown sanitizes in a DOM, which a test process lacks.
const DOM_GLOBALS = ["DOMParser", "NodeFilter", "Node", "document", "Element"];
const missing = DOM_GLOBALS.filter((name) => !(name in globalThis));
beforeAll(() => {
  const browser = new Window() as unknown as Record<string, unknown>;
  for (const name of missing)
    Object.assign(globalThis, { [name]: browser[name] });
});
afterAll(() => {
  for (const name of missing) Reflect.deleteProperty(globalThis, name);
});

const leaf = (
  id: string,
  status: WorldLeafObject["status"],
  at: number,
  extra: Partial<WorldLeafObject> = {},
) =>
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
    tabLabel: `${id} tab`,
    status,
    stale: false,
    actionable: true,
    lastActivityAt: at,
    terminalId: `terminal-${id}`,
    pane: { pane_id: `w1:${id}` },
    stateLabels: {},
    ...extra,
  }) as unknown as WorldLeafObject;

const ask = (id: string, at: number, verified: boolean): WorldAsk => ({
  id,
  at,
  actor: {
    label: "claude in w1:asker",
    verified,
    connection_id: "local",
    pane_id: "w1:asker",
  },
  question: "Ship **the fix** now?",
  options: ["Ship", "Wait"],
  owner_only: true,
});

const leaves = [
  leaf("idle", "idle", 1),
  leaf("late-blocked", "blocked", 30),
  leaf("early-blocked", "blocked", 10),
  leaf("old-done", "done", 5),
  leaf("new-done", "done", 50),
  leaf("reviewed", "done", 60),
  leaf("idle-finished", "idle", 40),
  leaf("gone", "blocked", 2, { stale: true, actionable: false }),
  leaf("shell", "blocked", 3, { kind: "terminal" }),
];
const world = {
  leaves,
  nodeById: new Map(leaves.map((entry) => [entry.id, entry])),
};

test("Needs you lists asks, then blocked agents, then work to review", () => {
  // The caller decides what awaits review (useReviewedWork): here done
  // agents and one idle agent whose turn just ended, minus a reviewed one.
  const items = needsYouItems(
    world,
    [ask("later", 20, true), ask("earlier", 10, false)],
    (entry) =>
      (entry.status === "done" || entry.id === "idle-finished") &&
      entry.id !== "reviewed",
  );
  expect(items.map((item) => item.key)).toEqual([
    "ask:earlier",
    "ask:later",
    "leaf:early-blocked",
    "leaf:late-blocked",
    "leaf:new-done",
    "leaf:idle-finished",
    "leaf:old-done",
  ]);
  // The counter counts what blocks someone, not work to review.
  expect(needsYouCount(items)).toBe(4);
});

test("each item names its agent, marks unverified asks and answers in place", () => {
  const asks = [ask("q-1", 0, false)];
  const asksStore = {
    get: () => asks,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  } as unknown as WorldAsksStore;
  const deskStore = new WorldDeskStore({
    call: async () => null,
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  const html = renderToStaticMarkup(
    createElement(NeedsYouWindow, {
      world,
      now: 60_000,
      onOpenAgent: () => {},
      onOpenTerminal: () => {},
      asksStore,
      deskStore,
    }),
  );
  expect(html).toContain("3 waiting on you");
  // The ask: Markdown, options, a typed answer and Dismiss, its asker
  // named from the ledger and marked unverified.
  expect(html).toContain("<strong>the fix</strong>");
  expect(html).toContain(">Ship</button>");
  // An unverified asker World could not place is named by the pane it claimed.
  expect(html).toContain('aria-label="Your answer to w1:asker (unverified)"');
  expect(html).toContain(">unverified</span>");
  expect(html.match(/>Dismiss</g)).toHaveLength(1);
  // Blocked and finished agents: their Herdr names, Open agent, and Mark
  // reviewed only on finished work.
  expect(html).toContain("<b>early-blocked</b>");
  expect(html).toContain('aria-label="Open new-done"');
  expect(html.match(/>Open agent</g)).toHaveLength(5);
  expect(html.match(/>Mark reviewed</g)).toHaveLength(3);
  expect(html).toContain('data-mark="asks"');
  expect(html).toContain('data-mark="needs"');
  expect(html).toContain('data-mark="done"');
});

test("an opener's item past the limit opens at its page, and the others stay a page away", () => {
  const blocked = Array.from({ length: 32 }, (_, index) =>
    leaf(`b${index + 1}`, "blocked", index + 1),
  );
  const crowd = {
    leaves: blocked,
    nodeById: new Map(blocked.map((entry) => [entry.id, entry])),
  };
  const html = renderToStaticMarkup(
    createElement(NeedsYouWindow, {
      world: crowd,
      focusKey: "leaf:b32",
      now: 60_000,
      onOpenAgent: () => {},
      onOpenTerminal: () => {},
      asksStore: {
        get: () => [],
        subscribe: () => () => {},
        start: () => {},
        stop: () => {},
      } as unknown as WorldAsksStore,
      deskStore: new WorldDeskStore({
        call: async () => null,
        onControl: () => () => {},
        onStatus: () => () => {},
      }),
    }),
  );
  expect(html).toContain("32 waiting on you");
  // The page holding the one asked for; the first 30 are a page before.
  expect(html).not.toContain('data-needs-you-item="leaf:b30"');
  expect(html).toContain('data-needs-you-item="leaf:b31"');
  expect(html).toContain('data-needs-you-item="leaf:b32"');
  expect(html).toContain("needs-you-item is-needs is-focused");
  expect(html).toContain("Show the 30 before</button>");
  expect(html).not.toContain("more of");
});
