import { describe, expect, test } from "bun:test";
import { appShouldHandleGlobalShortcut } from "../App";
import {
  focusWorldNode,
  parseWorldView,
  worldViewFromPath,
} from "./WorldFoundationApp";
import { buildWorldObject } from "./worldObject";

describe("World view preference", () => {
  test("admits only canonical native views", () => {
    expect(parseWorldView("office")).toBe("office");
    expect(parseWorldView("tree")).toBe("tree");
    expect(parseWorldView("graph")).toBe("graph");
    expect(parseWorldView("spaces")).toBe("spaces");
    expect(parseWorldView("legacy-world")).toBe("spaces");
    expect(parseWorldView(null)).toBe("spaces");
  });

  test("maps canonical paths without accepting arbitrary routes", () => {
    expect(worldViewFromPath("/spaces")).toBe("spaces");
    expect(worldViewFromPath("/office")).toBe("office");
    expect(worldViewFromPath("/tree")).toBe("tree");
    expect(worldViewFromPath("/graph")).toBe("graph");
    expect(worldViewFromPath("/other")).toBe("spaces");
  });

  test("does not dispatch a space focus after the active host changes", async () => {
    const space = buildWorldObject([
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
    ]).spaces[0];
    let resolveRefresh!: () => void;
    let activeConnectionId = "host-a";
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
        activeConnectionId = connectionId;
        return true;
      },
      refresh: () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
      focusWorkspace: async () => {
        focusCalls += 1;
      },
      focusTaskNotificationTarget: async () => undefined,
    };

    const focusing = focusWorldNode(space, focusStore);
    activeConnectionId = "host-a";
    resolveRefresh();

    await expect(focusing).rejects.toThrow(
      "The selected host changed while it was opening",
    );
    expect(focusCalls).toBe(0);
  });

  test("does not report a successful focus after its host lease changes", async () => {
    const space = buildWorldObject([
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
    ]).spaces[0];
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
