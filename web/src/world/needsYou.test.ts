import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouList, needsYouPage } from "./NeedsYouTab";
import { needsYouCount, needsYouInTopbar, needsYouItems } from "./needsYou";
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
    createElement(NeedsYouList, {
      world,
      request: { sequence: 0 },
      now: 60_000,
      onChat: () => {},
      onOpenTerminal: () => {},
      asksStore,
      deskStore,
    }),
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector(".needs-you-count")?.textContent).toContain(
    "3 waiting on you",
  );
  expect(document.querySelector("strong")?.textContent).toBe("the fix");
  // Its options are the replies; "Other…" opens the typed answer.
  const replies = document.querySelector(
    '[role="group"][aria-label="Answers to w1:asker (unverified)"]',
  );
  expect(
    [...(replies?.querySelectorAll("button") ?? [])].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Ship", "Wait", "Other…"]);
  expect(document.querySelector(".needs-you-field")).toBeNull();
  const names = [...document.querySelectorAll(".needs-you-name")];
  expect(names).toHaveLength(6);
  expect(
    names.find((name) => name.textContent === "w1:asker")?.closest("button"),
  ).toBeNull();
  expect(
    document.querySelector('button[aria-label="Open early-blocked\'s window"]'),
  ).not.toBeNull();
  const buttons = [...document.querySelectorAll("button")];
  const titled = (title: string) =>
    buttons.filter((button) => button.getAttribute("title") === title);
  expect(buttons.map((button) => button.textContent)).toContain("Ship");
  // ✕ keeps each kind's own action: Dismiss on a question, Mark reviewed on
  // finished work, none on a blocked agent.
  expect(titled("Dismiss question")).toHaveLength(1);
  expect(titled("Open in Chat")).toHaveLength(2);
  expect(titled("Follow up in Chat")).toHaveLength(3);
  expect(
    buttons.filter((button) =>
      button.getAttribute("title")?.startsWith("Mark reviewed"),
    ),
  ).toHaveLength(3);
  expect(titled("Dismiss question")[0]?.getAttribute("aria-label")).toBe(
    "Dismiss w1:asker (unverified)'s question without answering",
  );
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
    createElement(NeedsYouList, {
      world: crowd,
      request: { itemKey: "leaf:b32", sequence: 1 },
      now: 60_000,
      onChat: () => {},
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

test("every opener request finds its item's page, and a turned page stays put", () => {
  const items = Array.from({ length: 70 }, (_, index) => ({
    kind: "needs" as const,
    key: `leaf:b${index + 1}`,
    leaf: leaf(`b${index + 1}`, "blocked", index + 1),
  }));
  const target = "leaf:b45";
  // An opener's request follows its item to the second page.
  expect(needsYouPage(items, target, { start: 0, follow: true })).toEqual({
    start: 30,
    focused: target,
  });
  // Turning back a page stops following until the next request.
  expect(needsYouPage(items, target, { start: 0, follow: false }).start).toBe(
    0,
  );
  // A page past the end clamps to the last one.
  expect(needsYouPage(items, undefined, { start: 90, follow: false })).toEqual({
    start: 60,
    focused: undefined,
  });
});

test("the counter is one tap away on every root screen, never twice", () => {
  const place = (mobile: boolean, zen: boolean, detail = false) =>
    needsYouInTopbar({ view: "town", mobile, zen, detail });
  // Zen: the floating view picker carries it on every device.
  expect(place(false, true)).toBe(false);
  expect(place(true, true)).toBe(false);
  // Outside Zen the top bar does, a phone's included (after Exit Zen).
  expect(place(false, false)).toBe(true);
  expect(place(true, false)).toBe(true);
  // A phone's agent window bar is a detail screen's; Spaces has none.
  expect(place(true, false, true)).toBe(false);
  expect(
    needsYouInTopbar({
      view: "spaces",
      mobile: false,
      zen: false,
      detail: false,
    }),
  ).toBe(false);
});
