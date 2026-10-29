import { expect, test } from "bun:test";
import { askingKeysForWorld, askMatchesLeaf } from "./worldAskTargets";
import type { WorldAsk } from "./worldAsks";
import type { WorldLeafObject } from "./worldObject";

const ask: WorldAsk = {
  id: "q-example",
  at: 1,
  question: "Ship?",
  options: [],
  owner_only: true,
  actor: {
    verified: true,
    label: "Example",
    connection_id: "alpha",
    connection_generation: 2,
    pane_id: "w1:p1",
    terminal_id: "terminal-a",
    agent_session_fingerprint: "a".repeat(64),
  },
};
const leaf = {
  id: "alpha-agent",
  connectionId: "alpha",
  generation: 2,
  terminalId: "terminal-a",
  pane: { pane_id: "w1:p1" },
  actionable: true,
  stale: false,
  agentSessionFingerprint: "a".repeat(64),
} as WorldLeafObject;

test("an ask marks only its original current pane, runtime and session", () => {
  expect(askMatchesLeaf(ask, leaf)).toBe(true);
  for (const change of [
    { connectionId: "beta" },
    { generation: 3 },
    { terminalId: "replacement" },
    { agentSessionFingerprint: "b".repeat(64) },
    { stale: true },
    { actionable: false },
  ])
    expect(askMatchesLeaf(ask, { ...leaf, ...change })).toBe(false);
  for (const closed of [
    { withdrawn: { at: 2 } },
    { dismissed: { at: 2, by: "owner" } },
    { answer: { text: "Yes", at: 2, by: "owner" } },
  ])
    expect(askMatchesLeaf({ ...ask, ...closed }, leaf)).toBe(false);
});

test("an unverified ask reaches reception only at the pane it was placed on", () => {
  // The service placed the claim: one local Herdr had that pane's terminal.
  const placed: WorldAsk = {
    ...ask,
    actor: { ...ask.actor, verified: false, label: "unverified w1:p1" },
  };
  expect(askMatchesLeaf(placed, leaf)).toBe(true);
  expect([...askingKeysForWorld([placed], { leaves: [leaf] })]).toEqual([
    "alpha-agent",
  ]);
  expect(askMatchesLeaf(placed, { ...leaf, terminalId: "later" })).toBe(false);
  // A bare claim names a pane ID only: it never picks a connection.
  const bare: WorldAsk = {
    ...ask,
    actor: { label: "unverified w1:p1", verified: false, pane_id: "w1:p1" },
  };
  expect(askMatchesLeaf(bare, leaf)).toBe(false);
  expect(askingKeysForWorld([bare], { leaves: [leaf] }).size).toBe(0);
});
