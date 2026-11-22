import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreEventLine } from "./client";
import { harnessInvocation, harnessName, harnessOfArgv } from "./harness";
import { CoreMirror, type CoreMirrorTerminal } from "./mirror";
import type { CoreRecording } from "./testing/capture-core";
import {
  CORE_UNPLACED_WORKSPACE,
  CoreDeskMemory,
  CoreFirstSight,
  CoreRoomNames,
  coreAgentStatus,
  coreDeskProcess,
  coreDeskStatus,
  coreHarness,
  coreHidesAgent,
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

describe("a working agent shows at its desk: reports checked against the process", () => {
  const fg = (argv: string[]) => ({
    pid: 40,
    name: argv[0]!.split("/").pop()!,
    argv,
  });
  /** What one terminal shows, with the host's read of its foreground group. */
  const desk = (
    fields: Partial<CoreMirrorTerminal>,
    group: string[][] | null = null,
  ) => {
    const terminal = record(fields);
    const topology = coreTopology([terminal], "test core", {
      firstSight: new CoreFirstSight(),
      foregroundGroup: group ? () => group : undefined,
    });
    const pane = topology.panes[0]!;
    return [pane.agent ?? null, pane.agent_status];
  };

  test("headless invocations are told apart from interactive ones", () => {
    const run = (argv: string[]) => harnessInvocation(argv);
    expect(run(["claude", "-p", "fix the tests"])).toEqual({
      harness: "claude",
      headless: true,
    });
    expect(run(["claude", "--print=json"])?.headless).toBe(true);
    expect(run(["claude", "--print", "hi"])?.headless).toBe(true);
    expect(run(["codex", "exec", "fix it"])?.headless).toBe(true);
    expect(run(["codex", "-m", "o3", "exec", "fix it"])?.headless).toBe(true);
    expect(run(["node", "/opt/codex.js", "exec", "x"])?.headless).toBe(true);
    expect(run(["opencode", "run", "x"])?.headless).toBe(true);
    // A prompt word is not a subcommand; an interactive session is not headless.
    expect(run(["codex", "fix", "exec"])?.headless).toBe(false);
    expect(run(["claude"])).toEqual({ harness: "claude", headless: false });
    expect(run(["claude", "--", "-p"])?.headless).toBe(false);
    expect(run(["git", "status"])).toBeNull();
  });

  test("an option's value is never a subcommand", () => {
    const run = (argv: string[]) => harnessInvocation(argv)?.headless;
    // Interactive Codex in a folder named `exec`.
    expect(run(["codex", "-C", "exec"])).toBe(false);
    expect(run(["codex", "--cd", "exec", "fix it"])).toBe(false);
    expect(run(["codex", "-m", "exec"])).toBe(false);
    // Values given inline, and options that take none, leave the command next.
    expect(run(["codex", "-C", "/srv/app", "exec", "x"])).toBe(true);
    expect(run(["codex", "--cd=/srv/app", "exec", "x"])).toBe(true);
    expect(run(["codex", "-C/srv/app", "exec", "x"])).toBe(true);
    expect(run(["codex", "--full-auto", "--search", "exec", "x"])).toBe(true);
    // Images take values up to the next option.
    expect(run(["codex", "-i", "a.png", "exec"])).toBe(false);
    expect(run(["codex", "-i", "a.png", "--oss", "exec", "x"])).toBe(true);
    // An option this list does not know may take the word after it.
    expect(run(["codex", "--someday", "exec"])).toBe(false);
    expect(run(["opencode", "--port", "run"])).toBe(false);
    // The pane: interactive and silent is unknown; its idle report stands.
    const codex = { foreground: fg(["codex", "-C", "exec"]) };
    expect(desk(codex)).toEqual(["codex", "unknown"]);
    expect(desk({ ...codex, status: { state: "idle", app: "codex" } })).toEqual(
      ["codex", "idle"],
    );
  });

  test("a headless run starts: the desk works with no report at all", () => {
    expect(desk({ foreground: fg(["claude", "-p", "go"]) })).toEqual([
      "claude",
      "working",
    ]);
    // A question it asks still needs you.
    expect(
      desk({
        foreground: fg(["claude", "-p", "go"]),
        status: { state: "blocked", app: "claude" },
      }),
    ).toEqual(["claude", "blocked"]);
  });

  test("a wrapper's agent is found in the foreground group, nearest first", () => {
    // bash run.sh runs `claude -p … | tee log` with job control off.
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    expect(
      desk(wrapper, [
        ["claude", "-p", "go"],
        ["tee", "log"],
      ]),
    ).toEqual(["claude", "working"]);
    expect(
      desk({ foreground: fg(["sh", "-c", "claude; echo done"]) }, [["claude"]]),
    ).toEqual(["claude", "unknown"]);
    expect(
      coreDeskProcess(record(wrapper), [["git", "log"], ["claude"]]),
    ).toEqual({ running: { harness: "claude", headless: false }, gone: false });
    // Without the group, World cannot see inside the wrapper.
    expect(desk(wrapper)).toEqual([null, "unknown"]);
    expect(coreHidesAgent(record(wrapper))).toBe(true);
  });

  test("a plain shell's short-lived child is not an agent", () => {
    expect(
      desk({ foreground: fg(["bash", "run.sh"]) }, [["git", "status"]]),
    ).toEqual([null, "unknown"]);
    expect(desk({ foreground: fg(["bun", "test"]) })).toEqual([
      null,
      "unknown",
    ]);
    expect(desk({ foreground: fg(["git", "status"]) })).toEqual([
      null,
      "unknown",
    ]);
    expect(coreHidesAgent(record({ foreground: fg(["git", "status"]) }))).toBe(
      false,
    );
    expect(coreHidesAgent(record({ foreground: fg(["claude"]) }))).toBe(false);
    // An interactive shell puts each job in its own group: nothing hides there.
    for (const argv of [["bash"], ["-zsh"], ["zsh", "-i"], ["fish", "-l"]])
      expect(coreHidesAgent(record({ foreground: fg(argv) }))).toBe(false);
    for (const argv of [
      ["bash", "-c", "x"],
      ["zsh", "-ic", "x"],
      ["node", "a.js"],
    ])
      expect(coreHidesAgent(record({ foreground: fg(argv) }))).toBe(true);
  });

  test("killed mid-turn: a stale working report leaves the desk", () => {
    const stale = { state: "working", app: "claude" };
    // The wrapper is back in front and its group holds no agent.
    expect(
      desk({ foreground: fg(["bash", "run.sh"]), status: stale }, [
        ["sleep", "5"],
      ]),
    ).toEqual(["claude", "idle"]);
    // Something that cannot hide an agent leads the terminal.
    expect(
      desk({ foreground: fg(["vim", "notes.md"]), status: stale }),
    ).toEqual(["claude", "idle"]);
    expect(
      desk(
        {
          foreground: fg(["bash", "run.sh"]),
          status: { state: "blocked", app: "claude" },
        },
        [],
      ),
    ).toEqual(["claude", "idle"]);
    // Back at an interactive shell (core on Windows does not clear it).
    expect(desk({ foreground: fg(["pwsh"]), status: stale })).toEqual([
      "claude",
      "idle",
    ]);
    // A wrapper World cannot look inside (a remote core) keeps the report.
    expect(desk({ foreground: fg(["bash", "run.sh"]), status: stale })).toEqual(
      ["claude", "working"],
    );
    // A program that names no known harness is its own evidence.
    expect(
      desk({
        foreground: fg(["mybot"]),
        status: { state: "working", app: "MyBot" },
      }),
    ).toEqual(["mybot", "working"]);
  });

  test("a report speaks only for the harness that runs: a replacement never inherits it", () => {
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    // Claude reported working and exited; interactive Codex now runs silent.
    expect(
      desk({ ...wrapper, status: { state: "working", app: "claude" } }, [
        ["codex"],
      ]),
    ).toEqual(["codex", "unknown"]);
    // The same when the leader itself is the new harness.
    expect(
      desk({
        foreground: fg(["codex"]),
        status: { state: "working", app: "claude" },
      }),
    ).toEqual(["codex", "unknown"]);
    // A headless replacement works on its own evidence.
    expect(
      desk({ ...wrapper, status: { state: "idle", app: "claude" } }, [
        ["codex", "exec", "x"],
      ]),
    ).toEqual(["codex", "working"]);
  });

  /** One desk projected again and again, with World's memory of it. */
  const watched = () => {
    const desks = new CoreDeskMemory();
    const firstSight = new CoreFirstSight();
    return (fields: Partial<CoreMirrorTerminal>, group: string[][] | null) => {
      const pane = coreTopology([record(fields)], "test core", {
        firstSight,
        foregroundGroup: () => group,
        desks,
      }).panes[0]!;
      return [pane.agent ?? null, pane.agent_status];
    };
  };

  test("a headless run that ends inside its wrapper leaves for the bar, not out of sight", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    expect(view(wrapper, [])).toEqual([null, "unknown"]);
    expect(view(wrapper, [["claude", "-p", "go"], ["tee"]])).toEqual([
      "claude",
      "working",
    ]);
    // Between calls: the agent stays, idle (Town walks it to the bar).
    expect(view(wrapper, [["sleep", "60"]])).toEqual(["claude", "idle"]);
    expect(view(wrapper, [])).toEqual(["claude", "idle"]);
    // The next call: back at its desk.
    expect(view(wrapper, [["claude", "-p", "next"]])).toEqual([
      "claude",
      "working",
    ]);
    expect(view(wrapper, [])).toEqual(["claude", "idle"]);
    // The wrapper ends and the shell is back: forgotten, as a direct agent is.
    expect(view({ foreground: { ...fg(["bash"]), pid: 41 } }, [])).toEqual([
      null,
      "unknown",
    ]);
    // A plain shell's short-lived child never becomes an agent desk.
    expect(view(wrapper, [["git", "status"]])).toEqual([null, "unknown"]);
    expect(view(wrapper, [])).toEqual([null, "unknown"]);
  });

  test("a report left by a process that exited is lent to no replacement", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    const working = { state: "working", app: "claude" };
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
    // Killed mid-turn: its working report is stale.
    expect(view({ ...wrapper, status: working }, [])).toEqual([
      "claude",
      "idle",
    ]);
    // A new interactive Claude that has not reported is unknown, not working.
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "unknown",
    ]);
    // Its own first report counts.
    expect(
      view({ ...wrapper, status: { state: "idle", app: "claude" } }, [
        ["claude"],
      ]),
    ).toEqual(["claude", "idle"]);
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
  });

  test("a group World could not read is no evidence that the agent left", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    const working = { state: "working", app: "claude" };
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
    // One failed host read: what World last saw stands.
    expect(view({ ...wrapper, status: working }, null)).toEqual([
      "claude",
      "working",
    ]);
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
    // Read again and empty: now it has left.
    expect(view({ ...wrapper, status: working }, [])).toEqual([
      "claude",
      "idle",
    ]);
  });

  test("an unread group keeps a report-free headless run working", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    const run = [["claude", "-p", "go"], ["tee"]];
    expect(view(wrapper, run)).toEqual(["claude", "working"]);
    expect(view(wrapper, null)).toEqual(["claude", "working"]);
    expect(view(wrapper, run)).toEqual(["claude", "working"]);
    expect(view(wrapper, [])).toEqual(["claude", "idle"]);
  });

  test("an unread group keeps the agent World saw, not an older reporter", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    const working = { state: "working", app: "claude" };
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
    // Silent interactive Codex replaced Claude; one read fails.
    expect(view({ ...wrapper, status: working }, [["codex"]])).toEqual([
      "codex",
      "unknown",
    ]);
    expect(view({ ...wrapper, status: working }, null)).toEqual([
      "codex",
      "unknown",
    ]);
    expect(view({ ...wrapper, status: working }, [["codex"]])).toEqual([
      "codex",
      "unknown",
    ]);
  });

  test("the agent that left keeps the desk's name, not an older reporter's", () => {
    const view = watched();
    const wrapper = { foreground: fg(["bash", "run.sh"]) };
    const working = { state: "working", app: "claude" };
    expect(view({ ...wrapper, status: working }, [["claude"]])).toEqual([
      "claude",
      "working",
    ]);
    // Claude exited; silent interactive Codex replaced it, then exited too.
    expect(view({ ...wrapper, status: working }, [["codex"]])).toEqual([
      "codex",
      "unknown",
    ]);
    expect(view({ ...wrapper, status: working }, [])).toEqual([
      "codex",
      "idle",
    ]);
  });

  test("a function or alias in a pipeline leads its job as a copy of the shell", () => {
    // `f | cat`: the forked shell keeps the interactive shell's argv.
    const subshell = {
      pid: 30,
      foreground: fg(["bash", "--noprofile", "--norc", "-i"]),
    };
    expect(coreHidesAgent(record(subshell))).toBe(true);
    // The terminal's own shell at its prompt hides nothing.
    expect(
      coreHidesAgent(
        record({ ...subshell, foreground: { ...fg(["bash"]), pid: 30 } }),
      ),
    ).toBe(false);
  });

  test("an interactive agent's status is its own report; none is unknown", () => {
    const claude = { foreground: fg(["claude"]) };
    expect(
      desk({ ...claude, status: { state: "idle", app: "claude" } }),
    ).toEqual(["claude", "idle"]);
    expect(
      desk({ ...claude, status: { state: "working", app: "claude" } }),
    ).toEqual(["claude", "working"]);
    expect(desk(claude)).toEqual(["claude", "unknown"]);
    expect(
      coreDeskStatus(record(claude), coreDeskProcess(record(claude))),
    ).toBe("unknown");
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

describe("no core room is ever unnamed", () => {
  test("an app space World recorded keeps the app's name, not a generic one", () => {
    const world = {
      core_id: "core-1",
      revision: 1,
      rooms: [
        {
          id: "r1",
          label: "",
          app_space: "s1",
          tabs: [{ id: "b1", label: "Builder", terminals: ["t1"] }],
        },
        { id: "r2", label: "", app_space: "s2", tabs: [] },
      ],
    };
    const rows = coreTopology(
      [
        record({
          address: "t1",
          labels: {
            "herdr.space": "world-r1",
            "herdr.tab": "world-b1",
            where: "web / Builder",
          },
        }),
      ],
      "example-host",
      { world },
    );
    expect(rows.workspaces.map((w) => [w.workspace_id, w.label])).toEqual([
      ["hc:space:s1", "web"],
      // Nothing in it says the app's name yet: still a named room.
      ["hc:space:s2", "Herdr space"],
    ]);
  });

  test("a core without a name still names its main room", () => {
    for (const name of ["", "  "])
      expect(coreTopology([], name).workspaces).toEqual([
        {
          workspace_id: CORE_UNPLACED_WORKSPACE,
          label: "herdr-core",
          focused: false,
        },
      ]);
  });

  // #1103: unnamed app spaces all read "Herdr space" on plates and cards.
  const unnamedSpace = (
    address: string,
    space: string,
    fields: Partial<CoreMirrorTerminal> = {},
    where = "",
  ) =>
    record({
      address,
      labels: { "herdr.space": space, "herdr.tab": "b1", where },
      ...fields,
    });
  const named = (rows: ReturnType<typeof coreTopology>) =>
    rows.workspaces.map((w) => [w.label, w.label_derived_from ?? null]);

  test("an unnamed app space is named from its oldest terminal's folder, marked as derived", () => {
    const rows = coreTopology(
      [
        unnamedSpace("t3", "s1", { cwd: "/srv/example/later" }),
        unnamedSpace("t1", "s1", { cwd: "/srv/example/api/" }),
        unnamedSpace("t2", "s2", { cwd: "/srv/example/docs" }),
        record({
          address: "t4",
          labels: { "herdr.space": "s3", where: "web / review" },
          cwd: "/srv/example/api",
        }),
      ],
      "example-host",
    );
    expect(named(rows)).toEqual([
      ["api", "folder"],
      ["docs", "folder"],
      ["web", null],
    ]);
    // Tabs keep their own names; only the room is derived.
    expect(rows.tabs.map((tab) => tab.label)).toEqual(["Tab", "Tab", "review"]);
  });

  test("the name holds while newer agents come and go", () => {
    const oldest = unnamedSpace("t1", "s1", { cwd: "/srv/example/api" });
    const before = coreTopology([oldest], "example-host");
    const after = coreTopology(
      [
        oldest,
        unnamedSpace("t2", "s1", {
          cwd: "/srv/example/other",
          name: "newcomer",
          status: { state: "working", app: "claude-code" },
        }),
      ],
      "example-host",
    );
    expect(named(before)).toEqual([["api", "folder"]]);
    expect(named(after)).toEqual(named(before));
  });

  test("without a folder: World's tab name, then the first agent, else Herdr space", () => {
    const world = {
      core_id: "core-a",
      rooms: [
        {
          id: "r1",
          label: "",
          app_space: "s1",
          tabs: [{ id: "b1", label: "Builder", terminals: ["t1"] }],
        },
      ],
    };
    const rows = coreTopology(
      [
        unnamedSpace("t1", "s1"),
        unnamedSpace("t2", "s2", {
          name: "scout",
          status: { state: "working", app: "gemini" },
        }),
        unnamedSpace("t3", "s3", {
          status: { state: "idle", app: "codex" },
        }),
        unnamedSpace("t4", "s4"),
      ],
      "example-host",
      { world: world as never },
    );
    expect(named(rows)).toEqual([
      ["Builder", "tab"],
      ["scout", "agent"],
      ["codex", "agent"],
      ["Herdr space", null],
    ]);
  });

  test("rooms that would share a derived name get a number; a named room keeps its own", () => {
    const rows = coreTopology(
      [
        record({
          address: "t1",
          labels: { "herdr.space": "s0", where: "API / main" },
        }),
        unnamedSpace("t2", "s1", { cwd: "/srv/a/api" }),
        unnamedSpace("t3", "s2", { cwd: "/srv/b/api" }),
        unnamedSpace("t4", "s3", { cwd: "/srv/c/web" }),
      ],
      "example-host",
    );
    expect(named(rows)).toEqual([
      ["API", null],
      ["api 2", "folder"],
      ["api 3", "folder"],
      ["web", "folder"],
    ]);
  });

  test("a newer terminal's folder never outranks the oldest terminal's agent", () => {
    const scout = unnamedSpace("t1", "s1", {
      name: "scout",
      status: { state: "working", app: "gemini" },
    });
    const newer = unnamedSpace("t2", "s1", { cwd: "/srv/example/api" });
    expect(named(coreTopology([scout], "example-host"))).toEqual([
      ["scout", "agent"],
    ]);
    expect(named(coreTopology([scout, newer], "example-host"))).toEqual([
      ["scout", "agent"],
    ]);
  });

  test("with World's memory, a name holds when its terminals or another room leave", () => {
    const roomNames = new CoreRoomNames();
    const observe = (terminals: CoreMirrorTerminal[]) =>
      named(
        coreTopology(terminals, "example-host", {
          coreId: "core-a",
          roomNames,
        }),
      );
    const first = unnamedSpace("t1", "s1", { cwd: "/srv/a/api" });
    const second = unnamedSpace("t2", "s2", { cwd: "/srv/b/api" });
    const secondNewer = unnamedSpace("t3", "s2", { cwd: "/srv/b/docs" });
    expect(observe([first, second, secondNewer])).toEqual([
      ["api", "folder"],
      ["api 2", "folder"],
    ]);
    // The first room leaves: the second keeps its number.
    expect(observe([second, secondNewer])).toEqual([["api 2", "folder"]]);
    // Its oldest terminal leaves: the name stays.
    expect(observe([secondNewer])).toEqual([["api 2", "folder"]]);
    // A new room that would read `api` takes the free name.
    const third = unnamedSpace("t4", "s3", { cwd: "/srv/c/api" });
    expect(observe([secondNewer, third])).toEqual([
      ["api 2", "folder"],
      ["api", "folder"],
    ]);
    // A room's own name that reads the same wins; the derived one renumbers.
    const named2 = record({
      address: "t0",
      labels: { "herdr.space": "s0", where: "API 2 / main" },
    });
    expect(observe([named2, secondNewer, third])).toEqual([
      ["API 2", null],
      ["docs", "folder"],
      ["api", "folder"],
    ]);
  });

  test("the app's own `Herdr space` caption names its space; World's placeholder does not", () => {
    const rows = coreTopology(
      [
        unnamedSpace(
          "t1",
          "s1",
          { cwd: "/srv/example/api" },
          "Herdr space / Review",
        ),
        record({
          address: "t2",
          cwd: "/srv/example/docs",
          labels: {
            "herdr.space": "s2",
            "herdr.tab": "b1",
            where: "Herdr space / Builder",
            "herdr-world.unnamed-space": "1",
          },
        }),
      ],
      "example-host",
    );
    expect(named(rows)).toEqual([
      ["Herdr space", null],
      ["docs", "folder"],
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
