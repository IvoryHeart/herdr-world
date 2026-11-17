import { expect, test } from "bun:test";
import { needsYouItems } from "./needsYou";
import { townAskers } from "./town/townAskers";
import {
  askingKeysForWorld,
  askLeaves,
  askMatchesLeaf,
  asksForWorld,
} from "./worldAskTargets";
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

test("a herdr-core agent's verified ask marks it while the same program runs", () => {
  const program = "c".repeat(64);
  const coreAsk: WorldAsk = {
    ...ask,
    actor: {
      verified: true,
      label: "claude in t3",
      connection_id: "box",
      connection_generation: 4,
      pane_id: "t3",
      terminal_id: "t3",
      agent_session_fingerprint: program,
    },
  };
  // World only watches a core agent: it is not actionable, yet live.
  const coreLeaf = {
    id: "box-agent",
    connectionId: "box",
    generation: 4,
    terminalId: "t3",
    pane: { pane_id: "t3", core_occupant_fingerprint: program },
    actionable: false,
    viewOnly: "World can't open herdr-core terminals or chat with them yet",
    coreControl: true,
    stale: false,
  } as unknown as WorldLeafObject;
  expect(askMatchesLeaf(coreAsk, coreLeaf)).toBe(true);
  expect([...askingKeysForWorld([coreAsk], { leaves: [coreLeaf] })]).toEqual([
    "box-agent",
  ]);
  // A replaced program (a shell left at the address) never inherits it.
  expect(
    askMatchesLeaf(coreAsk, {
      ...coreLeaf,
      pane: { ...coreLeaf.pane, core_occupant_fingerprint: "d".repeat(64) },
    }),
  ).toBe(false);
  // No occupant print on the row, or none on the ask: no match.
  expect(
    askMatchesLeaf(coreAsk, { ...coreLeaf, pane: { pane_id: "t3" } as never }),
  ).toBe(false);
  expect(
    askMatchesLeaf(
      {
        ...coreAsk,
        actor: { ...coreAsk.actor, agent_session_fingerprint: undefined },
      },
      coreLeaf,
    ),
  ).toBe(false);
  for (const change of [
    { stale: true },
    { generation: 5 },
    { connectionId: "other-core" },
    { coreControl: undefined },
  ])
    expect(askMatchesLeaf(coreAsk, { ...coreLeaf, ...change })).toBe(false);
  // A Herdr (TUI) pane of the same ID on another connection never matches.
  expect(
    askMatchesLeaf(coreAsk, { ...leaf, pane: { pane_id: "t3" } } as never),
  ).toBe(false);
});

test("Needs you, Town reception and Board place a core agent's ask on it", () => {
  const program = "e".repeat(64);
  const coreAsk: WorldAsk = {
    ...ask,
    id: "q-core",
    actor: {
      verified: true,
      label: "claude in t3",
      connection_id: "box",
      connection_generation: 4,
      pane_id: "t3",
      terminal_id: "t3",
      agent_session_fingerprint: program,
    },
  };
  const coreLeaf = {
    id: "box-agent",
    kind: "agent",
    connectionId: "box",
    generation: 4,
    terminalId: "t3",
    status: "blocked",
    pane: { pane_id: "t3", core_occupant_fingerprint: program },
    actionable: false,
    viewOnly: "World can't open herdr-core terminals or chat with them yet",
    coreControl: true,
    stale: false,
  } as unknown as WorldLeafObject;
  const world = {
    leaves: [coreLeaf],
    nodeById: new Map([[coreLeaf.id, coreLeaf]]),
  } as never;
  expect(askLeaves([coreAsk], world).get("q-core")).toBe("box-agent");
  // Board and Desk draw the ? on the leaf this map names.
  expect(asksForWorld([coreAsk], world).get("box-agent")?.id).toBe("q-core");
  // Needs you: the ask item opens the core agent.
  const item = needsYouItems(world, [coreAsk], () => false).find(
    (entry) => entry.kind === "asks",
  );
  expect(item?.kind === "asks" ? item.leaf?.id : null).toBe("box-agent");
  // Town reception names the agent as its desk does.
  const asker = townAskers([coreAsk], world, {
    roster: [{ agent: { key: "box-agent", displayLabel: "builder" } }],
    paneRoster: [],
  } as never).get("q-core");
  expect(asker).toEqual({ name: "builder", key: "box-agent", terminal: false });
});
