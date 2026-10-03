import { describe, expect, test } from "bun:test";
import { partitionDesk } from "./DeskView";
import type { TurnReceipt } from "./handoffs";
import { activityFromScreen, questionFromScreen } from "./paneScreen";
import type { WorldLeafObject } from "./worldObject";

const NOW = Date.UTC(2026, 0, 1, 12);

function leaf(id: string, status: WorldLeafObject["status"]) {
  return { id, status, kind: "agent" } as WorldLeafObject;
}

function receipt(id: string, endedMinutesAgo: number): TurnReceipt {
  return {
    turn_id: id,
    ask: "Do the thing",
    report: "Did the thing",
    started_at: new Date(NOW - (endedMinutesAgo + 5) * 60_000).toISOString(),
    ended_at: new Date(NOW - endedMinutesAgo * 60_000).toISOString(),
    duration_ms: 5 * 60_000,
    tool_calls: 3,
    commands: 1,
    files: ["src/a.ts"],
    files_truncated: false,
  };
}

describe("partitionDesk", () => {
  test("routes agents by what they need from the operator", () => {
    const receipts = new Map<string, TurnReceipt>([
      ["recent", receipt("turn-recent", 10)],
      ["old", receipt("turn-old", 60 * 24)],
      ["seen", receipt("turn-seen", 5)],
      ["blocked-late", receipt("turn-b2", 2)],
      ["blocked-early", receipt("turn-b1", 30)],
    ]);
    const lanes = partitionDesk(
      [
        leaf("blocked-late", "blocked"),
        leaf("working", "working"),
        leaf("recent", "idle"),
        leaf("old", "idle"),
        leaf("seen", "done"),
        leaf("blocked-early", "blocked"),
        leaf("observed", "idle"),
        leaf("unknown", "unknown"),
      ],
      (agent) => receipts.get(agent.id),
      new Set(["turn-seen"]),
      NOW,
      new Map([["observed", NOW - 60_000]]),
    );
    expect(lanes.needs.map((item) => item.leaf.id)).toEqual([
      "blocked-early",
      "blocked-late",
    ]);
    expect(lanes.working.map((item) => item.leaf.id)).toEqual(["working"]);
    expect(lanes.review.map((item) => [item.leaf.id, item.handled])).toEqual([
      ["recent", false],
      ["observed", false],
      ["seen", true],
    ]);
    expect(lanes.quiet.map((agent) => agent.id)).toEqual(["old", "unknown"]);
  });
});

describe("pane screens", () => {
  test("drops Pi footer lines from live activity", () => {
    const pi = [
      "Reading openspec/changes/example/specs/world/spec.md",
      "Searching web/src for watchlist",
      "────────────────────────",
      "~/projects/demo (main)",
      "↑40k ↓3.5k $0.012 (sub) 4.0%/1.0M (auto)   (deepseek) deepseek-v4-pro • high",
    ].join("\n");
    expect(activityFromScreen(pi, 2)).toEqual([
      "Reading openspec/changes/example/specs/world/spec.md",
      "Searching web/src for watchlist",
    ]);
  });

  const blocked = [
    "• Edited package.json",
    "",
    "  Would you like to make the following edits?",
    "  Destination: package.json",
    "› 1. Yes, proceed (y)",
    "  2. No, and tell Codex what to do differently (esc)",
    "  Press enter to confirm or esc to cancel",
  ].join("\n");

  test("keeps the question and its choices, not the key hints", () => {
    expect(questionFromScreen(blocked, 4)).toEqual([
      "  Would you like to make the following edits?",
      "  Destination: package.json",
      "› 1. Yes, proceed (y)",
      "  2. No, and tell Codex what to do differently (esc)",
    ]);
  });

  test("reads progress and status above the input box and footer", () => {
    const working = [
      "• Ran bun test",
      "  └ 2 pass",
      "• Working (12s • esc to interrupt)",
      "",
      "╭──────────────────────────╮",
      "│ › Ask Codex to do anything │",
      "╰──────────────────────────╯",
      "  ? for shortcuts       Context 6% used",
    ].join("\n");
    expect(activityFromScreen(working, 2)).toEqual([
      "  └ 2 pass",
      "• Working (12s • esc to interrupt)",
    ]);
  });
});
