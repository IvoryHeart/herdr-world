import { expect, test } from "bun:test";
import { DESK_IDLE_WINDOW_MS } from "../../../shared/deskState";
import { WorldDeskRegistry } from "./desk-state";

const identity = {
  connection_id: "alpha",
  connection_generation: 1,
  terminal_id: "terminal-a",
  agent_session_fingerprint: "a".repeat(64),
};

test("shares latest marks with exact Undo and distinct host/session owners", () => {
  const desk = new WorldDeskRegistry();
  desk.mark(identity, "turn-1", true, 1);
  desk.mark(identity, "turn-2", true, 2);
  desk.mark(identity, "turn-1", false, 3);
  expect(desk.list().records[0]!.reviewed_stop).toBe("turn-2");
  desk.mark({ ...identity, connection_id: "beta" }, "turn-2", true, 4);
  expect(desk.list().records).toHaveLength(2);
  desk.mark(identity, "turn-2", false, 5);
  expect(
    desk.list().records.find((entry) => entry.connection_id === "alpha"),
  ).toBeUndefined();
  desk.retireConnectionGeneration("beta", 2);
  expect(desk.list().records).toEqual([]);
});

test("service-observed stops have one timestamp, ignore obsolete reads and expire", () => {
  const desk = new WorldDeskRegistry();
  desk.observeAgent(identity, "working", 1);
  desk.observeAgent(identity, "idle", 2);
  desk.observeAgent(identity, "working", 1);
  desk.observeAgent(identity, "idle", 3);
  expect(desk.list().records[0]!.stopped_at).toBe(2);
  desk.expire(DESK_IDLE_WINDOW_MS + 3);
  expect(desk.list().records).toEqual([]);
});

test("replacement sessions clear marks, opens and observed stops", () => {
  const desk = new WorldDeskRegistry();
  desk.observeAgent(identity, "working", 1);
  desk.observeAgent(identity, "done", 2);
  desk.mark(identity, "turn-1", true, 3);
  desk.open(identity, 4);
  desk.observeAgent(
    { ...identity, agent_session_fingerprint: "b".repeat(64) },
    "idle",
    5,
  );
  expect(desk.list().records).toEqual([]);
});

test("records and recent opens are bounded and an identical mark is idempotent", () => {
  const desk = new WorldDeskRegistry();
  for (let n = 0; n < 550; n++) {
    const agent = { ...identity, terminal_id: `terminal-${n}` };
    desk.mark(agent, "turn", true, n);
    desk.open(agent, n);
  }
  const state = desk.list();
  expect(state.records.length).toBeLessThanOrEqual(500);
  expect(
    state.records.filter((entry) => entry.opened_at !== null),
  ).toHaveLength(40);
  const last = { ...identity, terminal_id: "terminal-549" };
  desk.mark(last, "turn", true, 551);
  expect(desk.list().revision).toBe(state.revision);
});

test("an observation begun before a live mutation cannot restore the old session", () => {
  const desk = new WorldDeskRegistry();
  desk.observeAgent(identity, "working", 1);
  const replacement = {
    ...identity,
    agent_session_fingerprint: "b".repeat(64),
  };
  desk.mark(replacement, "new-turn", true, 5);
  desk.observeAgent(identity, "idle", 4);
  expect(desk.list().records[0]!.reviewed_stop).toBe("new-turn");
  expect(desk.list().records[0]!.agent_session_fingerprint).toBe(
    replacement.agent_session_fingerprint,
  );
});

test("retains only bounded metadata and recent-open ties prefer the newest action", () => {
  const desk = new WorldDeskRegistry();
  desk.mark(
    { ...identity, unbounded: "extra input" } as typeof identity,
    "turn",
    true,
    1,
  );
  expect(desk.list().records[0]).not.toHaveProperty("unbounded");
  for (let n = 0; n < 41; n++)
    desk.open({ ...identity, terminal_id: `terminal-${n}` }, 2);
  const opens = desk.list().records.filter((entry) => entry.opened_at !== null);
  expect(opens.some((entry) => entry.terminal_id === "terminal-40")).toBe(true);
  expect(opens.some((entry) => entry.terminal_id === "terminal-0")).toBe(false);
});
