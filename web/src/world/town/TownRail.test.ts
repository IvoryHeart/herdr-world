import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  nextTownCall,
  TownAsk,
  type TownAskActions,
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

const actions = (askers: TownAskActions["askers"] = new Map()) => ({
  askers,
  answer: async () => null,
  dismiss: async () => null,
  open: () => {},
});

test("a question shows its options and its age", () => {
  const html = renderToStaticMarkup(
    createElement(TownAsk, {
      ask: {
        id: "q-1",
        at: 0,
        actor: { label: "claude in w1:p2", verified: true },
        question: "Ship the fix now?",
        options: ["yes", "no"],
        owner_only: true,
      },
      now: 60_000,
      actions: actions(),
    }),
  );
  expect(html).toContain("claude in w1:p2");
  expect(html).toContain("asks: Ship the fix now?");
  expect(html).toContain("1m</small>");
  expect(html).toContain(">yes</button>");
});

test("a question names its asker once, marks it unverified, and offers Open agent and Dismiss", () => {
  const question = (id: string, label: string, verified: boolean) => ({
    id,
    at: 0,
    actor: { label, verified, pane_id: "w1:p6" },
    question: "Which brief next?",
    options: [],
    owner_only: true,
  });
  // Only the placed one has a Town agent, named as its desk is.
  const askers = new Map([
    ["q-placed", { name: "dispatch", key: "agent-dispatch", terminal: false }],
  ]);
  const html = ["q-placed", "q-bare"]
    .map((id) =>
      renderToStaticMarkup(
        createElement(TownAsk, {
          ask: question(id, "unverified w1:p6", false),
          now: 60_000,
          actions: actions(askers),
        }),
      ),
    )
    .join("");
  expect(html).toContain(
    "<b>dispatch</b> (unverified) asks: Which brief next?",
  );
  expect(html).toContain("<b>w1:p6</b> (unverified) asks: Which brief next?");
  expect(html).not.toContain("unverified w1:p6");
  expect(html.match(/>Open agent</g)).toHaveLength(1);
  expect(html).toContain('aria-label="Open dispatch"');
  expect(html.match(/>Dismiss</g)).toHaveLength(2);
});
