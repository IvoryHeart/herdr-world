import { expect, test } from "bun:test";
import {
  agentOffers,
  conversationStates,
  deriveAgentState,
  resolveAgentObservation,
  type AgentConnectionView,
  type AgentObservation,
  type AgentOccupant,
  type AgentRecord,
} from "./agent-resolver";

const occupant = (
  terminal_id: string,
  conversation: string | null = null,
  harness = "claude",
): AgentOccupant => ({
  terminal_id,
  harness,
  folder: "/work/synthetic",
  conversation,
  source: conversation ? "herdr:claude" : null,
});
const listing = (
  terminals: string[],
  occupants: AgentOccupant[],
  connection_id = "studio",
): AgentObservation => ({
  connection_id,
  generation: 1,
  terminals,
  occupants,
});
const agent = (
  id: string,
  terminal: string | null,
  conversation: string | null = null,
  extra: Partial<AgentRecord> = {},
): AgentRecord => ({
  id,
  created_at: 1,
  ended_at: null,
  harness: "claude",
  folder: "/work/synthetic",
  conversation,
  seat: terminal
    ? { binding_id: `b-${id}`, connection_id: "studio", terminal_id: terminal }
    : null,
  ...extra,
});

test("a newcomer in an unheld terminal is a new agent", () => {
  expect(
    resolveAgentObservation([], listing(["t1"], [occupant("t1", "claude/c1")])),
  ).toEqual([
    {
      type: "create",
      terminal_id: "t1",
      harness: "claude",
      folder: "/work/synthetic",
      conversation: "claude/c1",
    },
  ]);
});

test("a held agent keeps its seat and takes a new conversation in place", () => {
  const held = agent("a-1", "t1", "claude/c1");
  expect(
    resolveAgentObservation(
      [held],
      listing(["t1"], [occupant("t1", "claude/c1")]),
    ),
  ).toEqual([]);
  expect(
    resolveAgentObservation(
      [held],
      listing(["t1"], [occupant("t1", "claude/c2")]),
    ),
  ).toEqual([
    { type: "conversation", agent: "a-1", conversation: "claude/c2" },
  ]);
});

test("a closed terminal leaves an agent away with its conversation, else ends it", () => {
  expect(
    resolveAgentObservation(
      [agent("a-1", "t1", "claude/c1"), agent("a-2", "t2")],
      listing([], []),
    ),
  ).toEqual([
    { type: "leave", agent: "a-1" },
    { type: "end", agent: "a-2" },
  ]);
});

test("another harness in a held seat is a new agent; the old one leaves", () => {
  expect(
    resolveAgentObservation(
      [agent("a-1", "t1", "claude/c1")],
      listing(["t1"], [occupant("t1", null, "codex")]),
    ),
  ).toEqual([
    { type: "leave", agent: "a-1" },
    {
      type: "create",
      terminal_id: "t1",
      harness: "codex",
      folder: "/work/synthetic",
      conversation: null,
    },
  ]);
});

test("a duplicate or inconsistent listing changes nothing", () => {
  const held = [agent("a-1", "t1", "claude/c1")];
  expect(
    resolveAgentObservation(held, listing(["t1", "t1"], [occupant("t1")])),
  ).toEqual([]);
  expect(
    resolveAgentObservation(
      held,
      listing(["t1", "t2"], [occupant("t2"), occupant("t2")]),
    ),
  ).toEqual([]);
  expect(resolveAgentObservation(held, listing([], [occupant("t9")]))).toEqual(
    [],
  );
});

test("another connection's listing never touches an agent", () => {
  expect(
    resolveAgentObservation(
      [agent("a-1", "t1", "claude/c1")],
      listing([], [], "other"),
    ),
  ).toEqual([]);
});

test("an away agent's conversation in a hand-started terminal is offered, never merged", () => {
  const away = agent("a-1", null, "claude/c1");
  const changes = resolveAgentObservation(
    [away],
    listing(["t2"], [occupant("t2", "claude/c1")]),
  );
  expect(changes).toEqual([
    {
      type: "create",
      terminal_id: "t2",
      harness: "claude",
      folder: "/work/synthetic",
      conversation: "claude/c1",
    },
  ]);
  const newcomer = agent("a-2", "t2", "claude/c1");
  const states = new Map([
    ["a-1", "away" as const],
    ["a-2", "live" as const],
  ]);
  expect(agentOffers([away, newcomer], states)).toEqual(
    new Map([["a-2", "a-1"]]),
  );
  // Two away agents ran it: no offer.
  const other = agent("a-3", null, "claude/c1");
  expect(
    agentOffers(
      [away, other, newcomer],
      new Map([...states, ["a-3", "away" as const]]),
    ).size,
  ).toBe(0);
});

test("one conversation claimed by two live agents is a conflict for both", () => {
  const agents = [
    agent("a-1", "t1", "claude/c1"),
    agent("a-2", "t2", "claude/c1"),
    agent("a-3", "t3"),
  ];
  const states = new Map(agents.map((each) => [each.id, "live" as const]));
  expect(conversationStates(agents, states)).toEqual(
    new Map([
      ["a-1", "conflict"],
      ["a-2", "conflict"],
      ["a-3", "unknown"],
    ]),
  );
});

test("states derive from the record and the current listing", () => {
  const view = (current: boolean, occupants: [string, string | null][]) =>
    new Map<string, AgentConnectionView>([
      ["studio", { current, occupants: new Map(occupants) }],
    ]);
  const held = agent("a-1", "t1", "claude/c1");
  expect(deriveAgentState(held, view(true, [["t1", "claude"]]))).toBe("live");
  expect(deriveAgentState(held, view(false, [["t1", "claude"]]))).toBe(
    "unresolved",
  );
  expect(deriveAgentState(held, new Map())).toBe("unresolved");
  expect(deriveAgentState(held, view(true, [["t1", "codex"]]))).toBe(
    "unresolved",
  );
  expect(deriveAgentState(agent("a-2", null, "claude/c1"), new Map())).toBe(
    "away",
  );
  expect(
    deriveAgentState(agent("a-3", null, null, { ended_at: 5 }), new Map()),
  ).toBe("ended");
});
