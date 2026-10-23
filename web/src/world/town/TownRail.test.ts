import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  townRailInset,
  nextTownCall,
  TownRail,
  type TownCall,
} from "./TownRail";

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

test("questions from agents open the rail, with their options", () => {
  const html = renderToStaticMarkup(
    createElement(TownRail, {
      needsYouCount: 1,
      asks: [
        {
          id: "q-1",
          at: 0,
          actor: { label: "claude in w1:p2", verified: true },
          question: "Ship the fix now?",
          options: ["yes", "no"],
          owner_only: true,
        },
      ],
      calls: [],
      activeKey: null,
      now: 60_000,
      onPeek: () => {},
      onOpen: () => {},
      collapsed: false,
      onCollapsedChange: () => {},
    }),
  );
  expect(html).toContain("NEEDS YOU <b>1</b>");
  expect(html).toContain("Ship the fix now?");
  expect(html).toContain("claude in w1:p2");
  expect(html).toContain("asks: Ship the fix now?");
  expect(html).toContain("1m</small>");
  expect(html).toContain(">yes</button>");
  expect(html).not.toContain("Nobody is waiting on you.");
});

test("camera reserves the rail for open questions and respects tray/collapse boundaries", () => {
  expect(townRailInset(960, false, 1)).toBe(252);
  expect(townRailInset(960, false, 0)).toBe(0);
  expect(townRailInset(960, true, 1)).toBe(0);
  expect(townRailInset(640, false, 1)).toBe(0);
  expect(townRailInset(641, false, 1)).toBe(252);
});
