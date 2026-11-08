import { expect, test } from "bun:test";
import { buildWorldObject } from "../worldObject";
import {
  townScaleConnections,
  townScaleSceneConnection,
  townScaleSceneRequested,
  townScaleStep,
} from "./townScaleScene";
import { townStepLong } from "./townSteps";

test("the scale scene is the owner's maximum: 3 hosts, 8 rooms, 11–15 desks, 1–4 panes", () => {
  const hosts = townScaleConnections();
  expect(hosts.map((host) => host.label)).toEqual(["atlas", "nova", "zephyr"]);
  for (const host of hosts) {
    const { workspaces, tabs, panes } = host.snapshot!;
    expect(workspaces).toHaveLength(8);
    for (const room of workspaces) {
      const desks = tabs.filter((t) => t.workspace_id === room.workspace_id);
      expect(desks.length).toBeGreaterThanOrEqual(11);
      expect(desks.length).toBeLessThanOrEqual(15);
      expect(room.tab_count).toBe(desks.length);
      for (const desk of desks) {
        const seats = panes.filter((p) => p.tab_id === desk.tab_id);
        expect(seats.length).toBe(desk.pane_count);
        expect(seats.length).toBeGreaterThanOrEqual(1);
        expect(seats.length).toBeLessThanOrEqual(4);
      }
    }
  }
});

test("the scene mixes every agent state and is identical on each load", () => {
  const panes = townScaleConnections().flatMap((h) => h.snapshot!.panes);
  const agents = panes.filter((pane) => pane.agent);
  expect(agents.length).toBeGreaterThanOrEqual(36);
  const states = new Set(
    agents.map((a) =>
      a.task_summary?.startsWith("Asks") ? "asking" : a.agent_status,
    ),
  );
  expect([...states].sort()).toEqual(
    ["asking", "blocked", "done", "idle", "unknown", "working"].sort(),
  );
  expect(JSON.stringify(townScaleConnections())).toBe(
    JSON.stringify(townScaleConnections()),
  );
  // Synthetic only: no real-looking paths or hosts.
  expect(panes.every((pane) => pane.cwd?.startsWith("/synthetic/"))).toBe(true);
});

test("World builds the scene into hosts, rooms and agents", () => {
  const hosts = townScaleConnections();
  const world = buildWorldObject(hosts, hosts[0]!.connectionId);
  expect(world.hosts).toHaveLength(3);
  expect(world.leaves.filter((leaf) => leaf.kind === "agent").length).toBe(
    hosts.flatMap((h) => h.snapshot!.panes).filter((pane) => pane.agent).length,
  );
});

test("only ?scene=town-scale asks for the scene", () => {
  expect(townScaleSceneRequested("?scene=town-scale")).toBe(true);
  expect(townScaleSceneRequested("?view=town&scene=town-scale")).toBe(true);
  expect(townScaleSceneRequested("")).toBe(false);
  expect(townScaleSceneRequested("?scene=other")).toBe(false);
});

test("the scale scene's working agents have a mix of steps, some long", () => {
  const loadedAt = Date.parse("2026-11-08T12:00:00.000Z");
  const [atlas] = townScaleConnections();
  const working = atlas!.snapshot!.panes.filter(
    (pane) => pane.agent && pane.agent_status === "working",
  );
  const steps = working.map((pane) => townScaleStep(pane.pane_id, loadedAt));
  const kinds = new Set(steps.map((step) => step?.kind ?? null));
  for (const kind of ["edit", "test", "command", "read", "think"])
    expect(kinds.has(kind as never)).toBe(true);
  // The first room has a test run long enough for its amber tag.
  const firstRoom = working
    .filter((pane) => pane.workspace_id === "atlas-orbit")
    .map((pane) => townScaleStep(pane.pane_id, loadedAt));
  expect(
    firstRoom.some(
      (step) => step && townStepLong(step, loadedAt) && step.kind === "test",
    ),
  ).toBe(true);
  expect(townScaleStep(working[0]!.pane_id, loadedAt)).toEqual(
    townScaleStep(working[0]!.pane_id, loadedAt),
  );
  expect(townScaleSceneConnection("scene-atlas")).toBe(true);
  expect(townScaleSceneConnection("example")).toBe(false);
});
