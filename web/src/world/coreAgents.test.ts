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
import { CORE_APP_SPACE_REASON } from "./coreRooms";

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

async function worldOf(coreStale = false) {
  const mirror = new CoreMirror();
  const sight = new CoreFirstSight();
  mirror.baseline(1, coreTerminals);
  sight.observe("c0ffee", coreTerminals);
  // Scout's turn ends while World watches: done until someone looks.
  const scout = { ...coreTerminals[2]!, turn: 1, status: { state: "idle" } };
  mirror.apply({
    method: "missed",
    params: {
      seq: 2,
      terminals: [...coreTerminals.slice(0, 2), scout, coreTerminals[3]!],
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
  return buildWorldObject(
    store
      .get()
      .connections.map((c) =>
        coreStale && c.connectionId === "box-core" ? { ...c, stale: true } : c,
      ),
  );
}

const byName = (leaves: readonly WorldLeafObject[]) =>
  leaves
    .map((leaf) => [leaf.agentName ?? leaf.label, leaf.status])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe("core agents in World's views", () => {
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
      expect(Object.values(leaf.capabilities).some(Boolean)).toBe(false);
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
