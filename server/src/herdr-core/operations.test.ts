import { afterEach, describe, expect, test } from "bun:test";
import { CoreKillConfirmation } from "./kill-plan";
import {
  closeCoreRoom,
  CoreOperationRefused,
  createCoreRoom,
  killCore,
  launchCore,
  planCoreKill,
  renameCoreRoom,
  type CoreKillPlanView,
} from "./operations";
import { CORE_UNPLACED_WORKSPACE } from "./topology";
import { coreWorld, until } from "./testing/core-world";

/**
 * World starting and ending herdr-core terminals (M1–M3, M7), through the
 * real provider against an in-process core that applies core's own parent
 * death rule. Every assertion about what reaches core reads the calls the
 * core received, not World's intent.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function world(options?: Parameters<typeof coreWorld>[0]) {
  const w = await coreWorld(options);
  worlds.push(w);
  await w.connect();
  return w;
}

const resolveExecutable = async (kind: string) => `/opt/example/bin/${kind}`;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const runs = (w: World) =>
  w.fake.calls.filter((c) => c.method === "terminal.run");
const confirmAll = (plan: CoreKillPlanView): CoreKillConfirmation => ({
  coreId: plan.core_id,
  terminals: [...plan.roots, ...plan.descendants].map((e) => ({
    address: e.address,
    pid: e.pid,
    occupant: e.occupant,
    remote: e.remote,
  })),
});

describe("launching in herdr-core (M2, M3)", () => {
  test("a non-Claude/Codex profile sends its role and brief through native delivery", async () => {
    const w = await world({ runStatus: "idle", runForeground: "pi" });
    const room = await createCoreRoom(w.lease(), w.topology, "Review");
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: room.workspace_id,
        kind: "pi",
        label: "Scout",
        text: "Review the tests",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "sent" });
    expect(w.fake.deliveredInput).toEqual([
      expect.objectContaining({ input: "Review the tests" }),
    ]);
  });

  test("a silent generic harness starts without typing its saved brief", async () => {
    const w = await world();
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "copilot",
        label: "Scout",
        text: "Review carefully",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({
      status: "started",
      terminal_id: "t1",
      pane_id: "t1",
      agent_name: "scout",
      message: expect.stringContaining("Open Chat to send the brief"),
    });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("an idle report from a shell wrapper cannot admit an automatic brief", async () => {
    const w = await world({ runStatus: "idle", runForeground: "bash" });
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "pi",
        label: "Scout",
        text: "Review carefully",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "started" });
    expect(w.fake.deliveredInput).toEqual([]);
  });

  test("uncertain brief delivery retains the definitely started agent identity", async () => {
    const w = await world({ runStatus: "idle", runForeground: "pi" });
    w.fake.onTyped = () => w.fake.kill(w.socket);
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "pi",
        label: "Scout",
        text: "Review carefully",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({
      status: "uncertain",
      runtime: "herdr-core",
      workspace_id: CORE_UNPLACED_WORKSPACE,
      pane_id: "t1",
      terminal_id: "t1",
      tab_id: expect.any(String),
      agent_name: "scout",
      placed: true,
      message: expect.stringContaining(
        "Started, but delivery of the brief is uncertain",
      ),
    });
    expect(w.fake.deliveredInput).toHaveLength(1);
  });

  test("an agent starts with explicit native parameters, placed in the app", async () => {
    const w = await world();
    const room = await createCoreRoom(w.lease(), w.topology, "Review");
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: room.workspace_id,
        kind: "claude",
        label: "Reviewer",
        args: (name) => ["--agent", name],
        text: "Check the tests",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({
      status: "sent",
      runtime: "herdr-core",
      workspace_id: room.workspace_id,
      agent_name: "reviewer",
      placed: true,
    });
    const [run] = runs(w);
    const params = run!.params as Record<string, unknown>;
    // Exactly what core receives: no caller, no parent, no notes, keep set,
    // an absolute shell wrapper and the first message as a literal argument.
    expect(Object.keys(params).sort()).toEqual(
      [
        "argv",
        "env",
        "keep",
        "labels",
        "name",
        "no_notify",
        "no_parent",
        "outlive_parent",
      ].sort(),
    );
    expect(params).toMatchObject({
      argv: [
        "/bin/sh",
        "-c",
        expect.stringContaining('exec "$@"'),
        "world-agent",
        "/opt/example/bin/claude",
        "--agent",
        "reviewer",
        "--session-id",
        expect.stringMatching(UUID),
        "Check the tests",
      ],
      keep: true,
      no_parent: true,
      no_notify: true,
      outlive_parent: false,
      name: "reviewer",
    });
    const labels = params.labels as Record<string, string>;
    expect(labels["herdr.space"]).toMatch(/^world-r[0-9a-f]{12}$/);
    expect(labels["herdr.tab"]).toMatch(/^world-b[0-9a-f]{12}$/);
    expect(labels["herdr.seen"]).toBe("0");
    // The app shows these names, not the IDs above.
    expect(labels.where).toBe("Review / Reviewer");
    // The app adopts it by those labels: it is live, kept and placed.
    const record = w.fake.terminal("t1")!;
    expect(record).toMatchObject({ keep: true, parent: null, notify: false });
    await w.synchronize();
    const { workspaces, tabs, panes } = await w.rows();
    expect(workspaces).toEqual([
      { workspace_id: room.workspace_id, label: "Review", focused: false },
    ]);
    expect(tabs).toEqual([
      expect.objectContaining({
        workspace_id: room.workspace_id,
        label: "Reviewer",
        tab_id: outcome.status === "sent" ? outcome.tab_id : "",
        // Town hands a desk to another runtime only when it counts one pane.
        pane_count: 1,
      }),
    ]);
    expect(panes).toEqual([
      expect.objectContaining({
        pane_id: "t1",
        workspace_id: room.workspace_id,
        agent: "claude",
        runtime: "herdr-core",
      }),
    ]);
  });

  test("World names the session of a harness that accepts one, unless the arguments pick one", async () => {
    const w = await world();
    const room = await createCoreRoom(w.lease(), w.topology, "Work");
    const launch = (kind: string, args: string[] = []) =>
      launchCore(
        w.lease(),
        {
          workspaceId: room.workspace_id,
          kind,
          label: kind,
          args: () => args,
          text: "",
        },
        { topology: w.topology, resolveExecutable },
      );
    await launch("claude");
    await launch("pi");
    await launch("codex");
    await launch("claude", [
      "--resume",
      "11111111-2222-4333-8444-555555555555",
    ]);
    await launch("claude", ["-c"]);
    await launch("pi", ["--session=/srv/example/s.jsonl"]);
    const argv = runs(w).map((run) =>
      (run.params as { argv: string[] }).argv.slice(4),
    );
    expect(argv[0]).toEqual([
      "/opt/example/bin/claude",
      "--session-id",
      expect.stringMatching(UUID),
    ]);
    expect(argv[1]).toEqual([
      "/opt/example/bin/pi",
      "--session-id",
      expect.stringMatching(UUID),
    ]);
    // A fresh ID per launch: two agents never share a conversation.
    expect(argv[0]![2]).not.toBe(argv[1]![2]);
    expect(argv[2]).toEqual(["/opt/example/bin/codex"]);
    expect(argv[3]).toEqual([
      "/opt/example/bin/claude",
      "--resume",
      "11111111-2222-4333-8444-555555555555",
    ]);
    expect(argv[4]).toEqual(["/opt/example/bin/claude", "-c"]);
    expect(argv[5]).toEqual([
      "/opt/example/bin/pi",
      "--session=/srv/example/s.jsonl",
    ]);
  });

  test("a room created in a folder starts its terminals there and shows it", async () => {
    const w = await world();
    const room = await createCoreRoom(
      w.lease(),
      w.topology,
      "Site",
      "/srv/example/site",
    );
    await launchCore(
      w.lease(),
      { workspaceId: room.workspace_id, kind: null, label: "", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    expect(runs(w)[0]!.params).toMatchObject({ cwd: "/srv/example/site" });
    await w.synchronize();
    expect((await w.rows()).workspaces).toContainEqual(
      expect.objectContaining({
        workspace_id: room.workspace_id,
        cwd: "/srv/example/site",
      }),
    );
  });

  test("a plain shell starts unplaced in the app, but in World's room", async () => {
    const w = await world();
    const room = await createCoreRoom(w.lease(), w.topology, "Ops");
    const outcome = await launchCore(
      w.lease(),
      { workspaceId: room.workspace_id, kind: null, label: "", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "started", placed: false });
    expect(runs(w)[0]!.params).toMatchObject({
      argv: [],
      keep: false,
      labels: {},
      no_parent: true,
    });
    await w.synchronize();
    expect((await w.rows()).panes).toEqual([
      expect.objectContaining({
        pane_id: "t1",
        workspace_id: room.workspace_id,
      }),
    ]);
  });

  test("a harness that is not installed starts nothing", async () => {
    const w = await world();
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "codex",
        label: "x",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async () => {
          throw new Error("no codex executable was found");
        },
      },
    );
    expect(outcome).toMatchObject({ status: "failed" });
    expect(runs(w)).toHaveLength(0);
  });

  test("a name taken meanwhile is refused by core and the next is used", async () => {
    const w = await world();
    w.fake.create({ name: "reviewer" });
    await w.synchronize();
    // World's view of taken names is one cut; core is the judge.
    w.fake.create({ name: "reviewer-2" });
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "codex",
        label: "Reviewer",
        text: "",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "started" });
    expect(runs(w).map((c) => (c.params as { name: string }).name)).toEqual([
      "reviewer-2",
      "reviewer-3",
    ]);
  });

  test("a lost reply is uncertain and never retried", async () => {
    const w = await world();
    w.fake.dropNextWriteReply = true;
    const lease = w.lease();
    const pending = launchCore(
      lease,
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "codex",
        label: "x",
        text: "",
      },
      { topology: w.topology, resolveExecutable },
    );
    await until(() => runs(w).length === 1);
    // The connection ends while the reply is outstanding.
    w.fake.kill(w.socket);
    expect(await pending).toMatchObject({ status: "uncertain" });
    expect(runs(w)).toHaveLength(1);
  });

  test("a launch into the main room records it and leads with that room", async () => {
    const w = await world();
    w.fake.create({ argv: ["/bin/sh"] });
    await w.synchronize();
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "codex",
        label: "Builder",
        text: "",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(runs(w)[0]!.params).toMatchObject({
      labels: { "herdr.space": "world-main" },
    });
    expect(outcome).toMatchObject({ workspace_id: CORE_UNPLACED_WORKSPACE });
    await w.synchronize();
    const rows = await w.rows();
    expect(rows.workspaces.map((r) => r.workspace_id)).toEqual([
      CORE_UNPLACED_WORKSPACE,
    ]);
    expect(rows.tabs.map((t) => t.label)).toEqual(["example-host", "Builder"]);
  });

  test("a launch into an app space keeps the app's name for the room World records", async () => {
    const w = await world();
    const app = w.fake.create({
      argv: ["/bin/sh"],
      labels: { "herdr.space": "s1", "herdr.tab": "c1", where: "web / one" },
    });
    await w.synchronize();
    const outcome = await launchCore(
      w.lease(),
      { workspaceId: "hc:space:s1", kind: "codex", label: "Builder", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "started", placed: true });
    expect(runs(w)[0]!.params).toMatchObject({
      labels: { where: "web / Builder" },
    });
    // The app's own terminal ends: World's room still reads as the app's.
    w.fake.remove(app);
    await w.synchronize();
    const rows = await w.rows();
    expect(rows.workspaces).toEqual([
      { workspace_id: "hc:space:s1", label: "web", focused: false },
    ]);
  });

  test("a launch into an unnamed app space never writes World's derived name to core", async () => {
    const w = await world();
    const app = w.fake.create({
      argv: ["/bin/sh"],
      cwd: "/srv/example/api",
      labels: { "herdr.space": "s1", "herdr.tab": "c1" },
    });
    await w.synchronize();
    expect((await w.rows()).workspaces).toMatchObject([
      {
        workspace_id: "hc:space:s1",
        label: "api",
        label_derived_from: "folder",
      },
    ]);
    const outcome = await launchCore(
      w.lease(),
      { workspaceId: "hc:space:s1", kind: "codex", label: "Builder", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "started", placed: true });
    expect(runs(w)[0]!.params).toMatchObject({
      labels: {
        where: "Herdr space / Builder",
        "herdr-world.unnamed-space": "1",
      },
    });
    // Its generic caption is no name: the room stays derived after the app's
    // terminal ends.
    w.fake.remove(app);
    await w.synchronize();
    const [room] = (await w.rows()).workspaces;
    expect(room).toMatchObject({ workspace_id: "hc:space:s1" });
    expect(room).toMatchObject({ label: "api", label_derived_from: "folder" });
  });

  test("a core that offers no writes refuses without sending anything", async () => {
    const w = await world({ observeOnly: true });
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: CORE_UNPLACED_WORKSPACE,
        kind: "codex",
        label: "x",
        text: "",
      },
      { topology: w.topology, resolveExecutable },
    );
    expect(outcome).toMatchObject({ status: "failed" });
    expect((outcome as { message: string }).message).toContain(
      "does not offer terminal.run",
    );
    expect(runs(w)).toHaveLength(0);
  });
});

describe("kills name every native descendant (M7)", () => {
  /** A parent in one room; a child that dies with it and one that outlives it, in another. */
  async function family() {
    const w = await world();
    const a = await createCoreRoom(w.lease(), w.topology, "A");
    const b = await createCoreRoom(w.lease(), w.topology, "B");
    const launch = (workspaceId: string, label: string) =>
      launchCore(
        w.lease(),
        { workspaceId, kind: "claude", label, text: "" },
        { topology: w.topology, resolveExecutable },
      );
    await launch(a.workspace_id, "Lead");
    // The lead's own sub-agents, started with `hc run` inside it.
    const dies = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "helper",
    });
    const outlives = w.fake.create({
      parent: "t1",
      die_with_parent: false,
      name: "server",
    });
    const grandchild = w.fake.create({
      parent: dies,
      die_with_parent: true,
      name: "tests",
    });
    await launch(b.workspace_id, "Other");
    await w.synchronize();
    return { w, a, b, dies, outlives, grandchild };
  }

  test("the plan names dying descendants with their rooms, not the one that outlives", async () => {
    const { w, dies, grandchild } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    expect(plan.roots.map((r) => [r.address, r.label, r.room])).toEqual([
      ["t1", "lead", "A"],
    ]);
    expect(
      plan.descendants.map((d) => [d.address, d.parent, d.label, d.room]),
    ).toEqual([
      [dies, "t1", "helper", "A"],
      [grandchild, dies, "tests", "A"],
    ]);
  });

  test("a confirmed kill ends exactly the confirmed set", async () => {
    const { w, dies, outlives, grandchild } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    const outcome = await killCore(w.lease(), ["t1"], confirmAll(plan));
    expect(outcome).toEqual({ killed: ["t1"], uncertain: [], alsoEnded: [] });
    const kills = w.fake.calls.filter((c) => c.method === "terminal.kill");
    expect(kills.map((c) => c.params)).toEqual([{ terminal: "t1" }]);
    for (const address of ["t1", dies, grandchild])
      expect(w.fake.terminal(address)!.state).toBe("finished");
    expect(w.fake.terminal(outlives)!.state).toBe("live");
    expect(w.fake.terminal("t5")!.state).toBe("live");
  });

  test("a child core starts while it handles the kill is named, not hidden (Q11)", async () => {
    // The review's repro: core has no conditional kill, so a die-with-parent
    // child started after World's last check ends with its parent.
    const { w, dies, grandchild } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    let late = "";
    w.fake.onCall = (method) => {
      if (method !== "terminal.kill" || late) return;
      late = w.fake.create({
        parent: "t1",
        die_with_parent: true,
        name: "late",
      });
    };
    const outcome = await killCore(w.lease(), ["t1"], confirmAll(plan));
    w.fake.onCall = null;
    expect(outcome.killed).toEqual(["t1"]);
    expect(w.fake.terminal(late)!.state).toBe("finished");
    // Only the unconfirmed one is named; the confirmed cascade is not.
    expect(outcome.alsoEnded).toEqual([
      { address: late, name: "late", remote: false },
    ]);
    expect(outcome.alsoEnded.map((t) => t.address)).not.toContain(dies);
    expect(outcome.alsoEnded.map((t) => t.address)).not.toContain(grandchild);
  });

  test("a terminal that ended before the kill is never named as also ended", async () => {
    const { w, dies } = await family();
    const earlier = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "earlier",
    });
    w.fake.finish(earlier, "killed");
    await w.synchronize();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    const outcome = await killCore(w.lease(), ["t1"], confirmAll(plan));
    expect(outcome.alsoEnded).toEqual([]);
    expect(w.fake.terminal(dies)!.state).toBe("finished");
  });

  test("a child started after the confirmation refuses the kill, with the new plan", async () => {
    const { w } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    const late = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "late",
    });
    await w.synchronize();
    const refused = await killCore(w.lease(), ["t1"], confirmAll(plan)).catch(
      (error) => error,
    );
    expect(refused).toBeInstanceOf(CoreOperationRefused);
    expect(refused.message).toContain("late would end too");
    expect(
      (refused as CoreOperationRefused).plan!.descendants.map((d) => d.address),
    ).toContain(late);
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
    expect(w.fake.terminal("t1")!.state).toBe("live");
  });

  test("a replaced program is not the one confirmed", async () => {
    const { w } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    // Kept: its program was lost and core put a shell at the address.
    w.fake.replaceWithShell("t1");
    await w.synchronize();
    await expect(killCore(w.lease(), ["t1"], confirmAll(plan))).rejects.toThrow(
      "running a different program",
    );
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
  });

  test("a replacement that reuses the pid is still not the one confirmed", async () => {
    const { w } = await family();
    const worker = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "worker",
      argv: ["/opt/example/bin/codex"],
    });
    await w.synchronize();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    const pid = w.fake.terminal(worker)!.pid;
    // The sub-agent is lost; its kept shell happens to get the same pid.
    w.fake.replaceWithShell(worker, { reusePid: true });
    await w.synchronize();
    expect(w.fake.terminal(worker)!.pid).toBe(pid);
    await expect(killCore(w.lease(), ["t1"], confirmAll(plan))).rejects.toThrow(
      "worker is running a different program",
    );
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
  });

  test("a replacement with the same pid and argv is still not the one confirmed", async () => {
    const { w } = await family();
    // A kept shell: its replacement is a shell too, with the same pid.
    const shell = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "shell",
      argv: ["/bin/sh"],
    });
    await w.synchronize();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    const before = w.fake.terminal(shell)!;
    const [pid, argv] = [before.pid, [...before.argv]];
    w.fake.replaceWithShell(shell, { reusePid: true });
    await w.synchronize();
    expect(w.fake.terminal(shell)!.pid).toBe(pid);
    expect(w.fake.terminal(shell)!.argv).toEqual(argv);
    await expect(killCore(w.lease(), ["t1"], confirmAll(plan))).rejects.toThrow(
      "shell is running a different program",
    );
    expect(w.fake.calls.some((c) => c.method === "terminal.kill")).toBe(false);
  });

  test("a confirmation from another core is refused", async () => {
    const { w } = await family();
    const plan = await planCoreKill(w.lease(), ["t1"]);
    await expect(
      killCore(w.lease(), ["t1"], {
        ...confirmAll(plan),
        coreId: "another-core",
      }),
    ).rejects.toThrow("replaced");
  });

  test("closing a room confirms and ends everything it shows, then forgets it", async () => {
    const { w, a, outlives } = await family();
    const plan = await planCoreKill(
      w.lease(),
      (await w.rows()).panes
        .filter((p) => p.workspace_id === a.workspace_id)
        .map((p) => p.pane_id),
    );
    // The room shows the lead and all three of its sub-agents (they join it).
    expect(plan.roots.map((r) => r.address)).toEqual(["t1", "t2", "t3", "t4"]);
    const outcome = await closeCoreRoom(
      w.lease(),
      w.topology,
      a.workspace_id,
      confirmAll(plan),
    );
    expect(outcome.uncertain).toEqual([]);
    expect(w.fake.terminal(outlives)!.state).toBe("finished");
    await w.synchronize();
    expect(
      (await w.rows()).workspaces.map((r) => r.workspace_id),
    ).not.toContain(a.workspace_id);
  });
});

describe("World's rooms of a core (M1)", () => {
  test("rooms are World's: created empty, renamed and ordered in its SQLite", async () => {
    const w = await world();
    const one = await createCoreRoom(w.lease(), w.topology, "One");
    const two = await createCoreRoom(w.lease(), w.topology, "Two");
    await renameCoreRoom(w.lease(), w.topology, one.workspace_id, "First");
    expect((await w.rows()).workspaces).toEqual([
      { workspace_id: one.workspace_id, label: "First", focused: false },
      { workspace_id: two.workspace_id, label: "Two", focused: false },
    ]);
    // Nothing about it reached core.
    expect(
      w.fake.calls.filter((c) => c.method.startsWith("terminal.")),
    ).toEqual([]);
    expect(w.changes.length).toBeGreaterThan(0);
  });

  test("an app space is the app's to rename or close", async () => {
    const w = await world();
    w.fake.create({
      argv: ["claude"],
      labels: { "herdr.space": "s1", "herdr.tab": "c1", where: "web / a" },
    });
    await w.synchronize();
    await expect(
      renameCoreRoom(w.lease(), w.topology, "hc:space:s1", "x"),
    ).rejects.toThrow("rename it in the app");
    await expect(
      closeCoreRoom(w.lease(), w.topology, "hc:space:s1", {
        coreId: w.fake.coreId,
        terminals: [],
      }),
    ).rejects.toThrow("close it in the app");
  });

  test("a launch into an app space joins it there, shells included", async () => {
    const w = await world();
    w.fake.create({
      argv: ["claude"],
      labels: { "herdr.space": "s1", "herdr.tab": "c1", where: "web / a" },
    });
    await w.synchronize();
    await launchCore(
      w.lease(),
      { workspaceId: "hc:space:s1", kind: "codex", label: "Two", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    await launchCore(
      w.lease(),
      { workspaceId: "hc:space:s1", kind: null, label: "Sh", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    expect(runs(w)[0]!.params).toMatchObject({
      labels: { "herdr.space": "s1" },
    });
    expect(runs(w)[1]!.params).toMatchObject({ labels: {} });
    await w.synchronize();
    const rows = await w.rows();
    expect(rows.workspaces).toEqual([
      { workspace_id: "hc:space:s1", label: "web", focused: false },
    ]);
    expect(rows.panes.map((p) => [p.pane_id, p.workspace_id])).toEqual([
      ["t1", "hc:space:s1"],
      ["t2", "hc:space:s1"],
      ["t3", "hc:space:s1"],
    ]);
  });

  test("a terminal that ended leaves its tab on the next layout change", async () => {
    const w = await world();
    const room = await createCoreRoom(w.lease(), w.topology, "R");
    await launchCore(
      w.lease(),
      { workspaceId: room.workspace_id, kind: "codex", label: "x", text: "" },
      { topology: w.topology, resolveExecutable },
    );
    w.fake.finish("t1");
    await w.synchronize();
    expect((await w.rows()).tabs).toEqual([]);
    await createCoreRoom(w.lease(), w.topology, "S");
    expect(w.topology.get(w.fake.coreId).rooms.flatMap((r) => r.tabs)).toEqual(
      [],
    );
  });
});
