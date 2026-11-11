import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreEventLine } from "./client";
import { harnessName, harnessOfArgv } from "./harness";
import { CoreMirror, type CoreMirrorTerminal } from "./mirror";
import type { CoreRecording } from "./testing/capture-core";
import {
  CORE_UNPLACED_WORKSPACE,
  CoreFirstSight,
  coreAgentStatus,
  coreHarness,
  coreRuntimeReader,
  coreTopology,
} from "./topology";
import { FrameDecoder, FrameKind } from "./wire";

const recording: CoreRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/core-0.1.20.json"),
    "utf8",
  ),
);

/** The subscribe snapshot and every event line one recorded connection carried. */
function recordedStream(index: number) {
  const bytes = Buffer.concat(
    recording.connections[index]!.inbound.map((b) => Buffer.from(b, "base64")),
  );
  const decoder = new FrameDecoder();
  const text = new Map<number, string>();
  for (const frame of decoder.push(
    new Uint8Array(bytes.subarray(bytes.indexOf(0x0a) + 1)),
  )) {
    if (frame.kind !== FrameKind.DATA) continue;
    text.set(
      frame.channel,
      (text.get(frame.channel) ?? "") + new TextDecoder().decode(frame.payload),
    );
  }
  // Channel 0 replies are concatenated JSON objects: find the subscribe reply.
  const replies = (text.get(0) ?? "").split(/(?<=\})(?=\{"id")/);
  const subscribed = replies
    .map((reply) => JSON.parse(reply) as { result?: Record<string, unknown> })
    .find((reply) => reply.result && "terminals" in reply.result)!.result!;
  const lines = (text.get(subscribed.channel as number) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CoreEventLine);
  return {
    seq: subscribed.seq as number,
    terminals: subscribed.terminals as unknown[],
    lines,
  };
}

function record(fields: Partial<CoreMirrorTerminal> = {}): CoreMirrorTerminal {
  return {
    address: "t1",
    labels: {},
    argv: ["/bin/sh"],
    state: "live",
    remote: false,
    ...fields,
  } as CoreMirrorTerminal;
}

const shown = (topology: ReturnType<typeof coreTopology>) =>
  topology.panes.map((pane) => [
    pane.pane_id,
    pane.agent ?? null,
    pane.agent_status,
  ]);

describe("core agents from recorded 0.1.20 traffic", () => {
  test("each event moves World's status as core reported it, never guessed", () => {
    const stream = recordedStream(0);
    const mirror = new CoreMirror();
    const sight = new CoreFirstSight();
    expect(mirror.baseline(stream.seq, stream.terminals)).toBe(true);
    sight.observe("c0ffee0000000001", stream.terminals);
    const steps: unknown[] = [];
    for (const line of stream.lines) {
      if (mirror.apply(line) !== "applied") continue;
      if (line.method === "event" && line.params.type === "created")
        sight.observe("c0ffee0000000001", [line.params.data]);
      steps.push(
        shown(coreTopology(mirror.terminals(), "example-host", sight))[0],
      );
    }
    expect(steps).toEqual([
      // created: a command line with no harness, no report: a terminal
      ["t1", null, "unknown"],
      // 7501 working, then done; World decides on the turn event that
      // follows, as Herdr's apps do
      ["t1", "agent", "working"],
      ["t1", "agent", "idle"],
      ["t1", "agent", "done"],
      // the program exec'd its shell: core cleared status, it is a terminal
      ["t1", null, "unknown"],
      ["t1", null, "unknown"],
      // a label with multi-byte UTF-8 split across reads changes nothing shown
      ["t1", null, "unknown"],
    ]);
  });

  test("after kill -9 the respawned core lists the same terminal at the same address", () => {
    const before = recordedStream(0);
    const after = recordedStream(1);
    const mirror = new CoreMirror();
    mirror.baseline(after.seq, after.terminals);
    for (const line of after.lines) mirror.apply(line);
    const first = new CoreMirror();
    first.baseline(before.seq, before.terminals);
    for (const line of before.lines) first.apply(line);
    const ids = (m: CoreMirror) =>
      coreTopology(m.terminals(), "example-host").panes.map((p) => [
        p.pane_id,
        p.workspace_id,
        p.tab_id,
      ]);
    expect(ids(mirror)).toEqual(ids(first));
  });
});

describe("status follows Herdr's shared display rule", () => {
  const status = (fields: Partial<CoreMirrorTerminal>) =>
    coreAgentStatus(record(fields));

  test("blocked and error need you; working is working; no report is unknown", () => {
    expect(status({ status: { state: "blocked", kind: "question" } })).toBe(
      "blocked",
    );
    expect(status({ status: { state: "error" } })).toBe("blocked");
    expect(status({ status: { state: "working" } })).toBe("working");
    expect(status({ status: null, reported: true })).toBe("unknown");
    expect(status({})).toBe("unknown");
  });

  test("with herdr.seen, done means a turn nobody has looked at", () => {
    const at = (word: string, turn: number, seen: string) =>
      status({ status: { state: word }, turn, labels: { "herdr.seen": seen } });
    expect(at("idle", 3, "2")).toBe("done");
    expect(at("done", 3, "3")).toBe("idle");
    expect(at("idle", 0, "0")).toBe("idle");
    // blocked beats seen; a malformed seen counts as missing
    expect(at("blocked", 3, "3")).toBe("blocked");
    expect(at("done", 3, "x")).toBe("idle");
  });

  test("without herdr.seen, World's first sight stands in (a missing label is not 0)", () => {
    const at = (turn: number, firstSight: number | null) =>
      coreAgentStatus(record({ status: { state: "idle" }, turn }), firstSight);
    // Turns that ended before World first saw the terminal are not news.
    expect(at(4, 4)).toBe("idle");
    expect(at(4, null)).toBe("idle");
    // One that ended since is, until a Herdr client marks it seen.
    expect(at(5, 4)).toBe("done");
    expect(
      coreAgentStatus(
        record({
          status: { state: "idle" },
          turn: 5,
          labels: { "herdr.seen": "5" },
        }),
        4,
      ),
    ).toBe("idle");
  });

  test("first sight is per core: a replaced core starts again; a removed address is forgotten", () => {
    const sight = new CoreFirstSight();
    sight.observe("a", [{ address: "t1", turn: 3 }]);
    sight.observe("a", [{ address: "t1", turn: 9 }]);
    expect(sight.turn("t1")).toBe(3);
    sight.observe("b", [{ address: "t1", turn: 9 }]);
    expect(sight.turn("t1")).toBe(9);
    sight.forget("t1");
    expect(sight.turn("t1")).toBeNull();
  });
});

describe("harnesses: every one herdr-core and herdr support", () => {
  test("names and aliases from Herdr's integrations and the desktop app", () => {
    for (const [name, harness] of [
      ["claude-code", "claude"],
      ["Codex", "codex"],
      ["gemini", "gemini"],
      ["aider", null],
      ["opencode", "opencode"],
      ["agy", "antigravity-cli"],
      ["kiro-cli", "kiro"],
      ["qoder", "qodercli"],
      ["crush", "crush"],
      ["/usr/local/bin/pi", "pi"],
      ["codex.exe", "codex"],
      ["sh", null],
    ] as const)
      expect([name, harnessName(name)]).toEqual([name, harness]);
  });

  test("looks through the desktop app's shell wrapper and script interpreters", () => {
    expect(
      harnessOfArgv(["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "claude"]),
    ).toBe("claude");
    expect(harnessOfArgv(["node", "--no-warnings", "/opt/codex.js"])).toBe(
      "codex",
    );
    expect(harnessOfArgv(["sh", "-c", "claude"])).toBeNull();
    expect(harnessOfArgv(["bash"])).toBeNull();
  });

  test("the report names the harness; otherwise what runs now, not what started", () => {
    expect(
      coreHarness(record({ status: { state: "idle", app: "claude-code" } })),
    ).toBe("claude");
    // The agent exited to the wrapper's shell: no longer an agent.
    expect(
      coreHarness(
        record({
          argv: ["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "codex"],
          foreground: { pid: 9, name: "zsh", argv: ["zsh", "-i"] },
        }),
      ),
    ).toBeNull();
    // A harness with no 7501 integration is an agent with unknown status.
    const quiet = record({
      foreground: { pid: 9, name: "opencode", argv: ["opencode"] },
    });
    expect(coreHarness(quiet)).toBe("opencode");
    expect(coreAgentStatus(quiet)).toBe("unknown");
    // A program that reports 7501 is an agent even if no list names it.
    expect(
      coreHarness(record({ status: { state: "working", app: "MyBot" } })),
    ).toBe("mybot");
    expect(coreHarness(record({ status: { state: "working" } }))).toBe("agent");
  });
});

describe("rooms follow Herdr's desktop app placement", () => {
  const terminals = [
    record({
      address: "t1",
      name: "reviewer",
      labels: {
        "herdr.space": "s1",
        "herdr.tab": "c2",
        where: "web / review",
      },
      status: { state: "blocked", kind: "permission", msg: "Run tests?" },
      foreground: { pid: 1, name: "claude", argv: ["claude"], cwd: "/w/a" },
      cwd: "/w",
    }),
    record({ address: "t2", parent: "t1", argv: ["codex"] }),
    record({ address: "t3", argv: ["bash"] }),
    record({ address: "t4", state: "finished", argv: ["claude"] }),
    record({ address: "mac/t1", remote: true, argv: ["claude"] }),
    record({
      address: "t10",
      labels: { "herdr.space": "s1", "herdr.tab": "c2", where: "a / b / c" },
      argv: ["gemini"],
    }),
  ];
  const topology = coreTopology(terminals, "example-host");

  test("placed terminals share the app's spaces and tabs, named from its caption", () => {
    expect(topology.workspaces).toEqual([
      { workspace_id: "hc:space:s1", label: "web", focused: false },
      {
        workspace_id: CORE_UNPLACED_WORKSPACE,
        label: "example-host",
        focused: false,
      },
    ]);
    expect(topology.tabs.map((tab) => [tab.tab_id, tab.label])).toEqual([
      ["hc:space:s1:tab:c2", "review"],
      ["hc:unplaced:tab:main", "example-host"],
    ]);
  });

  test("a sub-agent joins its parent; finished and linked-machine terminals stay out", () => {
    expect(
      topology.panes.map((pane) => [pane.pane_id, pane.workspace_id]),
    ).toEqual([
      ["t1", "hc:space:s1"],
      ["t2", "hc:space:s1"],
      ["t3", CORE_UNPLACED_WORKSPACE],
      ["t10", "hc:space:s1"],
    ]);
    expect(topology.agents.map((agent) => agent.pane_id)).toEqual([
      "t1",
      "t2",
      "t10",
    ]);
  });

  test("an agent row carries what Needs you shows and its runtime", () => {
    expect(topology.panes[0]).toEqual({
      pane_id: "t1",
      terminal_id: "t1",
      workspace_id: "hc:space:s1",
      tab_id: "hc:space:s1:tab:c2",
      focused: false,
      runtime: "herdr-core",
      cwd: "/w",
      foreground_cwd: "/w/a",
      agent_status: "blocked",
      agent: "claude",
      blocked_kind: "permission",
      status_message: "Run tests?",
      // Shared with Herdr's apps: the turn to mark seen (no seen label yet).
      turn: 0,
    });
    expect(topology.agents[0]).toEqual({
      pane_id: "t1",
      terminal_id: "t1",
      agent: "claude",
      name: "reviewer",
      agent_status: "blocked",
    });
    expect(topology.panes[2]).toMatchObject({
      pane_id: "t3",
      agent_status: "unknown",
    });
    expect(topology.panes[2]).not.toHaveProperty("agent");
    // Shells have no turns to share.
    expect(topology.panes[2]).not.toHaveProperty("turn");
  });

  test("seen and favourite come from the shared labels", () => {
    const rows = coreTopology(
      [
        record({
          address: "t1",
          argv: ["claude"],
          turn: 4,
          status: { state: "done" },
          labels: { "herdr.seen": "3", "herdr.pinned": "1" },
        }),
        record({ address: "t2", labels: { "herdr.pinned": "" } }),
      ],
      "box",
    );
    expect(rows.panes[0]).toMatchObject({
      agent_status: "done",
      turn: 4,
      seen_turn: 3,
      favourite: true,
    });
    expect(rows.panes[1]).not.toHaveProperty("favourite");
    expect(rows.panes[1]).not.toHaveProperty("seen_turn");
  });
});

describe("a core always has a room to start in", () => {
  test("a new core with no terminals and no rooms offers its main room, empty", () => {
    const empty = coreTopology([], "example-host");
    expect(empty.workspaces).toEqual([
      {
        workspace_id: CORE_UNPLACED_WORKSPACE,
        label: "example-host",
        focused: false,
      },
    ]);
    expect([empty.tabs, empty.panes, empty.agents]).toEqual([[], [], []]);
    // Linked-machine and finished terminals show nowhere, so still empty.
    expect(
      coreTopology(
        [
          record({ address: "mac/t1", remote: true }),
          record({ address: "t4", state: "finished" }),
        ],
        "example-host",
      ).workspaces.map((w) => w.workspace_id),
    ).toEqual([CORE_UNPLACED_WORKSPACE]);
  });

  test("any other room means no extra main room", () => {
    const placed = coreTopology(
      [record({ address: "t1", labels: { "herdr.space": "s1" } })],
      "example-host",
    );
    expect(placed.workspaces.map((w) => w.workspace_id)).toEqual([
      "hc:space:s1",
    ]);
  });
});

describe("the read model refuses a mirror that is not current", () => {
  test("a retired mirror lists nothing as current; one cut serves all four lists", async () => {
    const mirror = new CoreMirror();
    mirror.baseline(0, [record({ address: "t1", argv: ["claude"] })]);
    let actionable = true;
    const reader = coreRuntimeReader({
      mirror,
      get actionable() {
        return actionable;
      },
      coreName: () => "example-host",
    });
    const [workspaces, panes] = await Promise.all([
      reader.listWorkspaces(),
      reader.listTerminals(),
    ]);
    expect(workspaces.workspaces).toHaveLength(1);
    expect(panes.panes?.[0]).toMatchObject({ agent: "claude" });
    actionable = false;
    await expect(reader.listTerminals()).rejects.toThrow("not current");
  });
});
