/**
 * Town's lenses over Board's cards. A workspace card is a Town room, a tab
 * card a desk and a pane its agent, under the keys Town uses (a room is its
 * World space ID, a desk officeDeskKey, an agent its leaf ID), so a lens
 * reads the same fact on either view: one read model, two projections.
 *
 * Pure: places, desk work and readings from Board's model.
 */

import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import { target } from "../officeAgent";
import { officeDeskKey } from "../officeRoom";
import { deskWork } from "../town/townBadges";
import type {
  LensAgent,
  LensDesk,
  LensPlaces,
  TownLensMark,
  TownLensView,
} from "../town/townLens";
import { townScaleLensFacts } from "../town/townScaleLens";
import type { WorldLeafObject } from "../worldObject";
import type { BoardModel, BoardTab, BoardWorkspace } from "./boardModel";

/** A tab card's desk key, as Town keys the same tab. */
export const boardLensDeskKey = (tab: Pick<BoardTab, "hostKey" | "nativeId">) =>
  officeDeskKey(tab.hostKey, tab.nativeId);

/** A workspace card's room key: its World space ID, as Town's. */
export const boardLensRoomKey = (space: BoardWorkspace) => space.space.id;

function lensAgent(leaf: WorldLeafObject): LensAgent {
  return {
    key: leaf.id,
    nodeId: leaf.id,
    roomKey: leaf.parentId,
    // As Town admits it: a stale agent's state is unknown.
    semanticStatus: leaf.stale ? "unknown" : leaf.status,
    stale: leaf.stale,
    ...(leaf.agentLabel ? { harness: leaf.agentLabel } : {}),
  };
}

function lensDesk(space: BoardWorkspace, tab: BoardTab): LensDesk {
  const agents = tab.panes
    .filter((pane) => pane.isAgent)
    .map((pane) => lensAgent(pane.leaf));
  // As Town seats a desk: an agent at work (or of unknown state) occupies it.
  const occupant = agents.find(
    (agent) =>
      agent.semanticStatus === "working" || agent.semanticStatus === "unknown",
  );
  return {
    key: boardLensDeskKey(tab),
    tabRef: target(space.space, "tab", tab.nativeId),
    ...(occupant ? { occupantAgentKey: occupant.key } : {}),
    panes: tab.panes.length,
    agents,
  };
}

/** Every workspace and tab on the board, as a lens reads them. */
export function boardLensPlaces(model: BoardModel): LensPlaces {
  return {
    rooms: model.workspaces.map((space) => {
      const desks = space.tabKeys.flatMap((key) => {
        const tab = model.tabByKey.get(key);
        return tab ? [lensDesk(space, tab)] : [];
      });
      return {
        key: boardLensRoomKey(space),
        workspaceRef: target(space.space, "workspace", space.nativeId),
        hostLabel: model.hostByKey.get(space.hostKey)?.label ?? space.hostKey,
        desks,
        agents: desks.flatMap((desk) => desk.agents),
      };
    }),
  };
}

/** Each tab's linked work item (as Town's desk badge picks it), by desk key. */
export function boardDeskWork(
  model: BoardModel,
  snapshot: WorldSourcesSnapshot,
): ReadonlyMap<string, WorkItem> {
  if (!snapshot.links.length) return new Map();
  return deskWork(
    model.tabs.map((tab) => ({
      key: boardLensDeskKey(tab),
      panes: tab.panes.map((pane) => ({
        connectionId: pane.leaf.connectionId,
        paneId: pane.leaf.nativeId,
        generation: pane.leaf.generation,
        ...(pane.leaf.agentSessionFingerprint
          ? { agentSessionFingerprint: pane.leaf.agentSessionFingerprint }
          : {}),
        agent: pane.isAgent,
      })),
    })),
    snapshot,
  );
}

/**
 * The scale scene's synthetic pull requests (`?scene=town-scale`), the ones
 * its Pull requests lens shows, so the preview's cards carry badges too.
 */
export function boardSceneWork(
  places: LensPlaces,
  now: number,
): ReadonlyMap<string, WorkItem> {
  const facts = townScaleLensFacts(now, () => []);
  const work = new Map<string, WorkItem>();
  for (const room of places.rooms)
    for (const desk of room.desks) {
      const item = facts.work(desk);
      if (item) work.set(desk.key, item);
    }
  return work;
}

/** A card's or pane row's reading under the lens on. */
export function boardLensMark(
  view: TownLensView | null,
  model: BoardModel,
  key: string,
  leafId?: string,
): TownLensMark | undefined {
  if (!view) return undefined;
  if (leafId) {
    const agent = view.agents.get(leafId);
    if (agent) return agent;
  }
  const space = model.workspaceByKey.get(key);
  if (space) return view.rooms.get(boardLensRoomKey(space));
  const tab = model.tabByKey.get(key);
  return tab ? view.desks.get(boardLensDeskKey(tab)) : undefined;
}

/** The hovered, focused or selected card's reading, for the legend. */
export function boardLensReadout(
  view: TownLensView | null,
  model: BoardModel,
  point: { key: string; paneKey?: string } | null,
): string | null {
  if (!view || !point) return null;
  const tab = model.tabByKey.get(point.key);
  const pane = point.paneKey
    ? tab?.panes.find((row) => row.key === point.paneKey)
    : undefined;
  const label = pane
    ? (pane.leaf.agentName ?? pane.leaf.label)
    : (model.workspaceByKey.get(point.key)?.label ?? tab?.label);
  if (label === undefined) return null;
  const mark = boardLensMark(view, model, point.key, pane?.leaf.id);
  return `${label}: ${mark?.words ?? "nothing to show"}`;
}

/** The card (and pane row) of the selected workspace or pane. */
export function boardLensSelected(
  model: BoardModel,
  selectedId: string | null,
): { key: string; paneKey?: string } | null {
  if (!selectedId) return null;
  const space = model.workspaces.find((entry) => entry.space.id === selectedId);
  if (space) return { key: space.key };
  for (const tab of model.tabs) {
    const pane = tab.panes.find((row) => row.leaf.id === selectedId);
    if (pane)
      return tab.panes.length > 1
        ? { key: tab.key, paneKey: pane.key }
        : { key: tab.key };
  }
  return null;
}
