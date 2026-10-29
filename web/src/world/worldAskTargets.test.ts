import { expect, test } from "bun:test";
import { askMatchesLeaf } from "./worldAskTargets";
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

test("an ask marks only its verified current pane, runtime and session", () => {
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
  expect(
    askMatchesLeaf({ ...ask, actor: { ...ask.actor, verified: false } }, leaf),
  ).toBe(false);
  expect(askMatchesLeaf({ ...ask, withdrawn: { at: 2 } }, leaf)).toBe(false);
});
