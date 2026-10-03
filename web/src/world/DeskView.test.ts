import { describe, expect, test } from "bun:test";
import { deskShortcut, focusIndexOf, partitionDesk } from "./DeskView";
import {
  operationalAgents,
  pollingTargets,
  type TurnReceipt,
} from "./handoffs";
import {
  activityFromScreen,
  questionFromScreen,
  screenIdentity,
} from "./paneScreen";
import type { WorldObject } from "./worldObject";
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

describe("agents beyond the polling limit", () => {
  const admitted = (id: string, status: WorldLeafObject["status"]) =>
    ({
      ...leaf(id, status),
      selectedHost: true,
      actionable: true,
      stale: false,
    }) as WorldLeafObject;
  const leaves = [
    ...Array.from({ length: 40 }, (_, index) =>
      admitted(`idle-${index}`, "idle"),
    ),
    admitted("waiting", "blocked"),
  ];

  test("keep a blocked agent in triage and poll it first", () => {
    const agents = operationalAgents({ leaves } as unknown as WorldObject);
    expect(agents).toHaveLength(41);
    const lanes = partitionDesk(agents, () => null, new Set(), NOW);
    expect(lanes.needs.map((item) => item.leaf.id)).toEqual(["waiting"]);
    expect(pollingTargets(agents)[0]?.id).toBe("waiting");
    expect(pollingTargets(agents)).toHaveLength(40);
  });
});

describe("screen identity", () => {
  const pane = (fingerprint: string, generation = 1) =>
    ({
      ...leaf("pane", "blocked"),
      connectionId: "local",
      generation,
      agentSessionFingerprint: fingerprint,
      pane: { pane_id: "w1:p1" },
    }) as WorldLeafObject;

  test("changes when the session or runtime generation is replaced", () => {
    expect(screenIdentity(pane("a"))).toBe(screenIdentity(pane("a")));
    expect(screenIdentity(pane("b"))).not.toBe(screenIdentity(pane("a")));
    expect(screenIdentity(pane("a", 2))).not.toBe(screenIdentity(pane("a")));
  });
});

describe("Desk keyboard", () => {
  const key = (
    k: string,
    overrides: Partial<Parameters<typeof deskShortcut>[0]> = {},
  ) =>
    deskShortcut({
      key: k,
      modified: false,
      onDesk: true,
      editable: false,
      control: false,
      ...overrides,
    });

  test("leaves Enter to focused controls and ignores keys aimed elsewhere", () => {
    expect(key("Enter")).toBe("open");
    expect(key("Enter", { control: true })).toBeNull();
    expect(key("j", { control: true })).toBe("next");
    expect(key("Enter", { onDesk: false })).toBeNull();
    expect(key("e", { editable: true })).toBeNull();
    expect(key("k", { modified: true })).toBeNull();
  });

  test("keeps focus on the same agent when lanes reorder", () => {
    const before = [{ leaf: { id: "a" } }, { leaf: { id: "b" } }];
    const after = [{ leaf: { id: "new-blocked" } }, ...before];
    expect(focusIndexOf(before, "b")).toBe(1);
    expect(focusIndexOf(after, "b")).toBe(2);
    expect(focusIndexOf(after, "gone")).toBe(0);
  });

  test("marks a stop pending until its receipt has been fetched", () => {
    const lanes = partitionDesk(
      [leaf("fetching", "done"), leaf("none", "done")],
      (agent) => (agent.id === "fetching" ? undefined : null),
      new Set(),
      NOW,
    );
    expect(lanes.review.map((item) => [item.leaf.id, item.pending])).toEqual([
      ["fetching", true],
      ["none", false],
    ]);
  });
});
