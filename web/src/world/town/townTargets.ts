import type {
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "../herdrOfficeProjection";
import { TOWN_TILE as T, townSeat, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";

export type TownTarget = {
  key: string;
  kind: "room" | "desk" | "agent" | "pane";
  label: string;
  /** World-pixel rectangle. */
  rect: { x: number; y: number; width: number; height: number };
  canActivate: boolean;
  /** A desk's colour, its own or the one it inherits, for tests and tools. */
  color?: string;
};

const STATUS_TEXT: Record<OfficeAgent["semanticStatus"], string> = {
  working: "working",
  blocked: "needs input",
  done: "done",
  idle: "on a break",
  unknown: "unknown",
};

export function townAgentLabel(
  model: TownModel,
  agent: OfficeAgent,
  desk?: OfficeDesk,
) {
  const entry = model.projection.roster.find(
    ({ agent: candidate }) => candidate.key === agent.key,
  );
  const state = agent.stale
    ? "stale"
    : (agent.stateLabels[agent.semanticStatus] ??
      STATUS_TEXT[agent.semanticStatus]);
  const location = desk
    ? `desk ${desk.displayLabel}, ${entry?.roomLabel ?? "Office"}`
    : (entry?.roomLabel ?? "Office");
  const host =
    entry?.hostLabel ?? model.hosts.get(agent.hostKey)?.displayLabel ?? "host";
  const summary = agent.taskSummary ? `, ${agent.taskSummary}` : "";
  return `${agent.displayLabel}, ${state}, ${location}, ${host}${summary}`;
}

export function townRoomLabel(model: TownModel, room: OfficeRoom) {
  const host = model.hosts.get(room.hostKey)?.displayLabel ?? "host";
  return `Room ${room.accessibleLabel ?? room.displayLabel}, ${host}`;
}

function deskLabel(
  model: TownModel,
  desk: OfficeDesk,
  teammates: readonly string[] = [],
) {
  const room = model.rooms.get(desk.roomKey);
  const host = model.hosts.get(desk.hostKey)?.displayLabel ?? "host";
  const team = teammates.length
    ? `, in a team with ${teammates.join(", ")}`
    : "";
  return `${desk.occupantAgentKey ? "Desk" : "Empty desk"} ${desk.displayLabel}, ${room?.displayLabel ?? "Office"}, ${host}, ${desk.observedPaneCount} panes${team}`;
}

/**
 * Accessible targets for every presented room, desk, pane and seated agent.
 * A desk in a team (townTeams.ts) names its teammates, since the walls and
 * connectors are drawn only.
 */
export function townTargets(
  model: TownModel,
  layout: TownLayout,
  deskTeams: ReadonlyMap<string, string> = new Map(),
): TownTarget[] {
  const teams = new Map<string, string[]>();
  for (const [deskKey, team] of deskTeams)
    teams.set(team, [...(teams.get(team) ?? []), deskKey]);
  const teammates = (desk: OfficeDesk) =>
    (teams.get(deskTeams.get(desk.key) ?? "") ?? []).flatMap((key) => {
      const label =
        key === desk.key ? null : model.desks.get(key)?.displayLabel;
      return label ? [label] : [];
    });
  const targets: TownTarget[] = [];
  for (const building of layout.buildings)
    for (const placed of building.rooms) {
      const room = model.rooms.get(placed.key);
      if (!room) continue;
      targets.push({
        key: room.key,
        kind: "room",
        label: townRoomLabel(model, room),
        rect: {
          x: placed.x * T,
          y: placed.y * T,
          width: placed.w * T,
          height: T,
        },
        canActivate: true,
      });
      for (const cell of placed.cells) {
        if (!cell.deskKey) continue;
        const desk = model.desks.get(cell.deskKey);
        if (!desk) continue;
        targets.push({
          key: desk.key,
          kind: "desk",
          label: deskLabel(model, desk, teammates(desk)),
          color: model.deskColors.get(desk.key),
          rect: {
            x: (cell.x + 1) * T,
            y: cell.y * T + 17,
            width: 64,
            height: 24,
          },
          canActivate: desk.canOpenInSpaces,
        });
        desk.paneDevices.forEach((device, seat) => {
          const geometry = townSeat(cell, seat);
          const rect = {
            x: geometry.cx - 12,
            y: geometry.top ? geometry.tableY : geometry.tableY + 34,
            width: 24,
            height: 24,
          };
          const agent = device.agentKey
            ? model.agents.get(device.agentKey)
            : undefined;
          if (agent)
            targets.push({
              key: agent.key,
              kind: "agent",
              label: townAgentLabel(model, agent, desk),
              rect,
              canActivate: agent.canOpenInSpaces,
            });
          else
            targets.push({
              key: device.key,
              kind: "pane",
              label: `${device.displayLabel}, desk ${desk.displayLabel}, ${desk.observedPaneCount} panes${device.stale ? ", stale" : ""}`,
              rect,
              canActivate: device.canOpenInSpaces,
            });
        });
      }
    }
  return targets;
}
