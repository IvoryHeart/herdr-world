import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FocusState } from "../../../../shared/focus";
import { dismissFocusRecap, resetFocusForTests } from "../focus";
import { sharedPresence } from "../presence";
import type { WorldLeafObject } from "../worldObject";
import {
  TownFocusMark,
  TownFocusRecap,
  TownFocusSection,
  TownRecapChip,
} from "./TownFocus";

// The recap's ✕ and the presence it shares a line with live in localStorage.
const GLOBALS = ["DOMParser", "document", "localStorage"];
const missing = GLOBALS.filter((name) => !(name in globalThis));
beforeAll(() => {
  const browser = new Window() as unknown as Record<string, unknown>;
  for (const name of missing)
    Object.assign(globalThis, { [name]: browser[name] });
});
afterEach(() => {
  resetFocusForTests();
  globalThis.localStorage?.clear();
  sharedPresence().reload();
});
afterAll(() => {
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
  leaf("stuck", "blocked", now - 20 * MIN),
  leaf("built", "done", now - 10 * MIN),
  // Finished before the session started: not in its recap.
  leaf("earlier", "done", now - 120 * MIN),
];
const world = {
  leaves,
  nodeById: new Map(leaves.map((entry) => [entry.id, entry])),
};
const ended: FocusState = {
  revision: 2,
  now,
  session: null,
  last: {
    id: "focus-a",
    started_at: now - 45 * MIN,
    ends_at: now - MIN,
    ended_at: now - MIN,
    reason: "expired",
  },
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html");

test("a session that ended shows While you focused with what arrived in it", () => {
  resetFocusForTests(ended);
  const sign = render(
    createElement(TownFocusRecap, { world, variant: "board" }),
  );
  expect(sign.querySelector("header span")?.textContent).toBe(
    "While you focused · 44 m",
  );
  expect(
    [...sign.querySelectorAll("li button")].map((line) => line.textContent),
  ).toEqual(["1 new for you ›", "1 finished ›"]);
  const chip = render(createElement(TownRecapChip, { world }));
  expect(chip.querySelector("button")?.textContent).toContain(
    "While you focused · 44 m: 1 for you, 1 finished",
  );
  // ✕ clears it on this device.
  dismissFocusRecap("focus-a");
  expect(
    renderToStaticMarkup(
      createElement(TownFocusRecap, { world, variant: "board" }),
    ),
  ).toBe("");
});

test("an empty session still says so; the chip line falls back to Since you left", () => {
  resetFocusForTests({
    ...ended,
    last: {
      ...ended.last!,
      started_at: now - 3 * MIN,
      ended_at: now - 2 * MIN,
    },
  });
  const sign = render(
    createElement(TownFocusRecap, { world, variant: "board" }),
  );
  expect(sign.querySelector("li")?.textContent).toBe("Nothing new arrived");
  dismissFocusRecap("focus-a");
  sharedPresence().begin({ since: now - 180 * MIN, at: now });
  const chip = renderToStaticMarkup(createElement(TownRecapChip, { world }));
  expect(chip).toContain("Since ");
  expect(chip).not.toContain("While you focused");
});

test("while focused the chip shows headphones and time left, the board End now", () => {
  expect(renderToStaticMarkup(createElement(TownFocusMark))).toBe("");
  resetFocusForTests({
    revision: 1,
    now,
    session: { id: "focus-b", started_at: now, ends_at: now + 25 * MIN },
    last: null,
  });
  const mark = render(createElement(TownFocusMark));
  expect(mark.querySelector(".town-focus-mark")?.textContent).toBe("25 m");
  const board = render(createElement(TownFocusSection));
  expect(board.querySelector(".focus-controls-status")?.textContent).toBe(
    "Focused · 25 m left",
  );
  expect(board.querySelector(".focus-end")?.textContent).toBe("End now");
  expect(board.querySelector(".focus-choice")).toBeNull();
  // No recap while a session runs.
  expect(
    renderToStaticMarkup(
      createElement(TownFocusRecap, { world, variant: "board" }),
    ),
  ).toBe("");
});

test("without a session the board offers the lengths", () => {
  const board = render(createElement(TownFocusSection));
  expect(
    [...board.querySelectorAll(".focus-choice")].map((b) => b.textContent),
  ).toEqual(["25 m", "45 m", "90 m", "Until I stop"]);
});
