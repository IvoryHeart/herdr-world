import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
  type StartupLocalProfile,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { silentLogger } from "../utils/logger";
import { worldRuntimeRegistry } from "../world/runtime-registry";
import {
  type WorldConnectionSnapshot,
  WorldSnapshotService,
} from "../world/snapshot";
import { createCoreConnections } from "./connections";
import { FakeCore } from "./testing/fake-core";
import { localCoreTransport } from "./transport";

/**
 * Core agents in World's aggregate read model: the rows Town, Desk, Board
 * and Needs you are built from, through the real provider (framed client,
 * ordered mirror) against an in-process core, beside a TUI connection.
 */

const roots: string[] = [];
const cores: Array<{ fake: FakeCore; socket: string }> = [];
afterEach(async () => {
  for (const { fake, socket } of cores.splice(0)) fake.kill(socket);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean | Promise<boolean>, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}

const startup: StartupLocalProfile = {
  id: "startup-default",
  label: "Herdr",
  type: "local",
  control_socket_path: "/synthetic/herdr.sock",
  client_socket_path: "/synthetic/herdr-client.sock",
  auto_connect: false,
};

/** The same three agents, as Herdr's TUI lists them. */
const tuiRows = {
  "workspace.list": {
    workspaces: [{ workspace_id: "w1", label: "web", focused: true }],
  },
  "tab.list": {
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "review" }],
  },
  "pane.list": {
    panes: [
      {
        pane_id: "p1",
        terminal_id: "p1",
        workspace_id: "w1",
        tab_id: "w1:t1",
        agent: "claude",
        agent_status: "blocked",
      },
      {
        pane_id: "p2",
        terminal_id: "p2",
        workspace_id: "w1",
        tab_id: "w1:t1",
        agent: "codex",
        agent_status: "working",
      },
      {
        pane_id: "p3",
        terminal_id: "p3",
        workspace_id: "w1",
        tab_id: "w1:t1",
        agent: "gemini",
        agent_status: "done",
      },
      {
        pane_id: "p4",
        terminal_id: "p4",
        workspace_id: "w1",
        tab_id: "w1:t1",
        agent_status: "unknown",
      },
    ],
  },
  "agent.list": {
    agents: [
      { pane_id: "p1", terminal_id: "p1", agent: "claude", name: "reviewer" },
      { pane_id: "p2", terminal_id: "p2", agent: "codex", name: "builder" },
      { pane_id: "p3", terminal_id: "p3", agent: "gemini", name: "scout" },
    ],
  },
} as Record<string, unknown>;

/** The same three agents and one shell, as core holds them. */
function coreAgents(fake: FakeCore) {
  const placed = {
    "herdr.space": "s1",
    "herdr.tab": "c1",
    where: "web / review",
  };
  const reviewer = fake.create({
    name: "reviewer",
    labels: placed,
    argv: ["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "claude"],
    foreground: { pid: 7, name: "claude", argv: ["claude"], cwd: "/w" },
  });
  const builder = fake.create({
    name: "builder",
    labels: placed,
    argv: ["codex"],
    foreground: { pid: 8, name: "codex", argv: ["codex"], cwd: "/w" },
  });
  const scout = fake.create({
    name: "scout",
    labels: placed,
    argv: ["gemini"],
    foreground: { pid: 9, name: "node", argv: ["node", "/opt/gemini"] },
  });
  fake.create({ labels: placed });
  fake.report(reviewer, { state: "working", app: "claude-code" });
  fake.report(reviewer, {
    state: "blocked",
    kind: "question",
    app: "claude-code",
    msg: "Which branch?",
  });
  fake.report(builder, { state: "working", app: "codex" });
  fake.report(scout, { state: "working" });
  fake.report(scout, { state: "idle" });
  return { reviewer, builder, scout };
}

function world() {
  const root = mkdtempSync(join(tmpdir(), "hcw-r-"));
  roots.push(root);
  const tuiManager = new ConnectionManager<
    ConnectionRuntime & ReturnType<typeof herdrRuntimeFixture>
  >("startup-default");
  let invalidate: (id: string) => void = () => {};
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    observed: (id) => invalidate(id),
    profiles: () => service,
    transportFor: (profile) => localCoreTransport(profile.core_state_dir),
  });
  const store = new ConnectionProfileStore({
    path: join(root, "data", "connections.json"),
  });
  const service = new ConnectionProfileService({
    manager: tuiManager,
    core: core.support as never,
    store,
    bootstrap: loadConnectionProfileBootstrap({
      store,
      startupProfile: startup,
      explicitStartupOverride: false,
    }),
    createRuntime: (profile) => (context: ConnectionRuntimeContext) => ({
      identity: {
        id: profile.id,
        label: profile.label,
        source: "local-profile",
      },
      context,
      ...herdrRuntimeFixture({
        call: async (method: string) => tuiRows[method] ?? {},
      }),
      startTransport: async () => {},
      startBackground: () => {},
      stop: async () => {},
    }),
    retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
  });
  const registry = worldRuntimeRegistry(tuiManager, core.manager);
  const snapshots = new WorldSnapshotService(registry);
  invalidate = (id) => snapshots.invalidate(id);
  const read = async (id: string) =>
    (await snapshots.snapshot()).connections.find(
      (c) => c.connection_id === id,
    )!;
  /** The TUI profile World made from the startup connection. */
  const tui = () => tuiManager.list()[0]!.id;
  return { root, service, core, tuiManager, registry, read, tui };
}

async function servedCore(root: string, options = {}) {
  const fake = new FakeCore({ heartbeatMs: 60_000, ...options });
  fake.revive();
  const stateDir = join(root, "core", "state");
  const socket = await fake.listen(stateDir, join(root, "core", "run"));
  cores.push({ fake, socket });
  return { fake, stateDir, socket };
}

const coreProfile = (stateDir: string) => ({
  id: "box-core",
  label: "box core",
  type: "local",
  runtime: "herdr-core",
  core_session: "default",
  core_state_dir: stateDir,
  auto_connect: true,
});

/** What a person sees per agent, independent of runtime-native IDs. */
function seen(connection: WorldConnectionSnapshot) {
  const snapshot = connection.snapshot!;
  const names = new Map(
    snapshot.agents.map((agent) => [agent.pane_id, agent.name]),
  );
  const rooms = new Map(
    snapshot.workspaces.map((w) => [w.workspace_id, w.label]),
  );
  const tabs = new Map(snapshot.tabs.map((t) => [t.tab_id, t.label]));
  return {
    panes: snapshot.panes
      .map((pane) => ({
        name: names.get(pane.pane_id) ?? null,
        agent: pane.agent ?? null,
        status: pane.agent_status,
        room: rooms.get(pane.workspace_id as string),
        tab: tabs.get(pane.tab_id as string),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    coverage: snapshot.coverage.status,
    agents: snapshot.coverage.agent_panes,
  };
}

describe("core agents in World's read model", () => {
  test("TUI and core: the same agents give the same World state", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    await w.tuiManager.start(w.tui());
    // World watches as the agents start and work, as Herdr's TUI did.
    await w.service.create(coreProfile(stateDir));
    coreAgents(fake);
    const tui = await w.read(w.tui());
    await until(
      async () =>
        JSON.stringify(seen(await w.read("box-core"))) ===
        JSON.stringify(seen(tui)),
    ).catch(() => {});
    const core = await w.read("box-core");
    expect(seen(core)).toEqual(seen(tui));
    expect(seen(core).coverage).toEqual({
      working: 1,
      idle: 0,
      blocked: 1,
      done: 1,
      unknown: 0,
    });
    // The runtime is named once, on the connection: views decide where.
    expect(core).toMatchObject({ runtime: "herdr-core", actionable: true });
    expect(tui).not.toHaveProperty("runtime");
  });

  test("a host with both runtimes lists both, each once, under its own connection", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    coreAgents(fake);
    await w.tuiManager.start(w.tui());
    await w.service.create(coreProfile(stateDir));
    await until(async () => (await w.read("box-core")).snapshot !== null);
    const result = await (async () => {
      const all = await Promise.all([w.read(w.tui()), w.read("box-core")]);
      return all.map((c) => [c.connection_id, c.snapshot!.panes.length]);
    })();
    expect(result).toEqual([
      [w.tui(), 4],
      ["box-core", 4],
    ]);
    // A lease is only ever taken from the manager that owns the ID.
    expect(w.registry.readyRuntimeLease("box-core")?.runtime).toHaveProperty(
      "core",
    );
    expect(w.registry.readyRuntimeLease(w.tui())?.runtime).not.toHaveProperty(
      "core",
    );
    expect(() => w.registry.readyRuntimeLease("absent")).toThrow(
      "unknown connection",
    );
  });

  test("status changes reach World through core's events, and World only reads", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    await w.service.create(coreProfile(stateDir));
    const { reviewer, scout } = coreAgents(fake);
    const status = async (name: string) =>
      (await w.read("box-core")).snapshot?.panes.find(
        (pane) =>
          pane.pane_id ===
          (name === "reviewer" ? reviewer : name === "scout" ? scout : ""),
      )?.agent_status;
    await until(async () => (await status("reviewer")) === "blocked");
    const started = performance.now();
    fake.report(reviewer, { state: "working", app: "claude-code" });
    await until(async () => (await status("reviewer")) === "working");
    const latencyMs = performance.now() - started;
    // The provider coalesces bursts for 200 ms; World then re-reads.
    expect(latencyMs).toBeLessThan(1_500);
    // Scout finished while World watched: done until someone looks.
    await until(async () => (await status("scout")) === "done");
    // Another client marks its turn seen: done becomes idle everywhere.
    fake.label(scout, { "herdr.seen": "1" });
    await until(async () => (await status("scout")) === "idle");
    // Marked unread elsewhere (seen = turn - 1): done again.
    fake.label(scout, { "herdr.seen": "0" });
    await until(async () => (await status("scout")) === "done");
    const methods = new Set(fake.calls.map((call) => call.method));
    expect([...methods].sort()).toEqual(
      ["hello", "events.subscribe", "server.status"].sort(),
    );
  });

  test("kill -9: stale and non-actionable, then the same agents at the same addresses", async () => {
    const w = world();
    const { fake, stateDir, socket } = await servedCore(w.root);
    coreAgents(fake);
    await w.service.create(coreProfile(stateDir));
    await until(async () => (await w.read("box-core")).snapshot !== null);
    const before = seen(await w.read("box-core"));
    const addresses = (await w.read("box-core")).snapshot!.panes.map(
      (pane) => pane.pane_id,
    );
    fake.kill(socket);
    await until(async () => (await w.read("box-core")).stale);
    const down = await w.read("box-core");
    expect(down).toMatchObject({ stale: true, actionable: false });
    expect(seen(down)).toEqual(before);
    fake.revive();
    await fake.listen(stateDir, join(w.root, "core", "run"));
    await until(async () => {
      const back = await w.read("box-core");
      return back.actionable && !back.stale;
    });
    const back = await w.read("box-core");
    expect(back.snapshot!.panes.map((pane) => pane.pane_id)).toEqual(addresses);
    expect(seen(back)).toEqual(before);
  });

  test("a silently lost event (oversized missed) is never shown as current", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    const { builder } = coreAgents(fake);
    await w.service.create(coreProfile(stateDir));
    await until(async () => (await w.read("box-core")).snapshot !== null);
    const generation = w.core.manager.status("box-core").generation;
    fake.suppressEvents(1);
    fake.heartbeatNow();
    await until(
      () => w.core.manager.status("box-core").generation > generation,
    );
    // Reacquired from a fresh snapshot: current again, with core's facts.
    fake.report(builder, { state: "done", app: "codex" });
    await until(async () => {
      const now = await w.read("box-core");
      return (
        now.actionable &&
        now.snapshot?.panes.find((pane) => pane.pane_id === builder)
          ?.agent_status === "done"
      );
    });
  });

  test("a kept replacement shell is a terminal, not the agent it replaced", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    const { builder } = coreAgents(fake);
    await w.service.create(coreProfile(stateDir));
    const pane = async () =>
      (await w.read("box-core")).snapshot?.panes.find(
        (p) => p.pane_id === builder,
      );
    await until(async () => (await pane())?.agent === "codex");
    fake.replaceWithShell(builder);
    await until(async () => (await pane())?.agent === undefined);
    expect(await pane()).toMatchObject({ agent_status: "unknown" });
  });

  test("a room name split inside a UTF-8 character arrives whole", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root, { splitWritesAt: 1 });
    fake.create({
      argv: ["claude"],
      labels: { "herdr.space": "s9", where: "café ✓ 漢字 / tâche" },
    });
    await w.service.create(coreProfile(stateDir));
    await until(async () => (await w.read("box-core")).snapshot !== null);
    const snapshot = (await w.read("box-core")).snapshot!;
    expect(snapshot.workspaces[0]?.label).toBe("café ✓ 漢字");
    expect(snapshot.tabs[0]?.label).toBe("tâche");
  });

  test("a burst past the credit window keeps order; World shows the last word", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    const { builder } = coreAgents(fake);
    await w.service.create(coreProfile(stateDir));
    await until(async () => (await w.read("box-core")).snapshot !== null);
    // About 1 MiB of events: four credit windows' worth.
    const message = "x".repeat(200);
    const started = performance.now();
    for (let i = 0; i < 4_000; i++)
      fake.report(builder, {
        state: i % 2 ? "working" : "blocked",
        msg: `${i} ${message}`,
      });
    fake.report(builder, { state: "done", app: "codex" });
    const target = fake.currentSeq;
    const runtime = w.core.manager.readyRuntimeLease("box-core")!.runtime;
    await until(() => runtime.core.mirror.cursor === target, 10_000);
    const elapsed = performance.now() - started;
    await until(async () => {
      const now = await w.read("box-core");
      return (
        now.actionable &&
        now.snapshot?.panes.find((pane) => pane.pane_id === builder)
          ?.agent_status === "done"
      );
    });
    // Throughput for the PR's evidence; ordering is what the test asserts.
    console.info(
      `core burst: ${target} events in ${elapsed.toFixed(0)} ms (${((target / elapsed) * 1000).toFixed(0)} events/s)`,
    );
  });
});
