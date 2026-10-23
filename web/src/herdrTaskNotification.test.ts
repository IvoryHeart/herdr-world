import { expect, test } from "bun:test";
import { parseHerdrTaskNotification } from "./herdrTaskNotification";

test.each([undefined, null, { known: false }, { known: true, agent: "" }])(
  "missing or invalid sender metadata stays unknown: %j",
  (sender) => {
    const parsed = parseHerdrTaskNotification({
      kind: "message",
      title: "Review ready",
      agent: "FirstMate",
      pane_id: "p1",
      sender,
    });
    expect(parsed?.sender).toEqual({ known: false });
    expect(parsed?.agentKnown).toBe(false);
  },
);

test("an explicit sender passes through independently of legacy fallback text", () => {
  const sender = { known: true, agent: "reviewer" };
  const parsed = parseHerdrTaskNotification({
    kind: "message",
    title: "Review ready",
    agent: "Agent",
    sender,
  });
  expect(parsed?.sender).toEqual(sender);
  expect(parsed?.agent).toBe("reviewer");
  expect(parsed?.agentKnown).toBe(true);
});
