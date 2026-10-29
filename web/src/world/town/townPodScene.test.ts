import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import type { Pane, Tab, Workspace } from "../../types";
import { projectWorldOffice } from "../herdrOfficeProjection";
import { worldPods } from "../pods";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import { EMPTY_WORLD_SOURCES } from "../worldSources";
import { layoutTown, townShapeFor } from "./townLayout";
import { townModelFromProjection } from "./townModel";
import { townPodStacks, townPodTabs, townStackedInput } from "./townPods";
import { TownPodPlaque } from "./TownPodPlaque";
import { townTargets } from "./townTargets";
import { townTeams } from "./townTeams";

/**
 * A pod end to end, from Herdr tabs to the drawn scene: the watcher's round
 * tabs and the author's tab in one room, the pull request from World sources.
 */
function scene(labels: string[], sources: WorldSourcesSnapshot) {
  const workspace: Workspace = {
    workspace_id: "room",
    label: "Studio",
    number: 1,
    focused: true,
    tab_count: labels.length,
    pane_count: labels.length,
    active_tab_id: "t0",
    agent_status: "",
  };
  const tabs: Tab[] = labels.map((label, index) => ({
    workspace_id: "room",
    tab_id: `t${index}`,
    label,
    number: index + 1,
    focused: index === 0,
    pane_count: 1,
    agent_status: "",
  }));
  const panes: Pane[] = labels.map((_, index) => ({
    pane_id: `p${index}`,
    terminal_id: `term${index}`,
    workspace_id: "room",
    tab_id: `t${index}`,
    focused: index === 0,
    agent: "claude",
    agent_status: "done",
    revision: 1,
  }));
  const connection: WorldRuntimeConnection = {
    connectionId: "host",
    label: "Host",
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs, panes, agents: [] },
  };
  const projection = projectWorldOffice(
    buildWorldObject([connection], "host"),
    1,
  );
  const base = townModelFromProjection(projection);
  const pods = worldPods(townPodTabs(projection), sources);
  const stacks = townPodStacks(base, pods);
  const model = {
    ...base,
    input: townStackedInput(base.input, stacks.stacked),
    deskStacks: stacks.stacks,
  };
  const { layout } = layoutTown(model.input, townShapeFor(1440, 900));
  const teams = townTeams(model, layout, [], new Map(), pods);
  const deskOf = (label: string) =>
    [...model.desks.values()].find((desk) => desk.displayLabel === label)!.key;
  return { model, layout, pods, stacks, teams, deskOf };
}

const item: WorkItem = {
  key: "github:pr:example-org/atlas#512",
  source: "github",
  kind: "pull_request",
  ref: "example-org/atlas#512",
  title: "Sync settings",
  url: "https://github.com/example-org/atlas/pull/512",
  lane: "fixing",
  status: "open",
  roles: ["author"],
  updatedAt: 0,
  number: 512,
  review: "changes_requested",
};

const linkedTo = (paneId: string): WorldSourcesSnapshot => ({
  ...EMPTY_WORLD_SOURCES,
  items: [item],
  links: [
    {
      connectionId: "host",
      generation: 1,
      paneId,
      sessionFingerprint: null,
      itemKey: item.key,
      via: "branch",
    },
  ],
});

test("a two-round pod walls its author and current round, earlier round stacked", () => {
  const { teams, stacks, deskOf, model, layout } = scene(
    ["builder", "#512 settings-sync · r1", "#512 settings-sync · r2", "docs"],
    linkedTo("p0"),
  );
  const current = deskOf("#512 settings-sync · r2");
  const earlier = deskOf("#512 settings-sync · r1");
  expect([...stacks.stacks]).toEqual([[current, 1]]);
  // The earlier round has no cell or target of its own.
  const cells = layout.buildings.flatMap((b) =>
    b.rooms.flatMap((r) => r.cells),
  );
  expect(cells.some((cell) => cell.deskKey === earlier)).toBe(false);
  expect(
    townTargets(model, layout, teams.deskTeams).some(
      (target) => target.key === earlier,
    ),
  ).toBe(false);
  // Author and current round touch: one wall, holding both.
  expect(teams.walls).toHaveLength(1);
  expect(teams.walls[0]!.desks).toBe(2);
  expect(teams.deskTeams.get(deskOf("builder"))).toBe(
    teams.deskTeams.get(current),
  );
  expect(teams.deskTeams.has(deskOf("docs"))).toBe(false);
  const [plaque] = teams.plaques;
  expect(plaque!.pod.state).toBe("fixes");
  const html = renderToStaticMarkup(
    createElement(TownPodPlaque, { plaque: plaque!, left: 0, top: 0 }),
  );
  expect(html).toContain(
    'aria-label="Pod #512 settings-sync, Sync settings: Fixes requested, r2 · +1 earlier"',
  );
  expect(html).toContain('data-state="fixes"');
});

test("a merged pull request's closed round tabs leave no pod behind", () => {
  const { teams, pods } = scene(["builder", "docs"], linkedTo("p0"));
  expect(pods).toEqual([]);
  expect(teams.plaques).toEqual([]);
  expect(teams.walls).toEqual([]);
});
