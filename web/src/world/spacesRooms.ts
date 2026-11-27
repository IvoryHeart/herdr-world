import type { Tab } from "../types";
import { runtimeTag } from "../worldHosts";
import { officeDeskLabel } from "./officeAgent";
import type {
  WorldHostObject,
  WorldLeafObject,
  WorldSpaceObject,
} from "./worldObject";

export type SpacesRoomTab = {
  tab: Tab;
  /** The tab's name, as Town names its desk (officeAgent.ts). */
  label: string;
  /** The tab's terminals the navigator shows (bounded, treeProjection.ts). */
  leaves: WorldLeafObject[];
  /** The terminal choosing the tab opens: its agent, else its first. */
  opens: WorldLeafObject | undefined;
};

export type SpacesRoom = {
  workspaceId: string;
  /** World's name for the room, as Town's plaque reads it. */
  label: string;
  runtime: "herdr" | "herdr-core";
  /** The runtime in words: "Herdr TUI", "herdr-core" (worldHosts.ts). */
  runtimeTag: string;
  /** The runtime's own tabs, in its order. */
  tabs: SpacesRoomTab[];
  /** Shown terminals whose tab the room does not list (none normally). */
  untabbed: WorldLeafObject[];
};

/**
 * One room as Spaces lists it, read from World: a room is a room and a tab a
 * tab on every runtime, named as Town names them (room: `space.label`; tab:
 * `officeDeskLabel`), with the runtime it lives on. Spaces derives no name
 * of its own.
 */
export function spacesRoom(
  host: Pick<WorldHostObject, "connection">,
  space: WorldSpaceObject,
  shown: readonly WorldLeafObject[],
): SpacesRoom {
  const runtime = host.connection.runtime ?? "herdr";
  const tabIds = new Set(space.tabs.map((tab) => tab.tab_id));
  const all = byTab(space.children);
  const visible = byTab(shown);
  return {
    workspaceId: space.workspace.workspace_id,
    label: space.label,
    runtime,
    runtimeTag: runtimeTag(runtime),
    tabs: space.tabs.map((tab) => {
      const leaves = all.get(tab.tab_id) ?? [];
      return {
        tab,
        // Town names a desk from all its tab's terminals (officeRoom.ts).
        label: officeDeskLabel(leaves, tab),
        leaves: visible.get(tab.tab_id) ?? [],
        opens: leaves.find((leaf) => leaf.kind === "agent") ?? leaves[0],
      };
    }),
    untabbed: shown.filter((leaf) => !tabIds.has(leaf.tabId)),
  };
}

function byTab(leaves: readonly WorldLeafObject[]) {
  const tabs = new Map<string, WorldLeafObject[]>();
  for (const leaf of leaves) {
    const list = tabs.get(leaf.tabId);
    if (list) list.push(leaf);
    else tabs.set(leaf.tabId, [leaf]);
  }
  return tabs;
}
