import { expect, test } from "bun:test";
import type { HistoryEntry } from "./agentHistory";
import { historyCatchUp } from "./useHistoryCatchUp";

const message = (
  id: string,
  second: number,
  role: HistoryEntry["role"] = "assistant",
  notice?: string,
): HistoryEntry => ({
  id,
  role,
  text: id,
  kind: role === "tool" ? "tool_result" : "message",
  sent_at: new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString(),
  ...(notice ? { notice } : {}),
});

test("catch-up counts only new agent messages while away, never initial history or older pages", () => {
  const shown = [message("user", 10, "user"), message("reply", 11)];
  let state = historyCatchUp(null, "session-a", shown, false);
  expect(state.unread).toBe(0);
  state = historyCatchUp(
    state,
    "session-a",
    [message("older", 1), ...shown],
    true,
  );
  expect(state.unread).toBe(0);
  const next = [
    ...shown,
    message("mine", 12, "user"),
    message("tool", 13, "tool"),
    message("notice", 14, "assistant", "compacted"),
    message("one", 15),
    message("two", 15),
    message("three", 16),
  ];
  state = historyCatchUp(state, "session-a", next, true);
  expect(state.unread).toBe(3);
  expect(historyCatchUp(state, "session-a", next, true).unread).toBe(3);
  expect(historyCatchUp(state, "session-a", next, false).unread).toBe(0);
  expect(historyCatchUp(state, "session-b", next, true).unread).toBe(0);
});

test("window eviction and loaded payload changes preserve counts without treating backfill as new", () => {
  let state = historyCatchUp(
    null,
    "session",
    [message("a", 1), message("b", 2)],
    false,
  );
  state = historyCatchUp(
    state,
    "session",
    [message("b", 2), message("c", 3)],
    true,
  );
  expect(state.unread).toBe(1);
  state = historyCatchUp(
    state,
    "session",
    [message("d", 4), message("e", 5)],
    true,
  );
  expect(state.unread).toBe(3);
  expect(state.ids.size).toBe(2);
  state = historyCatchUp(state, "session", [message("before", 0)], true);
  expect(state.unread).toBe(3);
  expect(
    historyCatchUp(state, "session", [message("last", 6)], false).unread,
  ).toBe(0);
});

test("an empty first load is not unread, and an intermediate empty window preserves the read boundary", () => {
  let state = historyCatchUp(null, "session", [], true);
  state = historyCatchUp(state, "session", [message("initial", 10)], true);
  expect(state.unread).toBe(0);
  state = historyCatchUp(state, "session", [], true);
  state = historyCatchUp(state, "session", [message("new", 11)], true);
  expect(state.unread).toBe(1);
});
