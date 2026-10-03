import { describe, expect, test } from "bun:test";
import {
  agentDirectory,
  deskShortcut,
  focusIndexOf,
  matchesQuery,
  otherHostSummaries,
  partitionDesk,
} from "./DeskView";
import { agentThreadTitle } from "./worldObject";
import {
  advanceObservedStops,
  answersSession,
  operationalAgents,
  pollingTargets,
  receiptIdentity,
  receiptAfterError,
  receiptAfterRead,
  receiptStateOf,
  receiptTrigger,
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
      (agent) => ({ receipt: receipts.get(agent.id) ?? null, current: true }),
      new Set([
        JSON.stringify([receiptIdentity(leaf("seen", "done")), "turn-seen"]),
      ]),
      NOW,
      new Map([[receiptIdentity(leaf("observed", "idle")), NOW - 60_000]]),
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
    const lanes = partitionDesk(
      agents,
      () => ({ receipt: null, current: true }),
      new Set(),
      NOW,
    );
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
    expect(focusIndexOf(after, "gone", 1)).toBe(1);
    expect(focusIndexOf(before, "gone", 5)).toBe(1);
  });

  test("marks a stop pending until its receipt has been fetched", () => {
    const lanes = partitionDesk(
      [leaf("fetching", "done"), leaf("none", "done")],
      (agent) => ({ receipt: null, current: agent.id !== "fetching" }),
      new Set(),
      NOW,
    );
    expect(lanes.review.map((item) => [item.leaf.id, item.pending])).toEqual([
      ["fetching", true],
      ["none", false],
    ]);
  });
});

describe("receipt currency", () => {
  const agent = (status: WorldLeafObject["status"]) =>
    ({ ...leaf("a", status), lastActivityAt: 1 }) as WorldLeafObject;

  test("a receipt read while working is not current once the agent stops", () => {
    const stored = receiptAfterRead(
      receipt("mid-turn", 1),
      receiptTrigger(agent("working")),
    );
    expect(receiptStateOf(stored, agent("working"), true).current).toBe(true);
    expect(receiptStateOf(stored, agent("done"), true).current).toBe(false);
  });

  test("a failed first read settles as no receipt so the stop can be marked", () => {
    const stored = receiptAfterError(undefined, receiptTrigger(agent("done")));
    expect(receiptStateOf(stored, agent("done"), true)).toEqual({
      receipt: null,
      current: true,
    });
  });

  test("a failed refresh keeps the previous receipt without making it current", () => {
    const previous = receiptAfterRead(
      receipt("earlier", 5),
      receiptTrigger(agent("working")),
    );
    const stored = receiptAfterError(previous, receiptTrigger(agent("done")));
    const state = receiptStateOf(stored, agent("done"), true);
    expect(state.receipt?.turn_id).toBe("earlier");
    expect(state.current).toBe(false);
  });

  test("a second failure for the same state settles on the previous receipt", () => {
    const previous = receiptAfterRead(
      receipt("earlier", 5),
      receiptTrigger(agent("working")),
    );
    const trigger = receiptTrigger(agent("done"));
    const settled = receiptAfterError(
      receiptAfterError(previous, trigger, 1),
      trigger,
      2,
    );
    const state = receiptStateOf(settled, agent("done"), true);
    expect(state.receipt?.turn_id).toBe("earlier");
    expect(state.current).toBe(true);
  });

  test("agents outside the read bound are never pending", () => {
    expect(receiptStateOf(undefined, agent("done"), false)).toEqual({
      receipt: null,
      current: true,
    });
  });
});

describe("observed stops", () => {
  const session = (fingerprint: string, status: WorldLeafObject["status"]) =>
    ({
      ...leaf("terminal", status),
      connectionId: "local",
      generation: 1,
      agentSessionFingerprint: fingerprint,
    }) as WorldLeafObject;

  test("a replacement session does not inherit its predecessor's stop", () => {
    const previous = new Map<string, string>();
    let stops = advanceObservedStops(
      new Map(),
      previous,
      [session("A", "working")],
      NOW,
    ).stops;
    stops = advanceObservedStops(
      stops,
      previous,
      [session("A", "idle")],
      NOW,
    ).stops;
    expect(stops.size).toBe(1);
    const replaced = advanceObservedStops(
      stops,
      previous,
      [session("B", "idle")],
      NOW + 1,
    );
    expect(replaced.stops.size).toBe(0);
    const lanes = partitionDesk(
      [session("B", "idle")],
      () => ({ receipt: null, current: true }),
      new Set(),
      NOW + 1,
      replaced.stops,
    );
    expect(lanes.review).toHaveLength(0);
  });
});

describe("turn responses", () => {
  const shown = { agentSessionFingerprint: "a".repeat(64) } as WorldLeafObject;

  test("only the shown session may publish a receipt", () => {
    expect(
      answersSession(
        { agent_session_fingerprint: "a".repeat(64), turn: null },
        shown,
      ),
    ).toBe(true);
    expect(
      answersSession(
        { agent_session_fingerprint: "b".repeat(64), turn: null },
        shown,
      ),
    ).toBe(false);
    expect(answersSession({ session_changed: true, turn: null }, shown)).toBe(
      false,
    );
  });
});

describe("other-host summaries", () => {
  test("summarize agents on hosts other than the selected one", () => {
    const remote = (id: string, status: WorldLeafObject["status"]) =>
      ({
        ...leaf(id, status),
        selectedHost: false,
        connectionId: "build-vm",
        hostLabel: "build-vm",
        stale: false,
      }) as WorldLeafObject;
    const local = {
      ...leaf("here", "blocked"),
      selectedHost: true,
    } as WorldLeafObject;
    const summaries = otherHostSummaries({
      leaves: [
        local,
        remote("r1", "blocked"),
        remote("r2", "done"),
        remote("r3", "working"),
      ],
    } as unknown as WorldObject);
    expect(summaries).toEqual([
      {
        connectionId: "build-vm",
        label: "build-vm",
        stale: false,
        needs: 1,
        done: 1,
        working: 1,
      },
    ]);
  });
});

describe("finding agents", () => {
  const named = (id: string, extra: Partial<WorldLeafObject>) =>
    ({
      ...leaf(id, "idle"),
      spaceLabel: "herdr-world",
      tabLabel: "4",
      pane: { pane_id: id, cwd: "/work/herdr-world" },
      ...extra,
    }) as WorldLeafObject;

  test("matches every word across title, tab, folder and request", () => {
    const agent = named("a", { terminalTitle: "Fix mobile viewport layout" });
    expect(matchesQuery(agent, null, "mobile layout")).toBe(true);
    expect(matchesQuery(agent, null, "herdr-world 4")).toBe(true);
    expect(matchesQuery(agent, receipt("t", 1), "do the thing")).toBe(true);
    expect(matchesQuery(agent, null, "mobile billing")).toBe(false);
  });

  test("lists recent opens first and orders workspaces by their latest agent", () => {
    const old = named("old", { spaceLabel: "career" });
    const fresh = named("fresh", { spaceLabel: "herdr-world" });
    const middle = named("middle", { spaceLabel: "career" });
    const active: Record<string, number> = { old: 1, fresh: 30, middle: 20 };
    const opened: Record<string, number> = { old: 50 };
    const { recent, groups } = agentDirectory(
      [old, fresh, middle],
      (agent) => active[agent.id] ?? null,
      (agent) => opened[agent.id] ?? null,
    );
    expect(recent.map((agent) => agent.id)).toEqual(["old"]);
    expect(
      groups.map((group) => [group.workspace, group.agents.map((a) => a.id)]),
    ).toEqual([
      ["herdr-world", ["fresh"]],
      ["career", ["middle", "old"]],
    ]);
  });

  test("reads the harness thread title from the terminal title", () => {
    expect(
      agentThreadTitle("⠋ Fix mobile viewport layout | herdr-world", "codex"),
    ).toBe("Fix mobile viewport layout");
    expect(agentThreadTitle("codex", "codex")).toBeUndefined();
    expect(agentThreadTitle(undefined, "codex")).toBeUndefined();
  });
});
