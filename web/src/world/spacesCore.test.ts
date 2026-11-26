import { describe, expect, test } from "bun:test";
import { parseWorldSnapshotResult } from "./runtimeStore";
import {
  spacesCoreChoice,
  spacesCoreStrip,
  spacesCoreStripStep,
} from "./spacesCore";
import { buildWorldObject } from "./worldObject";

const zero = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
const pane = (
  paneId: string,
  workspaceId: string,
  agent: string,
  label: string,
) => ({
  pane_id: paneId,
  terminal_id: `term-${paneId}`,
  workspace_id: workspaceId,
  tab_id: `${workspaceId}-tab`,
  focused: false,
  agent,
  agent_status: agent ? "idle" : "unknown",
  ...(agent ? { display_agent: label } : { label }),
});

/** A herdr-core host on this machine with two rooms, as the service sends it. */
function coreWorld(
  panes: ReturnType<typeof pane>[],
  { generation = 4, stale = false } = {},
) {
  const workspaces = ["alpha", "beta"].map((id) => ({
    workspace_id: id,
    label: id === "alpha" ? "Alpha room" : "Beta room",
    focused: false,
    pane_count: 0,
    tab_count: 1,
    agent_status: "idle",
  }));
  const observation = parseWorldSnapshotResult({
    revision: 1,
    observed_at: 1,
    connections: [
      {
        connection_id: "core",
        label: "Core box",
        source: "test",
        runtime: "herdr-core",
        is_default: false,
        state: stale ? "reconnecting" : "ready",
        generation,
        snapshot_generation: generation,
        stale,
        actionable: !stale,
        snapshot: {
          workspaces,
          tabs: workspaces.map(({ workspace_id }) => ({
            tab_id: `${workspace_id}-tab`,
            workspace_id,
            number: 1,
            label: "",
            focused: false,
          })),
          panes,
          agents: [],
          // Coverage only bounds counts; the strip reads the panes.
          coverage: {
            workspaces: 2,
            tabs: 2,
            panes: 0,
            agent_panes: 0,
            status: zero,
            by_workspace: workspaces.map(({ workspace_id }) => ({
              workspace_id,
              tabs: 1,
              panes: 0,
              agent_panes: 0,
              status: zero,
            })),
          },
        },
      },
    ],
  });
  expect(observation?.connections).toHaveLength(1);
  return buildWorldObject(observation!.connections, null);
}

const panes = [
  pane("t1", "alpha", "claude", "Planner"),
  pane("t2", "alpha", "", "build shell"),
  pane("t3", "beta", "codex", "Reviewer"),
  // Another machine's terminal: World only watches it from there.
  pane("box/t4", "beta", "pi", "Remote"),
];
const leaf = (world: ReturnType<typeof coreWorld>, address: string) =>
  world.leaves.find((node) => node.nativeId === address)!;
const labels = (groups: ReturnType<typeof spacesCoreStrip>) =>
  groups.map((group) => [
    group.label,
    group.tabs.map((tab) => `${tab.leaf ? "" : "gone:"}${tab.choice.label}`),
  ]);

describe("Spaces' herdr-core strip (#1390)", () => {
  test("lists the host's live terminals in World's rooms, the open one among them", () => {
    const world = coreWorld(panes);
    const choice = spacesCoreChoice(leaf(world, "t3"));
    const groups = spacesCoreStrip(world, choice);
    // An agent shows its name; a plain terminal its own name from core.
    expect(labels(groups)).toEqual([
      ["Alpha room", ["Planner", "build shell"]],
      ["Beta room", ["Reviewer"]],
    ]);
    // The room a tab sits in is World's room, as Town and Board show it.
    expect(groups.map((group) => group.id)).toEqual(
      world.hosts[0]!.spaces.map((space) => space.id),
    );
  });

  test("a terminal that starts joins live; one that stops leaves, the open one shows as gone", () => {
    const world = coreWorld(panes);
    const choice = spacesCoreChoice(leaf(world, "t1"));
    const started = coreWorld([...panes, pane("t5", "beta", "", "new shell")]);
    expect(
      spacesCoreStrip(started, choice).flatMap((group) =>
        group.tabs.map((tab) => tab.choice.nodeId),
      ),
    ).toContain(leaf(started, "t5").id);
    const stopped = coreWorld(panes.filter((p) => p.pane_id !== "t1"));
    expect(labels(spacesCoreStrip(stopped, choice))).toEqual([
      ["Alpha room", [leaf(world, "t2").label]],
      ["Beta room", [leaf(world, "t3").label]],
      ["", [`gone:${choice.label}`]],
    ]);
  });

  test("never follows to another runtime generation, nor lists a stale host", () => {
    const choice = spacesCoreChoice(leaf(coreWorld(panes), "t1"));
    expect(
      labels(spacesCoreStrip(coreWorld(panes, { generation: 5 }), choice)),
    ).toEqual([["", [`gone:${choice.label}`]]]);
    expect(
      labels(spacesCoreStrip(coreWorld(panes, { stale: true }), choice)),
    ).toEqual([["", [`gone:${choice.label}`]]]);
  });

  test("the tab keys step through live tabs as the Herdr TUI strip's do", () => {
    const world = coreWorld(panes);
    const [t1, t2, t3] = ["t1", "t2", "t3"].map((address) =>
      spacesCoreChoice(leaf(world, address)),
    );
    const groups = spacesCoreStrip(world, t2!);
    expect(spacesCoreStripStep(groups, t2!.nodeId, "next")).toEqual(t3);
    expect(spacesCoreStripStep(groups, t3!.nodeId, "next")).toEqual(t1);
    expect(spacesCoreStripStep(groups, t1!.nodeId, "previous")).toEqual(t3);
    expect(spacesCoreStripStep(groups, t1!.nodeId, 1)).toEqual(t2);
    expect(spacesCoreStripStep(groups, t1!.nodeId, 8)).toBeUndefined();
    // From a terminal that is gone, the keys go to the first or last.
    const stopped = coreWorld(panes.filter((p) => p.pane_id !== "t1"));
    const left = spacesCoreStrip(stopped, t1!);
    expect(spacesCoreStripStep(left, t1!.nodeId, "next")?.nodeId).toBe(
      t2!.nodeId,
    );
    expect(spacesCoreStripStep(left, t1!.nodeId, "previous")?.nodeId).toBe(
      t3!.nodeId,
    );
  });
});
