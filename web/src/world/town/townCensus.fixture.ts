import type { Pane, Tab, Workspace } from "../../types";
import type { ProfilesDocument } from "../agentProfiles";
import {
  createOfficeProjector,
  prepareWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import {
  EMPTY_OFFICE_OBSERVABILITY,
  type OfficeObservability,
} from "../officeObservability";
import type { WorldRuntimeConnection } from "../runtimeStore";
import { buildWorldObject } from "../worldObject";
import { townCalls } from "./TownRail";
import { townSummary } from "./townSummary";

/** Census test towns (townCensus.test.ts, TownCensus.dom.test.ts). */

const NO_METRICS: OfficeObservability = {
  ...EMPTY_OFFICE_OBSERVABILITY,
  health: "unavailable",
};

/** A table: its status and harness; no harness is a plain shell. */
type Table = { status: string; agent?: string };

/** One synthetic host: rooms of tables, one pane per table. */
function host(id: string, rooms: Record<string, Table[]>) {
  const workspaces: Workspace[] = Object.keys(rooms).map((room, index) => ({
    workspace_id: room,
    number: index + 1,
    label: room,
    focused: index === 0,
    pane_count: rooms[room]!.length,
    tab_count: rooms[room]!.length,
    active_tab_id: `${room}:t0`,
    agent_status: "working",
  }));
  const tabs: Tab[] = [];
  const panes: Pane[] = [];
  for (const [room, tables] of Object.entries(rooms))
    tables.forEach(({ status, agent }, index) => {
      const tabId = `${room}:t${index}`;
      tabs.push({
        tab_id: tabId,
        workspace_id: room,
        number: index + 1,
        label: `${room} table ${index + 1}`,
        focused: index === 0,
        pane_count: 1,
        agent_status: status,
      });
      panes.push({
        pane_id: `${tabId}:p`,
        terminal_id: `term-${tabId}`,
        workspace_id: room,
        tab_id: tabId,
        focused: index === 0,
        ...(agent ? { agent, agent_status: status } : {}),
        last_activity_at: 1_000,
        revision: 1,
      } as Pane);
    });
  const connection: WorldRuntimeConnection = {
    connectionId: id,
    label: id,
    source: "saved-profile",
    isDefault: id === "studio",
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
  return connection;
}

const claude = (status: string): Table => ({ status, agent: "claude" });
const codex = (status: string): Table => ({ status, agent: "codex" });

/**
 * Two buildings: the studio has a busy Claude, a blocked Claude and a plain
 * shell in alpha; the lab has two quiet Codex agents in beta and gamma.
 */
export async function town() {
  const world = buildWorldObject(
    [
      host("studio", {
        alpha: [claude("working"), claude("blocked"), { status: "idle" }],
      }),
      host("lab", { beta: [codex("idle")], gamma: [codex("idle")] }),
    ],
    "studio",
  );
  await prepareWorldOffice(world);
  const office = createOfficeProjector(TOWN_PRESENTATION_BOUNDS)(
    world,
    1,
    null,
  );
  const calls = townCalls(
    office.roster,
    new Map(),
    [],
    (key) => office.roster.find(({ agent }) => agent.key === key),
    500,
  );
  return { world, office, summary: townSummary(office, calls, NO_METRICS) };
}

export const profiles = (
  assignments: { connection_id: string; terminal_id: string }[],
): ProfilesDocument => ({
  version: 1,
  revision: 1,
  profiles: [
    {
      id: "reviewer",
      name: "Reviewer",
      skills: ["code-review", "testing"],
    } as ProfilesDocument["profiles"][number],
  ],
  assignments: assignments.map((a) => ({ ...a, profile_id: "reviewer" })),
  chimes: {} as ProfilesDocument["chimes"],
  town_master: null,
});
