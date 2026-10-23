import { expect, test } from "bun:test";
import { joinGroup, relationsOf } from "../../../shared/relations";
import { resolveTerminalColor } from "../../../shared/terminalColor";
import {
  relationObservations,
  relationsDeriver,
  runtimeRelationInputs,
  terminalPlaces,
  withInheritedColors,
} from "./relations";
import type { WorldRuntimeConnection } from "./runtimeStore";

/** One host: w1 holds t1 (parent), t2 (child) and t3 (grandchild); w2 holds t4. */
function connection(
  overrides: Partial<WorldRuntimeConnection> = {},
): WorldRuntimeConnection {
  const pane = (
    pane_id: string,
    terminal_id: string,
    tab_id: string,
    workspace_id = "w1",
    tokens?: Record<string, string>,
  ) => ({ pane_id, terminal_id, tab_id, workspace_id, tokens });
  return {
    connectionId: "studio",
    label: "Studio",
    source: "local",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [{ workspace_id: "w1" }, { workspace_id: "w2" }],
      tabs: [],
      panes: [
        pane("w1:p1", "term_1", "w1:t1"),
        pane("w1:p2", "term_2", "w1:t2", "w1", { spawned_by: "w1:p1" }),
        pane("w1:p3", "term_3", "w1:t3", "w1", { spawned_by: "w1:p2" }),
        pane("w2:p4", "term_4", "w2:t4", "w2", { spawned_by: "w1:p1" }),
      ],
      agents: [],
    },
    ...overrides,
  } as unknown as WorldRuntimeConnection;
}

const colorOf = (colors: Record<string, string>, tab: string, ws = "w1") =>
  resolveTerminalColor(colors, {
    connectionId: "studio",
    workspaceId: ws,
    tabId: tab,
    workspaceIds: new Set(["w1", "w2"]),
  });

function inherited(colors: Record<string, string>) {
  const connections = [connection()];
  return withInheritedColors(
    colors,
    relationsOf({ spawns: [], groups: [] }, relationObservations(connections)),
    terminalPlaces(connections),
  );
}

test("a spawned tab shows its parent's colour, through generations and rooms", () => {
  const colors = inherited({ "studio:w1:t1": "teal", "studio:w2": "pink" });
  expect(colorOf(colors, "w1:t2")).toEqual({ color: "teal", own: false });
  expect(colorOf(colors, "w1:t3")).toEqual({ color: "teal", own: false });
  // The parent's colour wins over the child's room colour.
  expect(colorOf(colors, "w2:t4", "w2")).toEqual({
    color: "teal",
    own: false,
  });
});

test("a chosen colour is never overwritten by inheritance", () => {
  const colors = inherited({
    "studio:w1:t1": "teal",
    "studio:w1:t2": "red",
  });
  expect(colorOf(colors, "w1:t2")).toEqual({ color: "red", own: true });
  // The grandchild follows its own parent's chosen colour.
  expect(colorOf(colors, "w1:t3")).toEqual({ color: "red", own: false });
});

test("manual groups do not change colours", () => {
  const connections = [connection()];
  const groups = joinGroup(
    [],
    [{ connection_id: "studio", terminal_id: "term_4" }],
    [{ connection_id: "studio", terminal_id: "term_2" }],
    "g1",
    1,
  );
  const relations = relationsOf(
    { spawns: [], groups },
    relationObservations(connections),
  ).filter((relation) =>
    relation.evidence.every((entry) => entry.kind === "manual"),
  );
  expect(
    withInheritedColors(
      { "studio:w1:t2": "red" },
      relations,
      terminalPlaces(connections),
    ),
  ).toEqual({ "studio:w1:t2": "red" });
});

test("a cached host is observed but not current", () => {
  const [observation] = relationObservations([
    connection({ stale: true, actionable: false }),
  ]);
  expect(observation?.current).toBe(false);
  expect(observation?.panes[1]?.tokens).toEqual({ spawned_by: "w1:p1" });
});

test("the derived relations keep their identity until something relevant changes", () => {
  const derive = relationsDeriver();
  const doc = { spawns: [], groups: [] };
  const first = derive(doc, runtimeRelationInputs([connection()]));
  // A new snapshot with the same relations and places.
  expect(derive({ ...doc }, runtimeRelationInputs([connection()]))).toBe(first);
  const moved = connection();
  moved.snapshot!.panes[1]!.tab_id = "w1:t9";
  expect(derive(doc, runtimeRelationInputs([moved]))).not.toBe(first);
});
