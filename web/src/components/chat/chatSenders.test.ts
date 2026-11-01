import { describe, expect, test } from "bun:test";
import type { HistoryEntry } from "../agentHistory";
import type { HistoryChatItem } from "../agentHistoryView";
import { chatRows, relayedSender } from "./chatSenders";

const agents = new Set(["alpha", "beta-2"]);

let id = 0;
const message = (
  role: "user" | "assistant",
  text: string,
  extra: Partial<HistoryEntry> = {},
): HistoryChatItem => ({
  type: "message",
  sequence: ++id,
  entry: {
    id: `m${id}`,
    role,
    text,
    sent_at: "2026-11-01T10:00:00Z",
    ...extra,
  } as HistoryEntry,
});
const tools: HistoryChatItem = { type: "tools", id: "t1", entries: [] };

describe("relayedSender", () => {
  test("names a live agent that starts the message", () => {
    expect(relayedSender("alpha: Phase 2 done", agents)).toBe("alpha");
    expect(relayedSender("beta-2: ready — see notes", agents)).toBe("beta-2");
  });

  test("ordinary text and unknown names stay the owner's", () => {
    expect(relayedSender("Note: check the build", agents)).toBeNull();
    expect(relayedSender("gamma: Phase 2 done", agents)).toBeNull();
    expect(relayedSender("alpha:no space", agents)).toBeNull();
    expect(relayedSender("ask alpha: are you done", agents)).toBeNull();
    expect(relayedSender("alpha: done", new Set())).toBeNull();
  });
});

describe("chatRows", () => {
  test("names each run's sender once and marks relays", () => {
    const items = [
      message("assistant", "one"),
      tools,
      message("assistant", "two"),
      message("user", "alpha: report"),
      message("user", "alpha: second report"),
      message("user", "thanks"),
      message("user", "beta-2: done"),
      message("assistant", "reply"),
    ];
    const rows = [...chatRows(items, agents).values()];
    expect(rows.map((row) => row.sender)).toEqual([
      { kind: "agent" },
      { kind: "agent" },
      { kind: "relayed", name: "alpha" },
      { kind: "relayed", name: "alpha" },
      { kind: "user" },
      { kind: "relayed", name: "beta-2" },
      { kind: "agent" },
    ]);
    expect(rows.map((row) => row.continued)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  test("a notice divider starts a new run; it gets no row", () => {
    const items = [
      message("assistant", "before"),
      message("assistant", "Compacted", { notice: "Compacted" }),
      message("assistant", "after"),
    ];
    const rows = chatRows(items, agents);
    expect(rows.size).toBe(2);
    expect([...rows.values()].map((row) => row.continued)).toEqual([
      false,
      false,
    ]);
  });

  test("an agent's text never reads as relayed", () => {
    const rows = chatRows([message("assistant", "alpha: hi")], agents);
    expect([...rows.values()][0].sender).toEqual({ kind: "agent" });
  });
});
