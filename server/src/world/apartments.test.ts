import { describe, expect, test } from "bun:test";
import type { BinEntry } from "../../../shared/bin";
import { memoryApartmentsPort } from "../storage/apartments";
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
    await new Promise((resolve) => setTimeout(resolve, 1));
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
