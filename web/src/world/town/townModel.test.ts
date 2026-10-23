import { expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../../types";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import {
  keepPlaceColors,
  NO_PLACE_COLORS,
  townPlaceColors,
  townRoomColorKey,
} from "./townModel";

/** One synthetic host with two workspaces of one tab each. */
function projection() {
  const workspaces: Workspace[] = ["w1", "w2"].map((id, index) => ({
    workspace_id: id,
    number: index + 1,
    label: id,
    focused: index === 0,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: `${id}:t1`,
    agent_status: "working",
  }));
  const tabs: Tab[] = workspaces.map((w) => ({
    tab_id: `${w.workspace_id}:t1`,
    workspace_id: w.workspace_id,
    number: 1,
    label: "Tab 1",
    focused: true,
    pane_count: 1,
    agent_status: "working",
  }));
  const panes: Pane[] = tabs.map((t) => ({
    pane_id: `${t.tab_id}:p1`,
    terminal_id: `term-${t.tab_id}`,
    workspace_id: t.workspace_id,
    tab_id: t.tab_id,
    focused: true,
    agent_status: "",
    revision: 1,
  }));
  const connection: WorldRuntimeConnection = {
    connectionId: "studio",
    label: "studio",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
  return projectWorldOffice(
    buildWorldObject([connection], "studio"),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
}

test("rooms and buildings show their workspace's and host's chosen colours", () => {
  const office = projection();
  const [first, second] = office.rooms;
  expect(townRoomColorKey(first!)).toBe("studio:w1");
  const colors = townPlaceColors(office, {
    "studio:w1": "teal",
    "@host:studio": "pink",
  });
  expect(colors.rooms.get(first!.key)).toBe("teal");
  // A room without a chosen colour keeps its own default carpet.
  expect(colors.rooms.has(second!.key)).toBe(false);
  expect(colors.hosts.get(office.hosts[0]!.key)).toBe("pink");
  // Nothing chosen: the shared empty value, so nothing repaints.
  expect(townPlaceColors(office, {})).toBe(NO_PLACE_COLORS);
});

test("the same colours keep the same object", () => {
  const office = projection();
  const one = townPlaceColors(office, { "studio:w1": "teal" });
  const two = townPlaceColors(office, { "studio:w1": "teal" });
  expect(keepPlaceColors(one, two)).toBe(one);
  const three = townPlaceColors(office, { "studio:w1": "red" });
  expect(keepPlaceColors(one, three)).toBe(three);
});
