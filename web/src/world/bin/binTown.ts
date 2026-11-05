import {
  binEmptiesPinnedTab,
  type BinReservation,
  type BinTarget,
} from "../../../../shared/bin";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { OfficeAgent } from "../officeProjectionTypes";
import { withOfficeReadModel } from "../officeReadModel";
import { PINNED_TAB_LAST_PANE_CLOSE_REASON, tabPinsFor } from "../../tabPins";
import type { BinDrop } from "./binStore";

const terminalKey = (connectionId: string, terminalId: string) =>
  `${connectionId}\u0000${terminalId}`;

/** The agent each bin entry names, matched by its connection and terminal. */
export function binnedAgents(
  office: HerdrOfficeProjection,
  entries: readonly BinReservation[],
): Map<string, OfficeAgent> {
  const byTerminal = new Map<string, OfficeAgent>();
  for (const { agent } of office.roster)
    byTerminal.set(
      terminalKey(
        agent.currentTerminalRef.connectionId,
        agent.currentTerminalRef.nativeId,
      ),
      agent,
    );
  const result = new Map<string, OfficeAgent>();
  for (const entry of entries) {
    const agent = byTerminal.get(
      terminalKey(entry.connection_id, entry.terminal_id),
    );
    if (
      agent &&
      agent.currentTerminalRef.generation === entry.connection_generation
    )
      result.set(entry.id, agent);
  }
  return result;
}

/**
 * The town without the agents waiting in the bin: they ride the bus instead
 * of sitting at their desks. Their desks and rooms stay where they are.
 */
export function withoutBinnedAgents(
  office: HerdrOfficeProjection,
  keys: ReadonlySet<string>,
): HerdrOfficeProjection {
  if (!keys.size) return office;
  const keep = (agent: OfficeAgent) => !keys.has(agent.key);
  const list = (agents: OfficeAgent[]) =>
    agents.some((agent) => !keep(agent)) ? agents.filter(keep) : agents;
  const result: HerdrOfficeProjection = {
    ...office,
    rooms: office.rooms.map((room) => {
      const roomAgents = list(room.roomAgents);
      return roomAgents === room.roomAgents ? room : { ...room, roomAgents };
    }),
    receptions: office.receptions.map((reception) => {
      const waitingAgents = list(reception.waitingAgents);
      return waitingAgents === reception.waitingAgents
        ? reception
        : { ...reception, waitingAgents };
    }),
    barAgents: list(office.barAgents),
    roster: office.roster.filter((entry) => keep(entry.agent)),
  };
  return withOfficeReadModel(office, result);
}

/** What the bin needs to stage an agent, or why it cannot go in. */
export function binDropOfAgent(
  office: HerdrOfficeProjection,
  agentKey: string,
  view: BinDrop["view"],
  /** Entries already waiting in the bin: their panes close first. */
  staged: readonly BinTarget[] = [],
  pinnedTabs?: ReadonlySet<string>,
): BinDrop | { refusal: string } {
  const agent = office.roster.find(
    (entry) => entry.agent.key === agentKey,
  )?.agent;
  if (!agent) return { refusal: "That agent has already closed or moved" };
  if (agent.stale) return { refusal: "That agent's host is unreachable" };
  const room = office.rooms.find((item) => item.key === agent.roomKey);
  // A tab pin (kept in this browser) protects the tab's last pane.
  const desk = room?.desks.find((item) => item.key === agent.deskKey);
  const pins = pinnedTabs ?? tabPinsFor(agent.currentPaneRef.connectionId);
  const pinned =
    pins.has(agent.currentTabRef.nativeId) &&
    binEmptiesPinnedTab(
      {
        connection_id: agent.currentPaneRef.connectionId,
        connection_generation: agent.currentPaneRef.generation,
        pane_id: agent.currentPaneRef.nativeId,
      },
      (desk?.paneDevices ?? []).map((device) => ({
        pane_id: device.paneRef.nativeId,
        terminal_id: device.terminalRef.nativeId,
      })),
      staged,
    );
  if (pinned)
    return { refusal: PINNED_TAB_LAST_PANE_CLOSE_REASON.replace(/\.$/u, "") };
  const workspace = room?.workspaceRef;
  const { currentPaneRef: pane, currentTabRef: tab } = agent;
  const terminal = agent.currentTerminalRef;
  if (
    !workspace ||
    workspace.connectionId !== pane.connectionId ||
    tab.connectionId !== pane.connectionId ||
    terminal.connectionId !== pane.connectionId
  )
    return { refusal: "That agent's place is not known yet" };
  return {
    connection_id: pane.connectionId,
    connection_generation: pane.generation,
    workspace_id: workspace.nativeId,
    tab_id: tab.nativeId,
    pane_id: pane.nativeId,
    terminal_id: terminal.nativeId,
    label: agent.agentName ?? agent.displayLabel,
    view,
    preserve_tab: pins.has(tab.nativeId),
  };
}
