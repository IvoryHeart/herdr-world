import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestService } from "./testing/services";
import {
  AcquisitionClock,
  AcquisitionHost,
} from "./testing/shared-acquisition-runtime";
import {
  SocketBrowser,
  StoreBrowser,
} from "./testing/composed-acquisition-clients";
import { sortAgentPanes } from "../../../web/src/agentOrder";
import { deskSessionFingerprint } from "../world/desk-observation";
import {
  agentPane,
  gitStatus,
  layoutFor,
} from "../../../web/src/store/testing/syntheticHosts";
import { configureServerLogger } from "../utils/logger";

const focused = new Set([
  "workspace.list",
  "tab.list",
  "pane.list",
  "agent.list",
  "pane.layout",
  "bridge.status",
  "connections.list",
]);
const observations = (state: any, since: number, owner?: string) =>
  state.requests
    .slice(since)
    .filter(
      (request: any) =>
        focused.has(request.method) &&
        (owner === undefined || request.connection_id === owner),
    );

test("composed shared acquisition: real Bridge/store and second socket over two runtimes", async () => {
  configureServerLogger("error");
  const top = mkdtempSync(join(tmpdir(), "world-shared-acquisition-")),
    root = join(top, "data");
  mkdirSync(root, { mode: 0o700 });
  const hosts = new Map(
    ["alpha", "beta"].map((id) => [id, new AcquisitionHost(id)]),
  );
  const alpha = hosts.get("alpha")!,
    beta = hosts.get("beta")!;
  const profiles = [...hosts.keys()].map((id) => ({
    id,
    label: id,
    type: "local",
    control_socket_path: join(top, `${id}-control.sock`),
    client_socket_path: join(top, `${id}-render.sock`),
    auto_connect: true,
  }));
  writeFileSync(
    join(root, "connections.json"),
    JSON.stringify({ version: 2, default_connection_id: "alpha", profiles }),
    { mode: 0o600 },
  );
  const clock = new AcquisitionClock();
  const started = await startTestService(
    root,
    {
      password: undefined,
      authRequired: false,
      taskNotificationSource: "status",
      hasExplicitSocketPath: false,
      hasExplicitClientSocketPath: false,
    },
    {},
    {
      clock: { now: () => 1000000 + clock.now, monotonic: () => clock.now },
      scheduler: clock,
      adapters: {
        herdr: {
          createRuntime: (options) =>
            hosts.get(options.identity!.id)!.runtime(options),
        },
      },
    },
  );
  const browser = new StoreBrowser();
  let second: SocketBrowser | undefined;
  let unblock: (() => void) | undefined, observing: Promise<void> | undefined;
  const owner = (id: string) => ({
    connection_id: id,
    connection_generation:
      hosts.get(id)!.instances[hosts.get(id)!.instances.length - 1]!
        .connectionGeneration!,
  });
  const wait = (path: (string | number)[], value: unknown) =>
    browser.command("wait", { path, value });
  try {
    await started.connected;
    let state = await browser
      .command("boot", { base: started.base })
      .catch(async (error) => {
        const current = await browser.command("snapshot");
        console.info(
          "Composed bootstrap",
          JSON.stringify({
            status: current.state.status,
            connections: current.state.connections.map((owner: any) => ({
              id: owner.id,
              state: owner.state,
              generation: owner.generation,
            })),
            active: current.state.activeConnectionId,
            panes: current.alpha.panes.length,
            requests: current.requests.map((request: any) => [
              request.method,
              request.connection_id,
            ]),
          }),
        );
        throw error;
      });
    expect(state.state.activeConnectionId).toBe("alpha");
    expect(state.alpha.panes[1].last_activity_at).toBe(1000);
    const idleFirst = (value: any) =>
      sortAgentPanes(
        value.alpha.panes.filter(
          (pane: any) => pane.agent && pane.agent_status === "idle",
        ),
        [],
        "attention",
      )[0]!.pane_id;
    expect(idleFirst(state)).toBe("p-alpha-b");
    expect(state.beta.panes).toHaveLength(5);
    expect(state.state.bridgeStatus.clients).toBe(1);
    second = new SocketBrowser(started.base);
    expect((await second.hello).capabilities.world_shared_acquisition).toBe(
      true,
    );
    await wait(["state", "bridgeStatus", "clients"], 2);
    await second.call("world.focused.observe", {
      owners: [owner("alpha"), owner("beta")],
    });
    await Promise.all([
      second.relist(owner("alpha")),
      second.relist(owner("beta")),
    ]);
    state = await browser.command("refresh", { id: "alpha" });
    state = await browser.command("refresh", { id: "beta" });
    await browser.command("fence");
    expect(
      second.controls.filter((frame) => frame.type === "world_agent_activity"),
    ).toEqual([]);

    // Both real sockets hold both hosts; one physical activity read per host.
    const stats = [alpha.stats, beta.stats];
    const since = state.requests.length,
      frames = second.controls.length;
    await clock.advance(5000);
    await second.fence();
    state = await browser.command("fence");
    expect([alpha.stats - stats[0]!, beta.stats - stats[1]!]).toEqual([1, 1]);
    expect(
      second.controls
        .slice(frames)
        .filter((frame) => frame.type === "world_focused_changed"),
    ).toEqual([]);
    expect(observations(state, since)).toEqual([]);

    // Session-file activity arrives through the composed cache/observer wire,
    // updates both holders and never turns into a browser topology re-list.
    const activity = second.next(
      (frame) =>
        frame.type === "world_agent_activity" &&
        frame.connection_id === "alpha",
    );
    alpha.model.activity.set("p-alpha-a", 3500);
    const activityStats = alpha.stats;
    await clock.advance(5000);
    const reading = await activity;
    expect(
      reading.agents.find((agent: any) => agent.pane_id === "p-alpha-a")
        .last_activity_at,
    ).toBe(3500);
    state = await wait(["alpha", "panes", 1, "last_activity_at"], 3500);
    expect(alpha.stats - activityStats).toBe(1);
    expect(idleFirst(state)).toBe("p-alpha-a");
    expect(observations(state, since)).toEqual([]);

    const idleAt = state.requests.length;
    state = await browser.command("advance", { ms: 60000 });
    expect(observations(state, idleAt)).toEqual([]);

    // Terminal output alone is excluded from the real observer's comparison.
    Object.assign(alpha.pane("shell"), { scroll: { offset: 12 } });
    const outputFrames = second.controls.length,
      outputRequests = state.requests.length;
    await clock.advance(5000);
    await second.fence();
    state = await browser.command("fence");
    expect(
      second.controls
        .slice(outputFrames)
        .filter((frame) => frame.type === "world_focused_changed"),
    ).toEqual([]);
    expect(observations(state, outputRequests)).toEqual([]);

    // An unmarked caller has already seen the quiet commit, but cannot consume
    // either holder's focused notice. Only alpha's store is re-listed.
    alpha.model.workspaces[0]!.worktree!.git_status = gitStatus(
      "feature",
      true,
    );
    alpha.model.endpointAvailability["term-alpha-b"] = {
      methods: ["pane.scroll"],
      capabilities: [],
    };
    await second.call("workspace.list", {}, owner("alpha"));
    const quietNotice = second.next(
      (frame) =>
        frame.type === "world_focused_changed" &&
        frame.connection_id === "alpha",
    );
    const quietSince = state.requests.length;
    await clock.advance(5000);
    await quietNotice;
    await browser.command("flush");
    state = await wait(
      ["alpha", "workspaces", 0, "worktree", "git_status", "branch"],
      "feature",
    );
    expect(state.alpha.endpointAvailability["term-alpha-b"].methods).toEqual([
      "pane.scroll",
    ]);
    expect(observations(state, quietSince, "beta")).toEqual([]);
    const marked = state.requests
      .slice(quietSince)
      .filter((request: any) =>
        ["workspace.list", "tab.list", "pane.list", "agent.list"].includes(
          request.method,
        ),
      );
    expect(
      marked.map((request: any) => [
        request.method,
        request.focused_observation,
      ]),
    ).toEqual([
      ["workspace.list", true],
      ["tab.list", true],
      ["pane.list", true],
      ["agent.list", true],
    ]);
    await second.relist(owner("alpha"));

    // Real forwarded events keep status, inactive navigation and completions.
    state = await browser.command("navigation", {
      pane: "p-alpha-a",
      workspace: "w-alpha",
    });
    const navigation = (value: any) => ({
      active: value.state.activeConnectionId,
      selected: value.state.selectedPaneId,
      pending: value.state.pendingFocusWorkspaceId,
      layout: value.state.layout,
    });
    const beforeNavigation = navigation(state);
    beta.pane("status").agent_status = "working";
    beta.emit("pane.agent_status_changed", {
      pane_id: "p-beta-status",
      workspace_id: "w-beta",
      agent_status: "working",
    });
    await browser.command("flush");
    state = await wait(["beta", "panes", 3, "agent_status"], "working");
    expect(navigation(state)).toEqual(beforeNavigation);
    for (const pane of beta.model.panes)
      pane.focused = pane.pane_id === "p-beta-a";
    beta.model.layouts.set(
      "t-beta",
      layoutFor("beta", "t-beta", beta.model.panes, 80),
    );
    beta.emit("pane.focused", { pane_id: "p-beta-a", workspace_id: "w-beta" });
    await browser.command("flush");
    await wait(["beta", "panes", 1, "focused"], true);
    state = await browser.command("refresh", { id: "beta" });
    expect(navigation(state)).toEqual(beforeNavigation);
    await second.relist(owner("beta"));
    const eventFrames = second.controls.length,
      eventSince = state.requests.length;
    await clock.advance(5000);
    await second.fence();
    state = await browser.command("fence");
    expect(
      second.controls
        .slice(eventFrames)
        .filter((frame) => frame.type === "world_focused_changed"),
    ).toEqual([]);
    expect(observations(state, eventSince)).toEqual([]);

    beta.pane("task").agent_status = "idle";
    beta.emit("pane.agent_status_changed", {
      pane_id: "p-beta-task",
      workspace_id: "w-beta",
      agent_status: "idle",
    });
    await browser.command("flush");
    state = await wait(["completions", "beta"], 1);
    beta.emit("pane.updated", { pane: beta.pane("a") });
    await browser.command("flush");
    state = await browser.command("refresh", { id: "beta" });
    expect(state.completions.beta).toBe(1);
    const wider = layoutFor("alpha", "t-alpha", alpha.model.panes, 120);
    alpha.model.layouts.set("t-alpha", wider);
    alpha.emit("layout.updated", { layout: wider });
    await browser.command("flush");
    state = await wait(["alpha", "layout", "area", "width"], 120);

    alpha.model.workspaces[0]!.label = "After resynchronization";
    alpha.emit("session.resync_required", {});
    await browser.command("flush");
    state = await wait(
      ["alpha", "workspaces", 0, "label"],
      "After resynchronization",
    );

    // Browser-local attachment publication remains immediate, without a read.
    const attachmentSince = state.requests.length;
    const advertisement = { methods: ["pane.scroll"], capabilities: [] };
    state = await browser.command("attachment", {
      terminal: "term-alpha-a",
      advertisement,
    });
    expect(state.alpha.endpointAvailability["term-alpha-a"]).toEqual(
      advertisement,
    );
    expect(observations(state, attachmentSince)).toEqual([]);
    alpha.model.endpointAvailability["term-alpha-a"] = advertisement;
    await browser.command("refresh", { id: "alpha" });
    await second.relist(owner("alpha"));

    // A failed browser event re-list retries through the real RPC error reply,
    // not a simulator and not a successful periodic poll.
    alpha.failNext.add("workspace.list");
    alpha.emit("pane.updated", { pane: alpha.pane("a") });
    await browser.command("flush");
    await wait(["alpha", "error"], "synthetic transient read failure");
    state = await browser.command("snapshot");
    const retrySince = state.requests.length;
    await browser.command("advance", { ms: 5000 });
    state = await wait(["alpha", "error"], null);
    await browser.command("advance", { ms: 15000 });
    state = await browser.command("snapshot");
    expect(
      observations(state, retrySince).filter(
        (request: any) => request.method === "workspace.list",
      ),
    ).toHaveLength(1);

    // Whole declarations hide only one browser; the second continues alone.
    await browser.command("visible", { visible: false });
    const hidden = await browser.command("snapshot"),
      hiddenSince = hidden.requests.length;
    const changed = second.next(
      (frame) =>
        frame.type === "world_agent_activity" && frame.connection_id === "beta",
    );
    beta.model.activity.set("p-beta-a", 6000);
    await clock.advance(5000);
    await changed;
    state = await browser.command("fence");
    expect(state.beta.panes[1].last_activity_at).not.toBe(6000);
    expect(observations(state, hiddenSince)).toEqual([]);
    beta.model.workspaces[0]!.worktree!.git_status = gitStatus("shown", true);
    await browser.command("visible", { visible: true });
    await wait(
      ["beta", "workspaces", 0, "worktree", "git_status", "branch"],
      "shown",
    );
    state = await wait(["beta", "panes", 1, "last_activity_at"], 6000);
    expect(state.state.activeConnectionId).toBe("alpha");

    // Catalogue/profile notices use the actual composed profile service.
    await second.call("connections.disconnect", { id: "beta" });
    await second.call("connections.update", {
      id: "beta",
      profile: { ...profiles[1], label: "Renamed beta" },
    });
    state = await wait(["state", "connections", 1, "label"], "Renamed beta");
    expect(state.state.activeConnectionId).toBe("alpha");

    // Real Desk declarations share one physical screen and receipt reading.
    const pane = alpha.pane("a");
    const target = {
      ...owner("alpha"),
      pane_id: pane.pane_id,
      session: deskSessionFingerprint(pane.agent_session),
    };
    const declaration = {
      screens: [target],
      receipts: [{ ...target, trigger: "stop-a" }],
    };
    await browser.command("call", {
      method: "world.desk.observe",
      params: declaration,
    });
    await second.call("world.desk.observe", declaration);
    const screen = second.next(
      (frame) => frame.type === "world_desk_reads" && frame.kind === "screen",
    );
    const turn = second.next(
      (frame) => frame.type === "world_desk_reads" && frame.kind === "receipt",
    );
    const storeScreen = browser.command("waitControl", {
      type: "world_desk_reads",
      kind: "screen",
    });
    await clock.advance(0);
    const [screenFrame, turnFrame, storeFrame] = await Promise.all([
      screen,
      turn,
      storeScreen,
    ]);
    expect(alpha.screens).toBe(1);
    expect(alpha.turns).toBe(1);
    expect(storeFrame).toEqual(screenFrame);
    expect(turnFrame.trigger).toBe("stop-a");
    await browser.command("call", {
      method: "world.desk.observe",
      params: { screens: [], receipts: [] },
    });
    const nextScreen = second.next(
      (frame) => frame.type === "world_desk_reads" && frame.kind === "screen",
    );
    // Unchanged results are suppressed, so change the source for this read.
    alpha.screenText = "changed shared screen";
    await clock.advance(4000);
    await nextScreen;
    expect(alpha.screens).toBe(2);
    await second.call("world.desk.observe", { screens: [], receipts: [] });
    const deskReads = [alpha.screens, alpha.turns];
    await clock.advance(4000);
    expect([alpha.screens, alpha.turns]).toEqual(deskReads);

    // Retire a generation with an observer in flight, then admit the replacement
    // from the catalogue. Neither the old result nor late controls can publish.
    const oldOwner = owner("alpha"),
      gate = Promise.withResolvers<void>(),
      arrived = Promise.withResolvers<void>();
    unblock = gate.resolve;
    alpha.pending = {
      method: "workspace.list",
      arrived: arrived.resolve,
      promise: gate.promise,
    };
    observing = clock.advance(5000);
    await arrived.promise;
    await second.call("connections.disconnect", { id: "alpha" });
    const added = agentPane("alpha", "new", "codex", "idle");
    alpha.model.panes.push(added);
    alpha.pane("task").agent_status = "idle";
    await second.call("connections.connect", { id: "alpha" });
    await browser.command("flush");
    await wait(
      ["alpha", "serverRuntimeGeneration"],
      owner("alpha").connection_generation,
    );
    state = await wait(["alpha", "panes", 5, "pane_id"], added.pane_id);
    expect(state.completions.alpha).toBe(0);
    const retiredAt = state.controls.length;
    gate.resolve();
    await observing;
    observing = undefined;
    state = await browser.command("fence");
    expect(
      state.controls
        .slice(retiredAt)
        .filter(
          (frame: any) =>
            frame.connection_id === "alpha" &&
            frame.connection_generation === oldOwner.connection_generation &&
            ["world_focused_changed", "world_agent_activity"].includes(
              frame.type,
            ),
        ),
    ).toEqual([]);
    const staleSince = state.requests.length;
    alpha.frame({ type: "world_focused_changed", ...oldOwner });
    alpha.frame({
      type: "world_agent_activity",
      ...oldOwner,
      agents: [
        {
          pane_id: "p-alpha-a",
          terminal_id: "term-alpha-a",
          agent: "claude",
          session: "s-alpha-a",
          last_activity_at: 99000,
        },
      ],
    });
    await browser.command("flush");
    state = await browser.command("fence");
    expect(state.alpha.panes[1].last_activity_at).toBe(3500);
    expect(
      observations(state, staleSince).filter(
        (request: any) =>
          request.connection_generation === oldOwner.connection_generation,
      ),
    ).toEqual([]);

    // Socket cleanup updates the real count. Last release stops acquisition.
    await second.close();
    second = undefined;
    await wait(["state", "bridgeStatus", "clients"], 1);
    await browser.command("visible", { visible: false });
    const released = [
      alpha.calls.length,
      beta.calls.length,
      alpha.stats,
      beta.stats,
    ];
    await clock.advance(20000);
    expect([
      alpha.calls.length,
      beta.calls.length,
      alpha.stats,
      beta.stats,
    ]).toEqual(released);
  } finally {
    unblock?.();
    try {
      await Promise.all([observing, browser.close(), second?.close()]);
    } finally {
      try {
        await started.service.stop();
      } finally {
        rmSync(top, { recursive: true, force: true });
        configureServerLogger("info");
      }
    }
  }
}, 40000);
