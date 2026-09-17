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
  parseWorldView,
  selectedHostStatusLabel,
  shouldCloseWorldInspector,
  shouldRehomeDockedTerminal,
  worldIntentInitialView,
  worldIntentViews,
  worldSelectionIsCurrent,
  worldViewFromPath,
} from "./WorldFoundationApp";
import { buildWorldObject } from "./worldObject";

describe("World view preference", () => {
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
      focusWorkspace: async () => {
        focusCalls += 1;
      },
      focusTaskNotificationTarget: async () => undefined,
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
      focusWorkspace: async () => undefined,
      focusTaskNotificationTarget: async () => undefined,
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

  test("opens only applicable intent resources and remembers an admitted tab", () => {
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
      "files",
      "changes",
      "history",
      "terminal",
    ]);
    expect(worldIntentViews(terminal)).toEqual([
      "files",
      "changes",
      "terminal",
    ]);
    expect(worldIntentInitialView(agent, null)).toBe("terminal");
    expect(worldIntentInitialView(agent, "changes")).toBe("changes");
    expect(worldIntentInitialView(terminal, "history")).toBe("terminal");
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
    let focusOptions: unknown;
    const focusStore = {
      get: () => ({
        activeConnectionId,
        serverRuntimeGeneration: 7,
        connections: [{ id: "host-b", state: "ready", generation: 7 }],
      }),
      selectConnection: () => true,
      refresh: async () => undefined,
      focusWorkspace: async (_workspaceId: string, options?: unknown) => {
        focusOptions = options;
        activeConnectionId = "host-a";
      },
      focusTaskNotificationTarget: async () => undefined,
    };

    await expect(focusWorldNode(space, focusStore)).rejects.toThrow(
      "The selected host changed while it was opening",
    );
    expect(focusOptions).toEqual({ retryOnReconnect: false });
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
      focusWorkspace: async () => undefined,
      focusTaskNotificationTarget: async () => undefined,
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
      availableViews: ["files", "changes", "history", "terminal"],
    });
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

  test("rehomes a docked terminal before selection leaves its entity", () => {
    expect(
      shouldRehomeDockedTerminal({
        currentNodeId: "agent-a",
        nextNodeId: "agent-b",
        inspectorOpen: true,
        inspectorView: "terminal",
        alreadyFloating: false,
      }),
    ).toBe(true);
    expect(
      shouldRehomeDockedTerminal({
        currentNodeId: "agent-a",
        nextNodeId: "agent-a",
        inspectorOpen: true,
        inspectorView: "terminal",
        alreadyFloating: false,
      }),
    ).toBe(false);
    expect(
      shouldRehomeDockedTerminal({
        currentNodeId: "agent-a",
        nextNodeId: null,
        inspectorOpen: true,
        inspectorView: "terminal",
        alreadyFloating: false,
      }),
    ).toBe(false);
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
      focusWorkspace: async () => {
        generation = 12;
      },
      focusTaskNotificationTarget: async () => undefined,
    };
    const target = {
      dispatchEvent: (event: Event) => {
        requests.push(event);
        return true;
      },
    };

    await expect(
      dispatchWorldInspectorRequest(node, "files", focusStore, target),
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
