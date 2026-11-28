import { describe, expect, test } from "bun:test";
import type { BinEntry } from "../../../shared/bin";
import { memoryApartmentsPort } from "../storage/apartments";
import { coreOccupantFingerprint } from "../herdr-core/occupant";
import { analyticsAgentId, UsageActivity } from "../usage/activity";
import { WorldApartments } from "./apartments";

const NOW = 1_800_000_000_000;

function tracker(
  extra: Partial<ConstructorParameters<typeof WorldApartments>[0]> = {},
) {
  const port = memoryApartmentsPort([], () => NOW);
  const published: number[] = [];
  const apartments = new WorldApartments({
    port,
    now: () => NOW,
    host: (id) => ({ label: `host ${id}`, runtime: "herdr" }),
    publish: (revision) => published.push(revision),
    ...extra,
  });
  return { apartments, port, published };
}

const pane = (terminal: string, extra: Record<string, unknown> = {}) => ({
  pane_id: `p-${terminal}`,
  terminal_id: terminal,
  workspace_id: "w1",
  tab_id: "tab1",
  agent: "claude",
  cwd: "/srv/example/project-alpha",
  agent_session: {
    kind: "id",
    value: "0f0e0d0c-0000-4000-8000-000000000001",
  },
  tokens: { task_summary: "Fixing the synthetic widget" },
  ...extra,
});
const topology = {
  workspaces: [{ workspace_id: "w1", label: "alpha" }],
  tabs: [{ tab_id: "tab1", label: "builder" }],
};
const agents = [{ pane_id: "p-t1", agent: "claude", name: "ada" }];

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setImmediate(resolve));
  expect(check()).toBe(true);
}

describe("finished agents move into apartments", () => {
  test("an agent whose terminal a complete list no longer has moves in, ended", async () => {
    const { apartments, published } = tracker({
      links: () => [{ kind: "pr", number: 42, repo: "example/repo" }],
      lastReport: () => "Opened PR #42",
    });
    apartments.fresh("local", 1, [pane("t1")], NOW - 60_000, agents, topology);
    // Summary expires later: the earlier one is kept.
    apartments.fresh(
      "local",
      1,
      [pane("t1", { tokens: {} })],
      NOW - 1000,
      agents,
    );
    apartments.complete("local", 1, [pane("t1")]);
    await apartments.settled();
    expect(apartments.list().residents).toEqual([]);
    apartments.complete("local", 1, []);
    await apartments.settled();
    const [resident] = apartments.list().residents;
    expect(resident).toMatchObject({
      name: "ada",
      harness: "claude",
      cwd: "/srv/example/project-alpha",
      room: "alpha",
      tab: "builder",
      connection_id: "local",
      connection_label: "host local",
      terminal_id: "t1",
      first_seen_at: NOW - 60_000,
      moved_out_at: NOW,
      move_out: "ended",
      summary: "Fixing the synthetic widget",
      last_report: "Opened PR #42",
      links: [{ kind: "pr", number: 42, repo: "example/repo" }],
      session_id: "0f0e0d0c-0000-4000-8000-000000000001",
    });
    // Once at the move-in, once when its report is added.
    expect(published).toEqual([1, 2]);
  });

  test("a new generation or another host's list witnesses nothing", async () => {
    const { apartments } = tracker();
    apartments.fresh("local", 1, [pane("t1")], NOW, agents);
    apartments.complete("other", 1, []);
    apartments.complete("local", 2, []);
    apartments.connectionStatus({ id: "local", generation: 2, state: "ready" });
    apartments.complete("local", 1, []);
    await apartments.settled();
    expect(apartments.list().residents).toEqual([]);
  });

  test("an agent the bus took is recorded as retired", async () => {
    const { apartments } = tracker();
    apartments.fresh("local", 1, [pane("t1")], NOW, agents);
    apartments.retire([
      {
        connection_id: "local",
        connection_generation: 1,
        terminal_id: "t1",
      } as BinEntry,
    ]);
    apartments.complete("local", 1, []);
    await apartments.settled();
    expect(apartments.list().residents[0]?.move_out).toBe("retired");
  });

  test("a core agent's session comes from its runtime, and plain shells are ignored", async () => {
    const { apartments } = tracker({
      session: (_connection, terminal, harness) =>
        terminal === "t1" && harness === "codex"
          ? { id: "019a0000-aaaa", holder: "1:70" }
          : null,
    });
    apartments.fresh(
      "core",
      3,
      [
        pane("t1", { agent: "codex", agent_session: undefined }),
        pane("t2", { agent: undefined }),
      ],
      NOW,
      [],
    );
    apartments.complete("core", 3, []);
    await apartments.settled();
    const residents = apartments.list().residents;
    expect(residents).toHaveLength(1);
    expect(residents[0]).toMatchObject({
      name: "codex",
      session_id: "019a0000-aaaa",
    });
  });

  const core = () => [pane("t1", { agent_session: undefined })];

  test("a core agent's current session replaces the one remembered", async () => {
    let answer: { id: string | null; holder: string } = {
      id: "session-a",
      holder: "1:70",
    };
    const { apartments } = tracker({ session: () => answer });
    apartments.fresh("core", 1, core(), NOW - 2000, []);
    // Claude's /resume in the same process.
    answer = { id: "session-b", holder: "1:70" };
    apartments.fresh("core", 1, core(), NOW - 1000, []);
    // A failed read of the same program is no evidence.
    answer = { id: null, holder: "1:70" };
    apartments.fresh("core", 1, core(), NOW - 500, []);
    apartments.complete("core", 1, []);
    await apartments.settled();
    expect(apartments.list().residents[0]?.session_id).toBe("session-b");
  });

  test("another program of the same harness does not inherit the session", async () => {
    let answer: { id: string | null; holder: string } = {
      id: "session-a",
      holder: "1:70",
    };
    const { apartments } = tracker({ session: () => answer });
    apartments.fresh("core", 1, core(), NOW - 2000, []);
    answer = { id: null, holder: "2:71" };
    apartments.fresh("core", 1, core(), NOW - 1000, []);
    apartments.complete("core", 1, []);
    await apartments.settled();
    expect(apartments.list().residents[0]?.session_id).toBeNull();
  });

  test("a session read still running when the agent ends is kept", async () => {
    let answer!: (value: { id: string; holder: string }) => void;
    const { apartments } = tracker({
      session: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    apartments.fresh("core", 1, core(), NOW - 1000, []);
    apartments.complete("core", 1, []);
    answer({ id: "session-late", holder: "1:70" });
    await apartments.settled();
    expect(apartments.list().residents[0]?.session_id).toBe("session-late");
  });

  test("a resident is written before its report is read, and a stop keeps it", async () => {
    let report!: (value: string) => void;
    const { apartments, published } = tracker({
      lastReport: () =>
        new Promise((resolve) => {
          report = resolve;
        }),
    });
    apartments.fresh("local", 1, [pane("t1")], NOW, agents);
    apartments.complete("local", 1, []);
    // Written while the report is still being read.
    await until(() => apartments.list().residents.length === 1);
    expect(apartments.list().residents[0]?.last_report).toBeNull();
    const stopped = apartments.stop();
    report("Opened PR #42");
    await stopped;
    // After the stop the report is dropped, the resident kept.
    expect(apartments.list().residents).toHaveLength(1);
    expect(apartments.list().residents[0]?.last_report).toBeNull();
    expect(published).toEqual([1]);
    // Nothing more is written once stopped.
    apartments.fresh("local", 1, [pane("t2")], NOW, agents);
    apartments.complete("local", 1, []);
    await apartments.settled();
    expect(apartments.list().residents).toHaveLength(1);
  });

  test("a report read after the move-in is added to the resident", async () => {
    let report!: (value: string) => void;
    const { apartments, published } = tracker({
      lastReport: () =>
        new Promise((resolve) => {
          report = resolve;
        }),
    });
    apartments.fresh("local", 1, [pane("t1")], NOW, agents);
    apartments.complete("local", 1, []);
    await until(() => apartments.list().residents.length === 1);
    report("Opened PR #42");
    await apartments.settled();
    expect(apartments.list().residents[0]?.last_report).toBe("Opened PR #42");
    expect(published).toEqual([1, 2]);
  });

  test("a resident keeps the usage agent IDs its runs were counted under", async () => {
    const { apartments } = tracker();
    // As usage reads the pane: its agent record joined in.
    const usageId = (session: string) =>
      analyticsAgentId("local", 1, {
        ...pane("t1", { agent_session: { kind: "id", value: session } }),
        ...agents[0],
      })!;
    apartments.fresh("local", 1, [pane("t1")], NOW - 60_000, agents);
    apartments.fresh("local", 1, [pane("t1")], NOW - 30_000, agents);
    apartments.complete("local", 1, []);
    await apartments.settled();
    const ids = apartments.list().residents[0]?.usage_agent_ids;
    expect(ids).toEqual([usageId("0f0e0d0c-0000-4000-8000-000000000001")]);
    expect(ids?.every((id) => /^agent_[a-f0-9]{64}$/.test(id))).toBe(true);
  });

  test("another harness session in the same terminal does not inherit usage", async () => {
    const { apartments } = tracker();
    const session = (value: string) => ({
      agent_session: { kind: "id", value },
    });
    const usageId = (value: string, name: string) =>
      analyticsAgentId("local", 1, {
        ...pane("t1", session(value)),
        pane_id: "p-t1",
        agent: "claude",
        name,
      })!;
    const a = "0f0e0d0c-0000-4000-8000-00000000000a";
    const b = "0f0e0d0c-0000-4000-8000-00000000000b";
    const named = (name: string) => [
      { pane_id: "p-t1", agent: "claude", name },
    ];
    apartments.fresh(
      "local",
      1,
      [pane("t1", session(a))],
      NOW - 9000,
      named("agent-a"),
    );
    // Session A ends into the shell; session B starts in the same terminal.
    apartments.fresh(
      "local",
      1,
      [pane("t1", { agent: undefined, agent_session: undefined })],
      NOW - 6000,
      [],
    );
    apartments.fresh(
      "local",
      1,
      [pane("t1", session(b))],
      NOW - 3000,
      named("agent-b"),
    );
    apartments.complete("local", 1, []);
    await apartments.settled();
    const [resident] = apartments.list().residents;
    expect(resident?.name).toBe("agent-b");
    expect(resident?.session_id).toBe(b);
    expect(resident?.usage_agent_ids).toEqual([usageId(b, "agent-b")]);
  });

  test("an agent left into a shell and found in its history keeps its usage", async () => {
    const { apartments } = tracker();
    const a = "0f0e0d0c-0000-4000-8000-000000000001";
    const usageId = analyticsAgentId("local", 1, {
      ...pane("t1"),
      ...agents[0],
    })!;
    apartments.fresh("local", 1, [pane("t1")], NOW - 9000, agents);
    // The program leaves; its terminal stays open with a shell.
    apartments.fresh(
      "local",
      1,
      [pane("t1", { agent: undefined, agent_session: undefined })],
      NOW - 6000,
      [],
    );
    const history = (session: string, name: string) => ({
      name,
      harness: "claude",
      cwd: null,
      room: null,
      tab: null,
      connection_id: "local",
      connection_label: "host local",
      runtime: "herdr" as const,
      terminal_id: `session:${session}`,
      first_seen_at: NOW - 60_000,
      moved_out_at: NOW - 6000,
      move_out: "found" as const,
      summary: null,
      last_report: null,
      links: [],
      session_id: session,
      appearance: null,
    });
    // The census finds its session, and an unwatched one, in the history.
    await apartments.found([
      history(a, "ada"),
      history("0f0e0d0c-0000-4000-8000-0000000000ff", "zed"),
    ]);
    const byName = Object.fromEntries(
      apartments.list().residents.map((r) => [r.name, r.usage_agent_ids]),
    );
    expect(byName).toEqual({ ada: [usageId], zed: [] });
    // A later census refresh of the record keeps it.
    await apartments.found([{ ...history(a, "ada"), moved_out_at: NOW }]);
    expect(
      apartments.list().residents.find((r) => r.name === "ada")
        ?.usage_agent_ids,
    ).toEqual([usageId]);
  });

  test("a core agent keeps the usage of every run of its own session only", async () => {
    const run = (occupant: string) => [
      pane("t1", {
        agent_session: undefined,
        core_occupant_fingerprint: occupant,
      }),
    ];
    const usageId = (occupant: string) =>
      analyticsAgentId("core", 1, run(occupant)[0]!)!;
    const left = [pane("t1", { agent: undefined })];
    // Run 1 of session A, the program leaves, and run 2 has `next`.
    const resident = async (next: string) => {
      let answer = { id: "session-a", holder: "1:70" };
      const { apartments } = tracker({ session: () => answer });
      apartments.fresh("core", 1, run("occ-1"), NOW - 9000, []);
      apartments.fresh("core", 1, left, NOW - 8000, []);
      answer = { id: next, holder: "1:71" };
      apartments.fresh("core", 1, run("occ-2"), NOW - 7000, []);
      apartments.complete("core", 1, []);
      await apartments.settled();
      return apartments.list().residents[0];
    };
    // Session A resumed by another process: both runs are its usage.
    const resumed = await resident("session-a");
    expect(resumed?.session_id).toBe("session-a");
    expect(resumed?.usage_agent_ids).toEqual([
      usageId("occ-1"),
      usageId("occ-2"),
    ]);
    // A new session B: only its own run.
    const other = await resident("session-b");
    expect(other?.session_id).toBe("session-b");
    expect(other?.usage_agent_ids).toEqual([usageId("occ-2")]);
  });

  test("runs that follow each other in one core shell terminal keep their usage when found", async () => {
    // Real key shapes: a core terminal address as pane and terminal ID, the
    // occupant fingerprint of the terminal's own program (the shell, so it
    // is the same for every run in it), core's harness names, a Claude UUID
    // and a Codex UUIDv7 read from the runtime, as knownSession answers.
    const occupant = coreOccupantFingerprint(
      "core-example",
      { address: "t6p", pid: 4242, argv: ["/bin/bash"] },
      1,
    )!;
    const row = (agent?: string) => ({
      pane_id: "t6p",
      terminal_id: "t6p",
      workspace_id: "core-space",
      tab_id: "core-space:tab",
      runtime: "herdr-core",
      cwd: "/srv/example/worktrees/item-1",
      core_occupant_fingerprint: occupant,
      ...(agent ? { agent, agent_status: "working" } : {}),
    });
    const fixerA = "8c58744b-0000-4000-8000-00000000000a";
    const checker = "01a20399-0000-7000-8000-00000000000c";
    const fixerB = "8c58744b-0000-4000-8000-00000000000b";
    let answer: { id: string; holder: string } | null = null;
    const { apartments } = tracker({
      host: (id) => ({ label: `host ${id}`, runtime: "herdr-core" }),
      session: () => answer,
    });
    const activity = new UsageActivity();
    const observe = (agent: string | undefined, at: number) => {
      apartments.fresh("core-local", 1, [row(agent)], at, []);
      activity.observeFresh("core-local", 1, [row(agent)], at, []);
    };
    // The fixer's claude, the checker's codex, then the next fixer's claude,
    // each leaving the terminal to its shell; the census comes later.
    answer = { id: fixerA, holder: "[1,5001]" };
    observe("claude", NOW - 9000);
    observe(undefined, NOW - 8000);
    answer = { id: checker, holder: "[1,5002]" };
    observe("codex", NOW - 7000);
    observe(undefined, NOW - 6000);
    answer = { id: fixerB, holder: "[1,5003]" };
    observe("claude", NOW - 5000);
    observe(undefined, NOW - 4000);
    const history = (harness: string, session: string) => ({
      name: harness,
      harness,
      cwd: "/srv/example/worktrees/item-1",
      room: null,
      tab: null,
      connection_id: "core-local",
      connection_label: "host core-local",
      runtime: "herdr-core" as const,
      terminal_id: `session:${session}`,
      first_seen_at: NOW - 60_000,
      moved_out_at: NOW - 4000,
      move_out: "found" as const,
      summary: null,
      last_report: null,
      links: [],
      session_id: session,
      appearance: null,
    });
    await apartments.found([
      history("claude", fixerA),
      history("codex", checker),
      history("claude", fixerB),
      history("claude", "8c58744b-0000-4000-8000-0000000000ff"),
    ]);
    const bySession = Object.fromEntries(
      apartments
        .list()
        .residents.map((r) => [r.session_id, r.usage_agent_ids ?? []]),
    );
    // The IDs are the agent rows usage counted them under.
    const counted = new Map(
      activity.read(NOW).map((r) => [r.harness, r.agent_id]),
    );
    expect(counted.size).toBe(2);
    expect(bySession).toEqual({
      [fixerA]: [counted.get("claude")],
      [checker]: [counted.get("codex")],
      // Usage counts the shell terminal's claude runs as one agent.
      [fixerB]: [counted.get("claude")],
      "8c58744b-0000-4000-8000-0000000000ff": [],
    });
  });

  test("evict removes residents and publishes", async () => {
    const { apartments, published } = tracker();
    apartments.fresh("local", 1, [pane("t1")], NOW, agents);
    apartments.complete("local", 1, []);
    await apartments.settled();
    const id = apartments.list().residents[0]!.id;
    const after = await apartments.evict([id]);
    expect(after.residents).toEqual([]);
    expect(published).toEqual([1, 2]);
  });
});

describe("a resident keeps the look it had in World", () => {
  const LOOK = {
    skin: "#f2c9a0",
    hair: "#5a3825",
    hair_style: "bun" as const,
    outfit: "hoodie" as const,
    shirt: "#59a86b",
    pants: "#30404a",
    accessory: "headset" as const,
  };

  test("its profile, look and colour are read while it lives and kept at move-in", async () => {
    const asked: unknown[] = [];
    let saved: typeof LOOK | null = LOOK;
    const { apartments } = tracker({
      appearance: (connectionId) => (pane) => {
        asked.push({
          connectionId,
          ...pane,
          workspace_ids: [...pane.workspace_ids],
        });
        return { profile_id: pane.profile_id, look: saved, color: "teal" };
      },
    });
    const launched = pane("t1", {
      tokens: {
        world_terminal: "t1",
        world_profile: "builder",
        world_profile_name: "Builder",
      },
    });
    apartments.fresh("local", 1, [launched], NOW - 60_000, agents, topology);
    expect(asked).toEqual([
      {
        connectionId: "local",
        pane_id: "p-t1",
        terminal_id: "t1",
        workspace_id: "w1",
        tab_id: "tab1",
        workspace_ids: ["w1"],
        profile_id: "builder",
      },
    ]);
    // Closing its terminal clears its saved avatar before the move-in is
    // seen; the look read while it lived is the one it keeps.
    saved = null;
    apartments.complete("local", 1, []);
    await apartments.settled();
    expect(apartments.list().residents[0]?.appearance).toEqual({
      profile_id: "builder",
      look: LOOK,
      color: "teal",
    });
  });

  test("a failed read keeps the last look; no reader at all records none", async () => {
    let fail = false;
    const { apartments } = tracker({
      appearance: () => {
        if (fail) throw new Error("board unavailable");
        return () => ({ profile_id: null, look: LOOK, color: null });
      },
    });
    apartments.fresh("local", 1, [pane("t1")], NOW - 60_000, agents, topology);
    fail = true;
    apartments.fresh("local", 1, [pane("t1")], NOW - 1000, agents, topology);
    apartments.complete("local", 1, []);
    await apartments.settled();
    expect(apartments.list().residents[0]?.appearance).toEqual({
      profile_id: null,
      look: LOOK,
      color: null,
    });

    const plain = tracker();
    plain.apartments.fresh("local", 1, [pane("t2")], NOW - 1000, [], topology);
    plain.apartments.complete("local", 1, []);
    await plain.apartments.settled();
    expect(plain.apartments.list().residents[0]?.appearance).toBeNull();
  });
});
