/**
 * World's part of the command box (#782): what a search finds in World, with
 * the views' own matching (worldSearch.ts), and the views to go to. Choosing
 * a found item selects it as clicking it in the view does; the box offers
 * nothing World's views and menus do not already offer.
 */

import {
  Armchair,
  Building,
  DoorOpen,
  Search,
  SquareTerminal,
} from "lucide-react";
import type {
  ActionDefinition,
  ActionGroupDefinition,
  CommandExtension,
} from "../components/CommandCombobox";
import { AgentMark } from "../components/AgentMark";
import { AGENT_MARKS, agentMarkKind } from "./agentMarks";
import type { WorldObject } from "./worldObject";
import { worldSearchResults, type WorldSearchResult } from "./worldSearch";
import { WORLD_VIEW_DESTINATIONS } from "./WorldMobileNav";
import type { WorldView } from "./worldViewRouting";

/** Found items the box lists; more words narrow the rest. */
export const WORLD_COMMAND_FINDS = 8;

export const WORLD_COMMAND_PLACEHOLDER =
  "Find an agent, room or table, or an action…";

const KIND_WORDS: Record<WorldSearchResult["kind"], string> = {
  building: "Building",
  room: "Room",
  table: "Table",
  agent: "Agent",
  terminal: "Terminal",
};

const KIND_ICONS = {
  building: <Building size={15} />,
  room: <DoorOpen size={15} />,
  table: <Armchair size={15} />,
  terminal: <SquareTerminal size={15} />,
};

/**
 * Names first, then places, then task summaries, as the views rank them;
 * a name ties with an action whose title has the search.
 */
const RANK_SCORES = [0.95, 0.8, 0.6];

function findAction(
  result: WorldSearchResult,
  onChoose: (nodeId: string) => void,
): ActionDefinition {
  const mark = result.status
    ? agentMarkKind(result.status, { offline: result.stale })
    : null;
  const excerpt = result.excerpt?.map((part) => part.text).join("");
  return {
    key: `world-find-${result.id}`,
    icon: mark ? (
      <AgentMark kind={mark} />
    ) : (
      KIND_ICONS[result.kind as keyof typeof KIND_ICONS]
    ),
    title: result.label,
    detail: [
      KIND_WORDS[result.kind],
      mark ? AGENT_MARKS[mark].word : null,
      result.stale && !mark ? "stale" : null,
      result.place.join(" › ") || null,
      excerpt ?? null,
    ]
      .filter(Boolean)
      .join(" · "),
    score: RANK_SCORES[result.rank] ?? 0.5,
    run: () => onChoose(result.nodeId),
  };
}

/** The found items for a search, or null when it finds nothing. */
export function worldFindGroup(
  world: WorldObject,
  search: string,
  onChoose: (nodeId: string) => void,
): ActionGroupDefinition | null {
  const results = worldSearchResults(world, search);
  if (!results.length) return null;
  const actions = results
    .slice(0, WORLD_COMMAND_FINDS)
    .map((result) => findAction(result, onChoose));
  const more = results.length - actions.length;
  if (more > 0)
    actions.push({
      key: "world-find-more",
      icon: <Search size={15} />,
      title: `${more} more in World`,
      disabledReason: "Add a word to narrow the search",
      score: 0.01,
      run: () => {},
    });
  return { heading: "In World", actions };
}

/** Going to each view but the current one. */
export function worldViewGroup(
  view: WorldView,
  onSelect: (view: WorldView) => void,
): ActionGroupDefinition {
  return {
    heading: "Views",
    actions: WORLD_VIEW_DESTINATIONS.filter(
      (destination) => destination.view !== view,
    ).map(({ view: destination, label, Icon }) => ({
      key: `world-view-${destination}`,
      icon: <Icon size={15} />,
      title: `Go to ${label}`,
      keywords: ["view", "switch", "open", destination],
      run: () => onSelect(destination),
    })),
  };
}

/** The visual views' actions with the views to go to after them. */
export function withWorldViews(
  extension: CommandExtension,
  view: WorldView,
  onSelect: (view: WorldView) => void,
): CommandExtension {
  // Before a view's actions are ready, the box keeps its own.
  if (!extension.groups.length) return extension;
  return {
    ...extension,
    groups: [...extension.groups, worldViewGroup(view, onSelect)],
  };
}
