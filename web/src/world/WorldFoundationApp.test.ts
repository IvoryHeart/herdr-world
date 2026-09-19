import { describe, expect, test } from "bun:test";
import {
  appShouldHandleGlobalShortcut,
  terminalPresentationTarget,
} from "../App";
import {
  activateWorldNodeHost,
  chooseWorldSelectedConnection,
  dispatchWorldInspectorRequest,
  focusWorldNode,
  hasValidSelectedConnection,
  moveDockedInspectorGeometry,
  parseWorldView,
  selectedHostStatusLabel,
  retainWorldFloatingTerminals,
  shouldCloseWorldInspector,
  upsertWorldFloatingTerminal,
  worldIntentInitialView,
  worldIntentViews,
  worldInspectorContext,
  worldNodeForWorkspaceSurfaceSelection,
  worldSelectionIsCurrent,
  worldSnapshotPriorityForNode,
  worldViewFromPath,
} from "./WorldFoundationApp";
import { buildWorldObject } from "./worldObject";
import {
  reconcileWorldInspectorConversation,
  retainWorldInspectorConversations,
  upsertWorldInspectorConversation,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

function inspectorConversation(index: number): WorldInspectorConversation {
  return {
    nodeId: `node-${index}`,
    connectionId: "local",
    runtimeGeneration: 4,
    resourceIdentity: `resource-${index}`,
    workspaceId: "studio",
    paneId: `pane-${index}`,
    terminalId: `terminal-${index}`,
    label: `Agent ${index}`,
    hostLabel: "Local",
    spaceLabel: "Studio",
    context: {
      kind: "agent",
      label: `Agent ${index}`,
      stateLabel: "Working",
      locationLabel: "Studio · Local",
    },
    availableViews: ["terminal", "files", "changes", "history"],
    view: "terminal",
    dock: "right",
    expanded: false,
    size: 520,
  };
}

describe("World view preference", () => {
  test("moves a docked Inspector without allowing it to leave the World stage", () => {
    const geometry = { left: 600, top: 40, width: 320, height: 420 };
    expect(
      moveDockedInspectorGeometry(geometry, -180, 90, {
        width: 1000,
        height: 700,
      }),
    ).toEqual({ left: 420, top: 130, width: 320, height: 420 });
    expect(
      moveDockedInspectorGeometry(geometry, 400, -100, {
        width: 1000,
        height: 700,
      }),
    ).toEqual({ left: 680, top: 0, width: 320, height: 420 });
  });

  test("admits only canonical native views", () => {
    expect(parseWorldView("office")).toBe("office");
    expect(parseWorldView("tree")).toBe("tree");
    expect(parseWorldView("graph")).toBe("graph");
    expect(parseWorldView("spaces")).toBe("spaces");
    expect(parseWorldView("legacy-world")).toBe("office");
    expect(parseWorldView(null)).toBe("office");
  });

  test("maps canonical paths without accepting arbitrary routes", () => {
    expect(worldViewFromPath("/")).toBe("office");
    expect(worldViewFromPath("/spaces")).toBe("spaces");
    expect(worldViewFromPath("/office")).toBe("office");
    expect(worldViewFromPath("/tree")).toBe("tree");
    expect(worldViewFromPath("/graph")).toBe("graph");
    expect(worldViewFromPath("/other")).toBe("office");
  });

  test("rejects a stale top-tab selection after a host switch with colliding IDs", () => {
    const snapshot = (label: string) => ({
      workspaces: [
        {
          workspace_id: "shared",
          number: 1,
          label: "Shared",
          focused: true,
          pane_count: 1,
          tab_count: 1,
          agent_status: "working",
        },
      ],
      tabs: [
        {
          tab_id: "same-tab",
          workspace_id: "shared",
          number: 1,
          label,
          focused: true,
          pane_count: 1,
          agent_status: "working",
        },
      ],
      panes: [
        {
          pane_id: "same-pane",
          terminal_id: "same-terminal",
          workspace_id: "shared",
          tab_id: "same-tab",
          focused: true,
          agent: label,
          agent_status: "working",
          revision: 1,
        },
      ],
      agents: [],
    });
    const world = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 4,
          snapshotGeneration: 4,
          stale: false,
          actionable: true,
          snapshot: snapshot("Agent A"),
        },
        {
          connectionId: "host-b",
          label: "Host B",
          source: "saved-profile",
          isDefault: false,
          state: "ready",
          generation: 9,
          snapshotGeneration: 9,
          stale: false,
          actionable: true,
          snapshot: snapshot("Agent B"),
        },
      ],
      "host-b",
    );

    expect(
      worldNodeForWorkspaceSurfaceSelection(world, {
        connectionId: "host-a",
        runtimeGeneration: 4,
        workspaceId: "shared",
        paneId: "same-pane",
      }),
    ).toBeNull();
    expect(
      worldNodeForWorkspaceSurfaceSelection(world, {
        connectionId: "host-b",
        runtimeGeneration: 9,
        workspaceId: "shared",
        paneId: "same-pane",
      })?.connectionId,
    ).toBe("host-b");
  });

  test("qualifies snapshot priority by the selected workspace and pane", () => {
    const world = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 4,
          snapshotGeneration: 4,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "workspace-512",
                number: 513,
                label: "Selected",
                focused: false,
                pane_count: 1,
                tab_count: 1,
                agent_status: "working",
              },
            ],
            tabs: [],
            panes: [
              {
                pane_id: "pane-4096",
                terminal_id: "terminal-4096",
                workspace_id: "workspace-512",
                tab_id: "tab-2048",
                focused: false,
                agent: "codex",
                agent_status: "working",
                revision: 1,
              },
            ],
            agents: [],
          },
        },
      ],
      "host-a",
    );

    expect(worldSnapshotPriorityForNode(world.spaces[0]!)).toEqual({
      connectionId: "host-a",
      workspaceId: "workspace-512",
    });
    expect(worldSnapshotPriorityForNode(world.leaves[0]!)).toEqual({
      connectionId: "host-a",
      workspaceId: "workspace-512",
      paneId: "pane-4096",
      terminalId: "terminal-4096",
    });
  });

  test("does not implicitly activate another host while opening a World node", async () => {
    const space = buildWorldObject(
      [
        {
          connectionId: "host-b",
          label: "Host B",
          source: "saved-profile",
          isDefault: false,
          state: "ready",
          generation: 7,
          snapshotGeneration: 7,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: false,
                pane_count: 0,
                tab_count: 0,
                agent_status: "idle",
              },
            ],
            tabs: [],
            panes: [],
            agents: [],
          },
        },
      ],
      "host-a",
    ).spaces[0];
    const activeConnectionId = "host-a";
    let selectCalls = 0;
    let refreshCalls = 0;
    let focusCalls = 0;
    const focusStore = {
      get: () => ({
        activeConnectionId,
        serverRuntimeGeneration: 7,
        connections: [
          {
            id: "host-b",
            state: "ready",
            generation: 7,
          },
        ],
      }),
      selectConnection: (connectionId: string) => {
        void connectionId;
        selectCalls += 1;
        return true;
      },
      refresh: async () => {
        refreshCalls += 1;
      },
      focusQualifiedTarget: async () => {
        focusCalls += 1;
        return true;
      },
    };

    await expect(focusWorldNode(space, focusStore)).rejects.toThrow(
      "Activate Host B before opening this item",
    );
    expect(selectCalls).toBe(0);
    expect(refreshCalls).toBe(0);
    expect(focusCalls).toBe(0);
  });

  test("activates a ready observed host only through the explicit host action", async () => {
    const space = buildWorldObject(
      [
        {
          connectionId: "host-b",
          label: "Host B",
          source: "saved-profile",
          isDefault: false,
          state: "ready",
          generation: 7,
          snapshotGeneration: 7,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: false,
                pane_count: 0,
                tab_count: 0,
                agent_status: "idle",
              },
            ],
            tabs: [],
            panes: [],
            agents: [],
          },
        },
      ],
      "host-a",
    ).spaces[0];
    let activeConnectionId = "host-a";
    let refreshCalls = 0;
    const focusStore = {
      get: () => ({
        activeConnectionId,
        serverRuntimeGeneration: activeConnectionId === "host-b" ? 7 : null,
        connections: [{ id: "host-b", state: "ready", generation: 7 }],
      }),
      selectConnection: (connectionId: string) => {
        activeConnectionId = connectionId;
        return true;
      },
      refresh: async () => {
        refreshCalls += 1;
      },
      focusQualifiedTarget: async () => true,
    };

    await activateWorldNodeHost(space, focusStore);

    expect(activeConnectionId).toBe("host-b");
    expect(refreshCalls).toBe(1);
  });

  test("requires the selected connection to belong to the managed catalogue", () => {
    expect(
      hasValidSelectedConnection("host-a", [
        { id: "host-a" },
        { id: "host-b" },
      ]),
    ).toBe(true);
    expect(hasValidSelectedConnection("missing", [{ id: "host-a" }])).toBe(
      false,
    );
    expect(hasValidSelectedConnection("startup-default", [])).toBe(false);
  });

  test("does not describe a reconnecting selected profile as active", () => {
    expect(selectedHostStatusLabel(null)).toBe("No host selected");
    expect(
      selectedHostStatusLabel({
        label: "Remote",
        hostState: "reconnecting",
      }),
    ).toBe("Remote · Reconnecting");
    expect(
      selectedHostStatusLabel({ label: "Local", hostState: "active" }),
    ).toBe("Local · Active");
  });

  test("retires the shared Inspector when selection moves to another host", () => {
    const active = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 1,
          snapshotGeneration: 1,
          stale: false,
          actionable: true,
          snapshot: { workspaces: [], tabs: [], panes: [], agents: [] },
        },
        {
          connectionId: "host-b",
          label: "Host B",
          source: "saved-profile",
          isDefault: false,
          state: "ready",
          generation: 2,
          snapshotGeneration: 2,
          stale: false,
          actionable: true,
          snapshot: { workspaces: [], tabs: [], panes: [], agents: [] },
        },
      ],
      "host-a",
    );

    expect(shouldCloseWorldInspector(active.hosts[0])).toBe(false);
    expect(shouldCloseWorldInspector(active.hosts[1])).toBe(true);
    expect(shouldCloseWorldInspector(null)).toBe(false);
  });

  test("keeps a selected entity on its observed generation after reconnect", () => {
    const generation = (value: number, label: string) =>
      buildWorldObject(
        [
          {
            connectionId: "host-a",
            label: "Host A",
            source: "saved-profile" as const,
            isDefault: true,
            state: "ready" as const,
            generation: value,
            snapshotGeneration: value,
            stale: false,
            actionable: true,
            snapshot: {
              workspaces: [
                {
                  workspace_id: "shared",
                  number: 1,
                  label,
                  focused: true,
                  pane_count: 0,
                  tab_count: 0,
                  agent_status: "idle",
                },
              ],
              tabs: [],
              panes: [],
              agents: [],
            },
          },
        ],
        "host-a",
      );
    const original = generation(11, "Original");
    const replacement = generation(12, "Replacement");
    const selection = original.spaces[0];
    const replacementNode = replacement.nodeById.get(selection.id);

    expect(worldSelectionIsCurrent(selection, replacementNode)).toBe(false);
    expect(selection).toMatchObject({
      label: "Original",
      generation: 11,
    });
    expect(replacementNode).toMatchObject({
      label: "Replacement",
      generation: 12,
    });
  });

  test("defaults intent to Terminal while admitting explicit resource requests", () => {
    const world = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 11,
          snapshotGeneration: 11,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: true,
                pane_count: 2,
                tab_count: 1,
                agent_status: "working",
              },
            ],
            tabs: [
              {
                tab_id: "tab-a",
                workspace_id: "shared",
                number: 1,
                label: "Work",
                focused: true,
                pane_count: 2,
                agent_status: "working",
              },
            ],
            panes: [
              {
                pane_id: "agent-pane",
                terminal_id: "agent-terminal",
                workspace_id: "shared",
                tab_id: "tab-a",
                focused: true,
                agent: "codex",
                agent_status: "working",
                revision: 1,
              },
              {
                pane_id: "shell-pane",
                terminal_id: "shell-terminal",
                workspace_id: "shared",
                tab_id: "tab-a",
                focused: false,
                agent_status: "unknown",
                revision: 1,
              },
            ],
            agents: [],
          },
        },
      ],
      "host-a",
    );
    const agent = world.leaves.find(({ kind }) => kind === "agent")!;
    const terminal = world.leaves.find(({ kind }) => kind === "terminal")!;

    expect(worldIntentViews(world.hosts[0])).toEqual([]);
    expect(worldIntentViews(world.spaces[0])).toEqual(["files", "changes"]);
    expect(worldIntentViews(agent)).toEqual([
      "terminal",
      "files",
      "changes",
      "history",
    ]);
    expect(worldIntentViews(terminal)).toEqual([
      "terminal",
      "files",
      "changes",
    ]);
    expect(worldIntentInitialView(agent, null)).toBe("terminal");
    expect(worldIntentInitialView(agent, "changes")).toBe("changes");
    expect(worldIntentInitialView(terminal, "history")).toBe("terminal");
    expect(worldInspectorContext(agent)).toMatchObject({
      kind: "agent",
      label: "codex",
      stateLabel: "working",
      locationLabel: "Shared · Host A",
      agent: "codex",
    });
    expect(worldInspectorContext(world.hosts[0])).toBeNull();
  });

  test("restores a valid last host before the default or current profile", () => {
    const connections = [{ id: "host-a" }, { id: "host-b" }];
    expect(
      chooseWorldSelectedConnection({
        activeConnectionId: "host-a",
        defaultConnectionId: "host-a",
        storedConnectionId: "host-b",
        connections,
      }),
    ).toBe("host-b");
    expect(
      chooseWorldSelectedConnection({
        activeConnectionId: "missing",
        defaultConnectionId: "host-a",
        storedConnectionId: "removed",
        connections,
      }),
    ).toBe("host-a");
    expect(
      chooseWorldSelectedConnection({
        activeConnectionId: "host-b",
        defaultConnectionId: "missing",
        storedConnectionId: null,
        connections,
      }),
    ).toBe("host-b");
    expect(
      chooseWorldSelectedConnection({
        activeConnectionId: "missing",
        defaultConnectionId: "missing",
        storedConnectionId: null,
        connections,
      }),
    ).toBeNull();
  });

  test("does not report a successful focus after its host lease changes", async () => {
    const space = buildWorldObject(
      [
        {
          connectionId: "host-b",
          label: "Host B",
          source: "saved-profile",
          isDefault: false,
          state: "ready",
          generation: 7,
          snapshotGeneration: 7,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: false,
                pane_count: 0,
                tab_count: 0,
                agent_status: "idle",
              },
            ],
            tabs: [],
            panes: [],
            agents: [],
          },
        },
      ],
      "host-b",
    ).spaces[0];
    let activeConnectionId = "host-b";
    let focusTarget: unknown;
    const focusStore = {
      get: () => ({
        activeConnectionId,
        serverRuntimeGeneration: 7,
        connections: [{ id: "host-b", state: "ready", generation: 7 }],
      }),
      selectConnection: () => true,
      refresh: async () => undefined,
      focusQualifiedTarget: async (target: unknown) => {
        focusTarget = target;
        activeConnectionId = "host-a";
        return true;
      },
    };

    await expect(focusWorldNode(space, focusStore)).rejects.toThrow(
      "The selected host changed while it was opening",
    );
    expect(focusTarget).toEqual({
      connectionId: "host-b",
      runtimeGeneration: 7,
      workspaceId: "shared",
      paneId: null,
    });
  });

  test("dispatches an Inspector request only for the exact selected host lease", async () => {
    const node = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 11,
          snapshotGeneration: 11,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: true,
                pane_count: 1,
                tab_count: 1,
                agent_status: "working",
              },
            ],
            tabs: [
              {
                tab_id: "tab-a",
                workspace_id: "shared",
                number: 1,
                label: "Agent",
                focused: true,
                pane_count: 1,
                agent_status: "working",
              },
            ],
            panes: [
              {
                pane_id: "pane-a",
                terminal_id: "terminal-a",
                workspace_id: "shared",
                tab_id: "tab-a",
                focused: true,
                agent: "codex",
                agent_status: "working",
                revision: 1,
              },
            ],
            agents: [],
          },
        },
      ],
      "host-a",
    ).leaves[0];
    const requests: Event[] = [];
    const focusStore = {
      get: () => ({
        activeConnectionId: "host-a",
        connectionGeneration: 23,
        serverRuntimeGeneration: 11,
        connections: [{ id: "host-a", state: "ready", generation: 11 }],
      }),
      selectConnection: () => true,
      refresh: async () => undefined,
      focusQualifiedTarget: async () => true,
    };
    const target = {
      dispatchEvent: (event: Event) => {
        requests.push(event);
        return true;
      },
    };

    await dispatchWorldInspectorRequest(node, "history", focusStore, target);

    expect(requests).toHaveLength(1);
    expect((requests[0] as CustomEvent).detail).toEqual({
      connectionId: "host-a",
      generation: 23,
      workspaceId: "shared",
      view: "history",
      originPaneId: "pane-a",
      availableViews: ["terminal", "files", "changes", "history"],
    });

    await expect(
      dispatchWorldInspectorRequest(
        node,
        "history",
        { ...focusStore, focusQualifiedTarget: async () => false },
        target,
      ),
    ).rejects.toThrow("The selected item could not be focused");
    expect(requests).toHaveLength(1);
  });

  test("admits Inspector identity only after focus and immediately before its resource request", async () => {
    const node = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 11,
          snapshotGeneration: 11,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: true,
                pane_count: 0,
                tab_count: 0,
                agent_status: "idle",
              },
            ],
            tabs: [],
            panes: [],
            agents: [],
          },
        },
      ],
      "host-a",
    ).spaces[0];
    const focus = Promise.withResolvers<void>();
    const order: string[] = [];
    const focusStore = {
      get: () => ({
        activeConnectionId: "host-a",
        connectionGeneration: 23,
        serverRuntimeGeneration: 11,
        connections: [{ id: "host-a", state: "ready", generation: 11 }],
      }),
      selectConnection: () => true,
      refresh: async () => undefined,
      focusQualifiedTarget: async () => {
        await focus.promise;
        return true;
      },
    };
    const opening = dispatchWorldInspectorRequest(
      node,
      "files",
      focusStore,
      {
        dispatchEvent: () => {
          order.push("resource");
          return true;
        },
      },
      () => order.push("identity"),
    );

    await Promise.resolve();
    expect(order).toEqual([]);
    focus.resolve();
    await opening;
    expect(order).toEqual(["identity", "resource"]);
  });

  test("gives one presentation exclusive ownership of the selected terminal", () => {
    expect(terminalPresentationTarget(true, null, false)).toBe("spaces");
    expect(
      terminalPresentationTarget(
        false,
        {
          open: true,
          view: "terminal",
          originPaneId: "pane-a",
        },
        false,
      ),
    ).toBe("inspector");
    expect(
      terminalPresentationTarget(
        true,
        {
          open: true,
          view: "terminal",
          originPaneId: "pane-a",
        },
        false,
      ),
    ).toBe("inspector");
    expect(
      terminalPresentationTarget(
        false,
        {
          open: true,
          view: "files",
          originPaneId: "pane-a",
        },
        false,
      ),
    ).toBeNull();
    expect(
      terminalPresentationTarget(
        false,
        {
          open: true,
          view: "terminal",
        },
        false,
      ),
    ).toBeNull();
    expect(
      terminalPresentationTarget(
        true,
        {
          open: true,
          view: "terminal",
          originPaneId: "pane-a",
        },
        true,
      ),
    ).toBe("floating");
  });

  test("bounds floating terminals while focusing an existing conversation", () => {
    const terminals = Array.from({ length: 5 }, (_, index) => ({
      nodeId: `node-${index}`,
      connectionId: "local",
      runtimeGeneration: 1,
      paneId: `pane-${index}`,
      terminalId: `terminal-${index}`,
      label: `Terminal ${index}`,
      hostLabel: "Local",
      spaceLabel: "Studio",
    }));
    expect(
      upsertWorldFloatingTerminal(terminals, {
        ...terminals[0]!,
        label: "Focused",
      }),
    ).toEqual({
      terminals: [
        ...terminals.slice(1),
        { ...terminals[0]!, label: "Focused" },
      ],
      admitted: true,
    });
    expect(
      upsertWorldFloatingTerminal(terminals, {
        ...terminals[0]!,
        nodeId: "node-new",
        paneId: "pane-new",
        terminalId: "terminal-new",
      }),
    ).toEqual({ terminals, admitted: false });
  });

  test("keys conversations by connection, runtime generation, and terminal identity", () => {
    const local = {
      nodeId: "local-node",
      connectionId: "local",
      runtimeGeneration: 4,
      paneId: "shared-pane",
      terminalId: "shared-terminal",
      label: "Local",
      hostLabel: "Local",
      spaceLabel: "Studio",
    };
    const remote = {
      ...local,
      nodeId: "remote-node",
      connectionId: "remote",
      label: "Remote",
      hostLabel: "Remote",
    };
    const replacement = { ...local, nodeId: "new-node", runtimeGeneration: 5 };

    expect(upsertWorldFloatingTerminal([local], remote).terminals).toEqual([
      local,
      remote,
    ]);
    expect(upsertWorldFloatingTerminal([local], replacement).terminals).toEqual(
      [local, replacement],
    );
    expect(
      upsertWorldFloatingTerminal([local], { ...local, label: "Focused" })
        .terminals,
    ).toEqual([{ ...local, label: "Focused" }]);
  });

  test("retires conversations outside the exact active runtime lease", () => {
    const conversations = [
      {
        nodeId: "local-current",
        connectionId: "local",
        runtimeGeneration: 4,
        paneId: "pane-a",
        terminalId: "terminal-a",
        label: "Current",
        hostLabel: "Local",
        spaceLabel: "Studio",
      },
      {
        nodeId: "local-old",
        connectionId: "local",
        runtimeGeneration: 3,
        paneId: "pane-b",
        terminalId: "terminal-b",
        label: "Old",
        hostLabel: "Local",
        spaceLabel: "Studio",
      },
      {
        nodeId: "remote",
        connectionId: "remote",
        runtimeGeneration: 8,
        paneId: "pane-c",
        terminalId: "terminal-c",
        label: "Remote",
        hostLabel: "Remote",
        spaceLabel: "Review",
      },
    ];

    expect(
      retainWorldFloatingTerminals(conversations, {
        connectionId: "local",
        runtimeGeneration: 4,
      }),
    ).toEqual([conversations[0]]);
    expect(retainWorldFloatingTerminals(conversations, null)).toEqual([]);
  });

  test("bounds independently stateful floating Inspector conversations", () => {
    const conversations = Array.from({ length: 5 }, (_, index) =>
      inspectorConversation(index),
    );
    expect(
      upsertWorldInspectorConversation(conversations, {
        ...conversations[0]!,
        view: "files",
      }),
    ).toEqual({
      conversations: [
        ...conversations.slice(1),
        { ...conversations[0]!, view: "files" },
      ],
      admitted: true,
    });
    expect(
      upsertWorldInspectorConversation(conversations, inspectorConversation(6)),
    ).toEqual({ conversations, admitted: false });
  });

  test("retires whole Inspectors outside their exact runtime lease", () => {
    const current = inspectorConversation(0);
    const old = { ...inspectorConversation(1), runtimeGeneration: 3 };
    expect(
      retainWorldInspectorConversations([current, old], {
        connectionId: "local",
        runtimeGeneration: 4,
      }),
    ).toEqual([current]);
  });

  test("refreshes retained Inspector identity and resets a replaced agent session", () => {
    const current = {
      ...inspectorConversation(0),
      resourceIdentity: "session-a",
      label: "Old agent",
      paneId: "old-pane",
      view: "history" as const,
      dock: "bottom" as const,
      expanded: true,
      size: 640,
    };
    const observed: WorldInspectorConversation = {
      ...inspectorConversation(0),
      resourceIdentity: "session-b",
      label: "New agent",
      paneId: "new-pane",
      context: {
        kind: "agent" as const,
        label: "New agent",
        stateLabel: "Working",
        locationLabel: "Studio · Local",
        taskSummary: "New session",
      },
      availableViews: ["terminal", "files", "changes"],
      view: "terminal" as const,
    };

    expect(reconcileWorldInspectorConversation(current, observed)).toEqual({
      ...observed,
      dock: "bottom",
      expanded: true,
      size: 640,
    });
  });

  test("refreshes Inspector metadata without discarding same-session resource state", () => {
    const current = {
      ...inspectorConversation(0),
      resourceIdentity: "session-a",
      label: "Old label",
      view: "files" as const,
    };
    const observed = {
      ...inspectorConversation(0),
      resourceIdentity: "session-a",
      label: "New label",
      context: {
        ...inspectorConversation(0).context,
        label: "New label",
        taskSummary: "Updated task",
      },
      view: "terminal" as const,
    };

    expect(reconcileWorldInspectorConversation(current, observed)).toEqual({
      ...observed,
      view: "files",
    });
  });

  test("does not dispatch Inspector work after a generation replacement", async () => {
    const node = buildWorldObject(
      [
        {
          connectionId: "host-a",
          label: "Host A",
          source: "saved-profile",
          isDefault: true,
          state: "ready",
          generation: 11,
          snapshotGeneration: 11,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [
              {
                workspace_id: "shared",
                number: 1,
                label: "Shared",
                focused: true,
                pane_count: 0,
                tab_count: 0,
                agent_status: "idle",
              },
            ],
            tabs: [],
            panes: [],
            agents: [],
          },
        },
      ],
      "host-a",
    ).spaces[0];
    let generation = 11;
    const requests: Event[] = [];
    const focusStore = {
      get: () => ({
        activeConnectionId: "host-a",
        connectionGeneration: 23,
        serverRuntimeGeneration: generation,
        connections: [{ id: "host-a", state: "ready", generation }],
      }),
      selectConnection: () => true,
      refresh: async () => undefined,
      focusQualifiedTarget: async () => {
        generation = 12;
        return true;
      },
    };
    const target = {
      dispatchEvent: (event: Event) => {
        requests.push(event);
        return true;
      },
    };

    await expect(
      dispatchWorldInspectorRequest(node, "files", focusStore, target, () =>
        requests.push(new Event("identity")),
      ),
    ).rejects.toThrow("The selected host changed while it was opening");
    expect(requests).toHaveLength(0);
  });

  test("suppresses App global shortcuts while Spaces is hidden", () => {
    const keyboardEvent = {
      defaultPrevented: false,
      isComposing: false,
      keyCode: 84,
    } as KeyboardEvent;
    expect(appShouldHandleGlobalShortcut(false, keyboardEvent)).toBe(false);
    expect(appShouldHandleGlobalShortcut(true, keyboardEvent)).toBe(true);
  });
});
