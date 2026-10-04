import { describe, expect, test } from "bun:test";
import { buildWorldObject } from "./worldObject";
import {
  resolveVisualRouteActionTarget,
  visualRouteActionsForNode,
  visualRouteActionTarget,
} from "./visualRouteActions";

function world(connectionId = "alpha.example", generation = 4) {
  return buildWorldObject(
    [
      {
        connectionId,
        label: connectionId,
        source: "saved-profile" as const,
        isDefault: true,
        state: "ready" as const,
        generation,
        snapshotGeneration: generation,
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [
            {
              workspace_id: "studio",
              number: 1,
              label: "Studio",
              focused: true,
              pane_count: 2,
              tab_count: 1,
              agent_status: "working",
            },
          ],
          tabs: [],
          panes: [
            {
              pane_id: "agent-pane",
              terminal_id: "agent-terminal",
              workspace_id: "studio",
              tab_id: "tab-1",
              focused: true,
              agent: "codex",
              agent_status: "working",
              revision: 1,
            },
            {
              pane_id: "shell-pane",
              terminal_id: "shell-terminal",
              workspace_id: "studio",
              tab_id: "tab-1",
              focused: false,
              agent_status: "idle",
              revision: 1,
            },
          ],
          agents: [],
        },
      },
    ],
    connectionId,
  );
}

describe("visual-route Actions", () => {
  test("an admitted sibling host's captured action survives another host's command focus", () => {
    const alpha = world("alpha.example", 4).hosts[0]!.connection;
    const beta = world("beta.example", 6).hosts[0]!.connection;
    const aggregate = buildWorldObject([alpha, beta], "alpha.example");
    const node = aggregate.leaves.find(
      (leaf) => leaf.connectionId === "beta.example" && leaf.kind === "agent",
    )!;
    const target = visualRouteActionTarget(node)!;
    expect(node.actionable).toBe(true);
    expect(
      resolveVisualRouteActionTarget(target, aggregate, {
        activeConnectionId: "beta.example",
        runtimeGeneration: 6,
        selectedId: node.id,
      }),
    ).toEqual({ node, reason: null });
  });
  test("a captured target is not rebound to colliding native IDs when its own runtime retires", () => {
    const alpha = world("alpha.example", 4).hosts[0]!.connection;
    const beta = world("beta.example", 6).hosts[0]!.connection;
    const before = buildWorldObject([alpha, beta], "alpha.example");
    const node = before.leaves.find(
      (leaf) => leaf.connectionId === "beta.example",
    )!;
    const target = visualRouteActionTarget(node)!;
    const replaced = buildWorldObject(
      [alpha, world("beta.example", 7).hosts[0]!.connection],
      "alpha.example",
    );
    expect(
      resolveVisualRouteActionTarget(target, replaced, {
        activeConnectionId: "beta.example",
        runtimeGeneration: 7,
        selectedId: node.id,
      }).node,
    ).toBeNull();
  });
  test("captures a qualified agent and admits only its existing actions", () => {
    const projection = world();
    const agent = projection.leaves.find(({ kind }) => kind === "agent")!;
    const target = visualRouteActionTarget(agent)!;

    expect(target).toEqual({
      id: agent.id,
      connectionId: "alpha.example",
      runtimeGeneration: 4,
      kind: "agent",
      workspaceId: "studio",
      paneId: "agent-pane",
      terminalId: "agent-terminal",
    });
    expect(visualRouteActionsForNode(agent)).toEqual([
      "terminal",
      "files",
      "changes",
      "history",
      "spaces",
    ]);
    expect(
      resolveVisualRouteActionTarget(target, projection, {
        activeConnectionId: "alpha.example",
        runtimeGeneration: 4,
        selectedId: agent.id,
      }).node,
    ).toBe(agent);
  });

  test("does not acquire terminal or agent-history actions for inapplicable entities", () => {
    const projection = world();
    const space = projection.spaces[0]!;
    const terminal = projection.leaves.find(({ kind }) => kind === "terminal")!;

    expect(visualRouteActionTarget(projection.hosts[0]!)).toBeNull();
    expect(visualRouteActionsForNode(space)).toEqual([
      "files",
      "changes",
      "spaces",
    ]);
    expect(visualRouteActionsForNode(terminal)).toEqual([
      "terminal",
      "files",
      "changes",
      "spaces",
    ]);
  });

  test("rejects a changed selection, host, generation, or missing observation", () => {
    const alpha = world();
    const agent = alpha.leaves.find(({ kind }) => kind === "agent")!;
    const target = visualRouteActionTarget(agent)!;

    expect(
      resolveVisualRouteActionTarget(target, alpha, {
        activeConnectionId: "alpha.example",
        runtimeGeneration: 4,
        selectedId: "other-selection",
      }),
    ).toMatchObject({ reason: "The selected item changed." });
    expect(
      resolveVisualRouteActionTarget(target, world("beta.example"), {
        activeConnectionId: "beta.example",
        runtimeGeneration: 4,
        selectedId: agent.id,
      }),
    ).toMatchObject({ reason: "The selected host changed." });
    expect(
      resolveVisualRouteActionTarget(target, alpha, {
        activeConnectionId: "alpha.example",
        runtimeGeneration: 5,
        selectedId: agent.id,
      }),
    ).toMatchObject({
      reason: "The selected host generation is no longer available.",
    });
    expect(
      resolveVisualRouteActionTarget(target, world("alpha.example", 4), {
        activeConnectionId: "alpha.example",
        runtimeGeneration: 4,
        selectedId: agent.id,
      }).node?.id,
    ).toBe(agent.id);

    const withoutAgent = buildWorldObject(
      [
        {
          ...world().hosts[0]!.connection,
          snapshot: {
            ...world().hosts[0]!.connection.snapshot!,
            panes: [],
          },
        },
      ],
      "alpha.example",
    );
    expect(
      resolveVisualRouteActionTarget(target, withoutAgent, {
        activeConnectionId: "alpha.example",
        runtimeGeneration: 4,
        selectedId: agent.id,
      }),
    ).toMatchObject({ reason: "The selected item is no longer available." });
  });
});
