import { describe, expect, test } from "bun:test";
import type { HistoryEntry } from "../agentHistory";
import type { HistoryChatItem } from "../agentHistoryView";
import { chatRows, relayNames, relayedSender } from "./chatSenders";

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

describe("relayNames", () => {
  const live = (pane_id: string, agent_name: string, agent = "claude") => ({
    pane_id,
    agent,
    agent_name,
  });

  test("keeps a name's own characters, so a delimiter names no one", () => {
    const names = relayNames(
      [live("p1", "lead"), live("p2", "alpha\nbeta")],
      "p1",
    );
    expect(names).toEqual([]);
    expect(relayedSender("beta: report", new Set(names))).toBeNull();
  });

  test("a name two panes share, or the pane's own, names no one agent", () => {
    expect(
      relayNames(
        [live("p1", "lead"), live("p2", "alpha"), live("p3", "alpha")],
        "p1",
      ),
    ).toEqual([]);
    expect(relayNames([live("p1", "lead"), live("p2", "lead")], "p1")).toEqual(
      [],
    );
  });

  test("other live agents with valid unique names, sorted", () => {
    expect(
      relayNames(
        [
          live("p1", "lead"),
          live("p2", "beta-2"),
          live("p3", "alpha"),
          { pane_id: "p4", agent_name: "shell-only" },
          live("p5", "has space"),
        ],
        "p1",
      ),
    ).toEqual(["alpha", "beta-2"]);
  });
});

describe("chatRows runs", () => {
  const at = (iso: string) => ({ sent_at: iso }) as Partial<HistoryEntry>;
  const continued = (items: HistoryChatItem[]) =>
    [...chatRows(items, agents).values()].map((row) => row.continued);

  test("tools after another sender, or at the top, never continue it", () => {
    expect(
      continued([message("user", "go"), tools, message("assistant", "done")]),
    ).toEqual([false, false]);
    expect(continued([tools, message("assistant", "done")])).toEqual([false]);
    expect(
      continued([
        message("user", "alpha: report"),
        tools,
        message("assistant", "seen"),
      ]),
    ).toEqual([false, false]);
  });

  test("a new day or an unreadable time starts a new run", () => {
    expect(
      continued([
        message("assistant", "one", at("2026-10-31T10:00:00Z")),
        message("assistant", "two", at("2026-11-01T10:00:00Z")),
        message("assistant", "three", at("2026-11-01T10:05:00Z")),
        message("assistant", "four", at("not a time")),
        message("assistant", "five", at("not a time")),
      ]),
    ).toEqual([false, false, true, false, false]);
  });
});
