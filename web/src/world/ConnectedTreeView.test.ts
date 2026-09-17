import { describe, expect, test } from "bun:test";
import { connectedTreeMatches } from "./ConnectedTreeView";
import type { WorldObject } from "./worldObject";

describe("connected Tree search", () => {
  test("keeps complete ancestor context for a matching task without mutating disclosure", () => {
    const matches = connectedTreeMatches(fixtureWorld(), "release checks");
    expect(matches).toEqual(new Set(["host-a", "space-a", "agent-a"]));
  });

  test("includes a complete branch when its host or space matches", () => {
    expect(connectedTreeMatches(fixtureWorld(), "forge")).toEqual(
      new Set(["host-a", "space-a", "agent-a", "terminal-a"]),
    );
    expect(connectedTreeMatches(fixtureWorld(), "platform")).toEqual(
      new Set(["host-a", "space-a", "agent-a", "terminal-a"]),
    );
  });

  test("uses ordinary disclosure when search is clear", () => {
    expect(connectedTreeMatches(fixtureWorld(), "  ")).toBeNull();
  });
});

function fixtureWorld() {
  const base = {
    nativeId: "native",
    connectionId: "host-a",
    generation: 7,
    hostLabel: "Forge",
    hostState: "active",
    selectedHost: true,
    stale: false,
    actionable: true,
    capabilities: {},
  };
  const agent = {
    ...base,
    id: "agent-a",
    kind: "agent",
    parentId: "space-a",
    label: "Codex",
    status: "working",
    focused: true,
    modelLabel: "GPT",
    taskSummary: "Running release checks",
    stateLabels: {},
  };
  const terminal = {
    ...agent,
    id: "terminal-a",
    kind: "terminal",
    label: "Shell",
    taskSummary: undefined,
  };
  const space = {
    ...base,
    id: "space-a",
    kind: "space",
    parentId: "host-a",
    label: "Platform",
    children: [agent, terminal],
  };
  const host = {
    ...base,
    id: "host-a",
    kind: "host",
    parentId: null,
    label: "Forge",
    spaces: [space],
  };
  return { hosts: [host] } as unknown as WorldObject;
}
