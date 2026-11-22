import { describe, expect, test } from "bun:test";
import { herdrRuntimeFixture } from "../../../server/src/adapters/testing/runtime";
import { CoreMirror } from "../../../server/src/herdr-core/mirror";
import {
  CoreFirstSight,
  coreRuntimeReader,
} from "../../../server/src/herdr-core/topology";
import { worldRuntimeRegistry } from "../../../server/src/world/runtime-registry";
import { WorldSnapshotService } from "../../../server/src/world/snapshot";
import { deskAgents, pollingTargets } from "./handoffs";
import { needsYouItems } from "./needsYou";
import {
  officeCreationActionState,
  spaceRoomActionCapabilities,
} from "./officeRoomActions";
import { WorldRuntimeStore } from "./runtimeStore";
import {
  buildWorldObject,
  CORE_VIEW_ONLY_REASON,
  type WorldLeafObject,
} from "./worldObject";
import { viewOnlyMessage } from "./viewOnly";
import { projectAgent } from "./officeAgent";
import { projectBoard } from "./board/boardModel";
import { projectWorldOffice } from "./herdrOfficeProjection";
import { inspectTownTerminal, townTargetActionable } from "./town/townOpen";
import {
  worldInspectorContext,
  worldIntentViews,
  worldNodeOpenView,
} from "./worldInspectorSelection";
import { CORE_APP_SPACE_REASON } from "./coreRooms";
import { worldSwitchTargets } from "./worldSwitchTargets";
import {
  chatOpeningPane,
  worldInspectorForNode,
} from "./worldTerminalPresentation";

/**
 * Core agents through World's real read path into the objects Town, Desk,
 * Board and Needs you render: the server snapshot service over both
 * runtimes, the browser's runtime store, then World objects.
 */

const placed = {
  "herdr.space": "s1",
  "herdr.tab": "c1",
  where: "web / review",
};
const coreTerminals = [
  {
    address: "t1",
    name: "reviewer",
    labels: placed,
    argv: ["claude"],
    state: "live",
    pid: 11,
    turn: 0,
    status: {
      state: "blocked",
      kind: "permission",
      app: "claude-code",
      msg: "Allow npm test?",
    },
  },
  {
    address: "t2",
    name: "builder",
    labels: placed,
    argv: ["codex"],
    state: "live",
    pid: 12,
    turn: 0,
    status: { state: "working", app: "codex" },
  },
  {
    address: "t3",
    name: "scout",
    labels: placed,
    argv: ["gemini"],
    state: "live",
    pid: 13,
    turn: 0,
    status: { state: "working" },
  },
  { address: "t4", labels: placed, argv: ["bash"], state: "live", pid: 14 },
];

const tuiRows: Record<string, unknown> = {
  "workspace.list": { workspaces: [{ workspace_id: "w1", label: "web" }] },
  "tab.list": {
    tabs: [{ tab_id: "w1:1", workspace_id: "w1", label: "review" }],
  },
  "pane.list": {
    panes: [
      ["p1", "claude", "blocked"],
      ["p2", "codex", "working"],
      ["p3", "gemini", "done"],
      ["p4", undefined, "unknown"],
    ].map(([pane_id, agent, agent_status]) => ({
      pane_id,
      terminal_id: pane_id,
      workspace_id: "w1",
      tab_id: "w1:1",
      ...(agent ? { agent } : {}),
      agent_status,
    })),
  },
  "agent.list": {
    agents: [
      ["p1", "claude", "reviewer"],
      ["p2", "codex", "builder"],
      ["p3", "gemini", "scout"],
    ].map(([pane_id, agent, name]) => ({
      pane_id,
      terminal_id: pane_id,
      agent,
      name,
    })),
  },
};

function lease<Runtime>(connectionId: string, runtime: Runtime) {
  return { connectionId, generation: 3, runtime, isCurrent: () => true };
}

function manager<Runtime>(id: string, runtime: Runtime) {
  return {
    list: () => [
      {
        id,
        label: id,
        source: "local-profile",
        is_default: id === "tui",
        state: "ready" as const,
        generation: 3,
      },
    ],
    has: (candidate: string) => candidate === id,
    status: () => ({
      id,
      label: id,
      source: "local-profile",
      is_default: false,
      state: "ready" as const,
      generation: 3,
    }),
    readyRuntimeLease: (candidate: string) =>
      candidate === id ? lease(id, runtime) : null,
  };
}

async function worldOf(coreStale = false, records = coreTerminals) {
  return buildWorldObject(await connectionsOf(coreStale, records));
}

async function connectionsOf(coreStale = false, records = coreTerminals) {
  const mirror = new CoreMirror();
  const sight = new CoreFirstSight();
  mirror.baseline(1, records);
  sight.observe("c0ffee", records);
  // Scout's turn ends while World watches: done until someone looks.
  const scout = { ...records[2]!, turn: 1, status: { state: "idle" } };
  mirror.apply({
    method: "missed",
    params: {
      seq: 2,
      terminals: [...records.slice(0, 2), scout, records[3]!],
    } as never,
  });
  const tui = {
    ...herdrRuntimeFixture({
      call: async (method: string) => tuiRows[method] ?? {},
    }),
  };
  const core = {
    operations: coreRuntimeReader({
      mirror,
      actionable: true,
      coreName: () => "example-host",
      firstSight: sight,
    }),
  };
  const registry = worldRuntimeRegistry(
    manager("tui", tui) as never,
    manager("box-core", core) as never,
  );
  const service = new WorldSnapshotService(registry);
  const response = JSON.parse(JSON.stringify(await service.snapshot()));
  // The browser holds no runtime lease for any connection here: a TUI host
  // goes stale without one; a core host never has one and stays live.
  const store = new WorldRuntimeStore(
    {
      call: async () => response,
      connection: () => ({ isCurrent: () => false }),
      onControl: () => () => {},
      onStatus: () => () => {},
    },
    async () => {},
  );
  await store.refresh();
  return store
    .get()
    .connections.map((c) =>
      coreStale && c.connectionId === "box-core" ? { ...c, stale: true } : c,
    );
}

const byName = (leaves: readonly WorldLeafObject[]) =>
  leaves
    .map((leaf) => [leaf.agentName ?? leaf.label, leaf.status])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe("core agents in World's views", () => {
  test("native alphabet agents retain Terminal and Files on their exact connection", async () => {
    const records = coreTerminals.map((t, i) => ({
      ...t,
      address: ["t19", "t1b", "t1c", "t1z"][i]!,
    }));
    const world = await worldOf(false, records);
    const agent = world.leaves.find((l) => l.nativeId === "t1b")!;
    expect(agent.watch).toEqual({
      connectionId: "box-core",
      generation: 3,
      address: "t1b",
    });
    expect(agent.capabilities.files).toBe(true);
    const stale = await worldOf(true, records);
    expect(
      stale.leaves.find((l) => l.nativeId === "t1b")?.watch,
    ).toBeUndefined();
  });

  test("the same agents as the TUI's, live and view-only, never stale", async () => {
    const world = await worldOf();
    const core = world.leaves.filter(
      (leaf) => leaf.connectionId === "box-core",
    );
    const tui = world.leaves.filter((leaf) => leaf.connectionId === "tui");
    expect(byName(core)).toEqual([
      ["builder", "working"],
      ["reviewer", "blocked"],
      ["scout", "done"],
      ["Terminal t4", "unknown"],
    ]);
    // The same names, harnesses and statuses as Herdr's TUI gives.
    expect(
      core.map((leaf) => [leaf.agentName, leaf.agentLabel, leaf.status]),
    ).toEqual(
      tui.map((leaf) => [leaf.agentName, leaf.agentLabel, leaf.status]),
    );
    expect(core[0]!.spaceLabel).toBe("web");
    expect(core[0]!.tabLabel).toBe("review");
    for (const leaf of core) {
      expect(leaf).toMatchObject({
        stale: false,
        actionable: false,
        viewOnly: CORE_VIEW_ONLY_REASON,
      });
      expect(leaf.capabilities.files).toBe(true);
      expect(leaf.capabilities.changes).toBe(true);
      expect(leaf.capabilities.openTerminal).toBe(false);
      // Its terminal can be watched on this connection generation only.
      expect(leaf.watch).toEqual({
        connectionId: "box-core",
        generation: 3,
        address: leaf.nativeId,
      });
    }
    expect(tui.some((leaf) => leaf.watch)).toBe(false);
  });

  test("a stale core connection's agents offer no watch", async () => {
    const world = await worldOf(true);
    const core = world.leaves.filter((l) => l.connectionId === "box-core");
    expect(core.length).toBeGreaterThan(0);
    expect(core.some((leaf) => leaf.watch)).toBe(false);
  });

  test("Board shows a live core host live, and a failed one stale", async () => {
    // A healthy core host is never TUI-actionable; World controls it through
    // world.core.*, so Board offers New workspace there, not Reconnect.
    const live = projectBoard(await worldOf()).hostByKey.get("box-core");
    expect(live?.stale).toBe(false);
    expect(live?.connectionState).toBe("ready");
    const failed = projectBoard(await worldOf(true)).hostByKey.get("box-core");
    expect(failed?.stale).toBe(true);
    // The TUI host here holds no runtime lease: stale, as before.
    expect(projectBoard(await worldOf()).hostByKey.get("tui")?.stale).toBe(
      true,
    );
  });

  test("Needs you lists the waiting core agent; Desk lists every core agent", async () => {
    const world = await worldOf();
    const items = needsYouItems(world, [], (leaf) => leaf.status === "done");
    const core = items.filter((item) => item.leaf?.connectionId === "box-core");
    expect(core.map((item) => [item.kind, item.leaf?.agentName])).toEqual([
      ["needs", "reviewer"],
      ["done", "scout"],
    ]);
    // Without a transcript, the program's own words say why it waits.
    expect(viewOnlyMessage(core[0]!.leaf!)).toBe("Allow npm test?");
    expect(
      deskAgents(world, new Map())
        .filter((leaf) => leaf.connectionId === "box-core")
        .map((leaf) => leaf.agentName),
    ).toEqual(["reviewer", "builder", "scout"]);
  });

  test("view-only core agents take no receipt or screen read slot", async () => {
    const world = await worldOf();
    const blocked = world.leaves.find(
      (leaf) => leaf.connectionId === "box-core" && leaf.status === "blocked",
    )!;
    const tui = (status: WorldLeafObject["status"]) =>
      world.leaves.find(
        (leaf) => leaf.connectionId === "tui" && leaf.status === status,
      )!;
    const crowd = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...blocked,
        id: `${blocked.id}-${index}`,
      }));
    // Receipts: 40 blocked core agents would fill every slot before a done TUI agent.
    expect(pollingTargets([...crowd(40), tui("done")])).toEqual([tui("done")]);
    // Screens: 16 blocked core agents would crowd out a working TUI agent.
    expect(pollingTargets([...crowd(16), tui("working")], 16)).toEqual([
      tui("working"),
    ]);
  });

  test("a core room takes agents; an app space stays the app's to manage", async () => {
    const world = await worldOf();
    const space = world.spaces.find((s) => s.connectionId === "box-core")!;
    expect(space.coreControl).toBe(true);
    // Never admitted to TUI paths: World starts and ends core terminals
    // only through world.core.*.
    expect(space.actionable).toBe(false);
    const actions = spaceRoomActionCapabilities(space);
    expect(actions).toEqual({
      createSeat: true,
      rename: false,
      close: false,
      core: true,
      worktrees: true,
      manageReason: CORE_APP_SPACE_REASON,
    });
    expect(
      officeCreationActionState(actions.createSeat, null, actions.viewOnly),
    ).toEqual({ visible: true, enabled: true, reason: null });
    // World's own rooms of a core, and its main room, are World's to manage.
    for (const nativeId of ["hc:room:r0123456789ab", "hc:unplaced"])
      expect(spaceRoomActionCapabilities({ ...space, nativeId })).toEqual({
        createSeat: true,
        rename: true,
        close: true,
        core: true,
        worktrees: true,
      });
    // A stale core room is history: nothing starts or ends there.
    expect(spaceRoomActionCapabilities(space, true)).toEqual({
      createSeat: false,
      rename: false,
      close: false,
    });
  });

  test("core agents keep the reason Chat and the terminal stay closed", async () => {
    const world = await worldOf();
    const leaf = world.leaves.find((l) => l.connectionId === "box-core")!;
    expect(leaf).toMatchObject({
      coreControl: true,
      actionable: false,
      viewOnly: CORE_VIEW_ONLY_REASON,
    });
    expect(leaf.capabilities.openTerminal).toBe(false);
    expect(leaf.capabilities.agentHistory).toBe(false);
  });

  test("a core agent's window has a Herdr agent's tabs: Chat, Terminal, Files, Changes", async () => {
    const world = await worldOf();
    const agent = world.leaves.find(
      (l) => l.connectionId === "box-core" && l.kind === "agent",
    )!;
    const plain = world.leaves.find(
      (l) => l.connectionId === "box-core" && l.kind === "terminal",
    )!;
    expect(worldIntentViews(agent)).toEqual([
      "history",
      "terminal",
      "files",
      "changes",
    ]);
    // The Agents-open setting applies as to a Herdr agent: Chat, or the
    // Terminal tab (core's watch, in the same window).
    expect(worldNodeOpenView(agent, "chat")).toBe("history");
    expect(worldNodeOpenView(agent, "terminal")).toBe("terminal");
    // A plain core terminal has no Chat, and opens on its Terminal.
    expect(worldIntentViews(plain)).toEqual(["terminal", "files", "changes"]);
    expect(worldNodeOpenView(plain, "chat")).toBe("terminal");
    // A stale core connection's agent opens nothing.
    const stale = await worldOf(true);
    const gone = stale.leaves.find(
      (l) => l.connectionId === "box-core" && l.kind === "agent",
    )!;
    expect(worldIntentViews(gone)).toEqual([]);
    // Town opens it (desk tap, Open chat, reception) though World only
    // watches it; Herdr's own reply path stays closed (canOpenInSpaces).
    const asAgent = (leaf: WorldLeafObject) =>
      leaf as WorldLeafObject & { kind: "agent" };
    const town = projectAgent(asAgent(agent), "room", "host", new Map());
    expect(town).toMatchObject({ coreChat: true, canOpenInSpaces: false });
    expect(
      projectAgent(asAgent(gone), "room", "host", new Map()).coreChat,
    ).toBe(undefined);
  });

  test("Town opens a live core desk, shell pane and agent; a stale one opens nothing", async () => {
    for (const coreStale of [false, true]) {
      const office = projectWorldOffice(await worldOf(coreStale), 0);
      const core = (key: string) => key.includes("box-core");
      const shell = office.paneRoster.find(
        ({ device }) => core(device.key) && !device.agentKey,
      )!.device;
      const agent = office.roster.find(({ agent }) => core(agent.key))!.agent;
      const desk = office.deskRoster.find(({ desk }) => core(desk.key))!.desk;
      // World cannot mark core work reviewed, which is no reason to refuse
      // an open (#1006).
      expect(shell.canOpenInSpaces).toBe(false);
      expect(shell.coreOpen).toBe(coreStale ? undefined : true);
      expect(desk.coreOpen).toBe(coreStale ? undefined : true);
      for (const key of [shell.key, agent.key, desk.key])
        expect(townTargetActionable(office, key)).toBe(!coreStale);
      const opened: string[] = [];
      await inspectTownTerminal(office, shell.key, (id) => {
        opened.push(id);
      });
      expect(opened).toEqual(coreStale ? [] : [shell.nodeId]);
    }
  });

  test("a core agent opened on Chat finds its pane while it waits to read the conversation", async () => {
    // Opening on Chat waits on Terminal until the conversation reads; the
    // wait watches the agent's pane. A core agent has no Herdr session, so
    // the pane must come from World's core observation (it was always
    // missing, and core agents stayed on Terminal).
    const connections = await connectionsOf();
    const agent = buildWorldObject(connections).leaves.find(
      (l) => l.connectionId === "box-core" && l.kind === "agent",
    )!;
    const opening = worldInspectorForNode(
      agent,
      worldNodeOpenView(agent, "chat")!,
      worldIntentViews(agent),
      worldInspectorContext(agent)!,
      { dock: "right", expanded: false, size: 520 },
    )!;
    expect(opening).toMatchObject({ view: "terminal", awaitChatSession: true });
    expect(chatOpeningPane(opening, [], connections)).toMatchObject({
      pane_id: agent.nativeId,
      runtime: "herdr-core",
    });
    // Never from a stale observation or another generation of the core.
    const stale = await connectionsOf(true);
    expect(chatOpeningPane(opening, [], stale)).toBeUndefined();
    expect(
      chatOpeningPane(
        { ...opening, runtimeGeneration: opening.runtimeGeneration + 1 },
        [],
        connections,
      ),
    ).toBeUndefined();
    // A core connection never falls back to Herdr panes of the same id.
    expect(
      chatOpeningPane(
        opening,
        [agent.pane],
        stale.filter((c) => c.connectionId !== "tui"),
      ),
    ).toBeUndefined();
    // A Herdr agent still reads its Herdr session (its host is stale here,
    // so the window is built by hand).
    const tui = buildWorldObject(connections).leaves.find(
      (l) => l.connectionId === "tui" && l.kind === "agent",
    )!;
    const tuiOpening = {
      ...opening,
      connectionId: tui.connectionId,
      runtimeGeneration: tui.generation,
      workspaceId: tui.workspaceId,
      tabId: tui.tabId,
      paneId: tui.nativeId,
      terminalId: tui.terminalId,
      context: { ...opening.context, agent: tui.pane.agent },
    };
    expect(chatOpeningPane(tuiOpening, [tui.pane], connections)).toBe(tui.pane);
    expect(chatOpeningPane(tuiOpening, [], connections)).toBeUndefined();
  });

  test("a phone's switch list reaches live core agents and terminals", async () => {
    const world = await worldOf();
    const core = world.leaves.filter((l) => l.connectionId === "box-core");
    // Live core leaves are never actionable: their own admission applies.
    expect(core.every((l) => !l.actionable && !l.stale)).toBe(true);
    const chosen: string[] = [];
    // From a Herdr window (the TUI's agent) and from a core agent's own.
    const tuiAgent = world.leaves.find((l) => l.connectionId === "tui")!;
    const fromTui = worldSwitchTargets(world.nodes, tuiAgent.id, (node) =>
      chosen.push(node.agentName ?? node.label),
    );
    expect(fromTui.map((t) => t.id).sort()).toEqual(
      core.map((l) => l.id).sort(),
    );
    // Waiting first: the reviewer asks, then finished scout.
    expect(fromTui[0]!.label).toBe("reviewer · claude");
    expect(fromTui[0]!.detail).toContain("web");
    fromTui[0]!.onSelect();
    expect(chosen).toEqual(["reviewer"]);
    const reviewer = core.find((l) => l.agentName === "reviewer")!;
    const fromCore = worldSwitchTargets(world.nodes, reviewer.id, () => {});
    expect(fromCore.map((t) => t.id)).not.toContain(reviewer.id);
    expect(fromCore).toHaveLength(core.length - 1);
    // A stale core connection offers nothing to switch to.
    const stale = await worldOf(true);
    const staleCore = new Set(
      stale.leaves
        .filter((l) => l.connectionId === "box-core")
        .map((l) => l.id),
    );
    expect(staleCore.size).toBe(core.length);
    expect(
      worldSwitchTargets(stale.nodes, "none", () => {}).filter((t) =>
        staleCore.has(t.id),
      ),
    ).toEqual([]);
  });

  test("the view-only message prefers the program's words, then why it waits", async () => {
    const world = await worldOf();
    const core = world.leaves.filter((l) => l.connectionId === "box-core");
    const reviewer = core.find((l) => l.agentName === "reviewer")!;
    expect(
      viewOnlyMessage({
        ...reviewer,
        pane: { ...reviewer.pane, status_message: undefined },
      }),
    ).toBe("Waiting for permission");
    const scout = core.find((l) => l.agentName === "scout")!;
    expect(viewOnlyMessage(scout)).toBe("Finished its turn");
  });
});
