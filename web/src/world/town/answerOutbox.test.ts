import { expect, test } from "bun:test";
import { answerRecipientView } from "./answerOutbox";
import type { WorldAsk } from "../worldAsks";
import type { WorldObject } from "../worldObject";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
const ask: WorldAsk = {
  id: "q-fixture",
  at: 1,
  actor: {
    label: "Original asker",
    verified: true,
    connection_id: "studio",
    pane_id: "p1",
    terminal_id: "term-original",
  },
  question: "Proceed?",
  owner_only: true,
  options: [],
  answer: { text: "Proceed", at: 2, by: "owner" },
};
const leaf = {
  id: "leaf-current",
  stale: false,
  actionable: true,
  connectionId: "studio",
  terminalId: "term-original",
  pane: { pane_id: "p1" },
};
const office = {
  roster: [
    {
      agent: {
        key: "agent-current",
        nodeId: "leaf-current",
        displayLabel: "Current agent",
      },
      roomLabel: "Lantern",
      hostLabel: "Studio",
    },
  ],
  paneRoster: [],
} as unknown as HerdrOfficeProjection;
test("Open agent is an explicit route to a fresh original terminal, without changing the stored send recipient", () => {
  const view = answerRecipientView(
    ask,
    { leaves: [leaf] } as unknown as WorldObject,
    office,
  );
  expect(view).toMatchObject({
    name: "Original asker",
    location: "Lantern · Studio",
    target: { key: "agent-current", terminal: false },
  });
  for (const retired of [
    { ...leaf, connectionId: "other" },
    { ...leaf, terminalId: "replacement" },
    { ...leaf, stale: true },
    { ...leaf, actionable: false },
  ])
    expect(
      answerRecipientView(
        ask,
        { leaves: [retired] } as unknown as WorldObject,
        office,
      ).target,
    ).toBeNull();
});
