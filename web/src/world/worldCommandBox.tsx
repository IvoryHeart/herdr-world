/**
 * World's part of the command box (#782, #1329): what a search finds in World
 * on every runtime and machine, with the views' own matching (worldSearch.ts),
 * and the views to go to. Every view, Spaces included, lists the same finds
 * from the one World object. Enter opens what was found (its terminal in
 * Spaces, or a herdr-core terminal in World's window); the second action
 * (Shift+Enter, or the row's button) shows it in the current view as clicking
 * it there does.
 */

import {
  Armchair,
  Building,
  Cpu,
  DoorOpen,
  Search,
  Server,
  SquareTerminal,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type {
  ActionDefinition,
  ActionGroupDefinition,
  CommandExtension,
} from "../components/CommandCombobox";
import { AgentIcon } from "../components/AgentIcon";
import { AgentMark } from "../components/AgentMark";
import type { QualifiedFocusTarget } from "../store/types";
import type { InspectorView } from "../workspaceResource";
import { AGENT_MARKS, agentMarkKind } from "./agentMarks";
import {
  TERMINAL_COLOR_HEX,
  type TerminalColor,
  type TerminalColorTarget,
} from "./terminalColor";
import {
  inspectorAdmits,
  type WorldLeafObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";
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
  landmark: "Town",
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

/**
 * Where opening a found node goes: its connection, that connection's runtime
 * generation and its Herdr workspace and pane. The one place a found agent's
 * identity is made, so World's own agent IDs (#1309) can replace the
 * qualified pane identity here.
 */
export function worldFoundTarget(
  node: Exclude<WorldObjectNode, { kind: "host" }>,
): QualifiedFocusTarget {
  return node.kind === "space"
    ? {
        connectionId: node.connectionId,
        runtimeGeneration: node.generation,
        workspaceId: node.nativeId,
        paneId: null,
      }
    : {
        connectionId: node.connectionId,
        runtimeGeneration: node.generation,
        workspaceId: node.workspaceId,
        paneId: node.nativeId,
        terminalId: node.terminalId,
      };
}

/**
 * Why Enter cannot open a found node, or null when it can. An offline or
 * reconnecting host's agents stay listed, marked, and opening one says this.
 */
export function worldFindOpenReason(node: WorldObjectNode): string | null {
  if (node.hostState === "reconnecting")
    return `${node.hostLabel} is reconnecting. Try again when it is back.`;
  if (node.stale || node.hostState === "offline-stale")
    return `${node.hostLabel} is offline. World shows what it last saw there.`;
  if (node.kind === "host")
    return node.viewOnly
      ? `${node.hostLabel} runs herdr-core, which Spaces doesn't show. Find one of its agents instead.`
      : null;
  if (node.capabilities.openSpaces) return null;
  // World's window opens a live herdr-core terminal or room (inspectorAdmits).
  if (inspectorAdmits(node)) return null;
  if (node.kind === "space") return `World can't open ${node.label} here.`;
  return node.viewOnly
    ? "World only watches this herdr-core terminal from another machine, so it can't open it here."
    : `World can't open ${node.label} here.`;
}

/** What opening a found node needs from World's shell. */
export type WorldFindOpenDeps = {
  /** Focus a Herdr target on its own connection, making it Spaces' host. */
  activateSpacesTarget(target: QualifiedFocusTarget): Promise<boolean>;
  /** Make a ready Herdr host Spaces' host. */
  activateHost(node: WorldObjectNode): Promise<void>;
  goToSpaces(): void;
  /**
   * Open a node in World's window on a visual view (a herdr-core terminal's
   * Terminal tab, or a core room's Files), leaving Spaces first.
   */
  openInWorldWindow(
    target: QualifiedFocusTarget & { view: InspectorView },
  ): Promise<boolean>;
  notify(message: string, detail: string): void;
};

/**
 * Open a found node (#1329): a Herdr TUI agent, terminal, table or room in
 * Spaces, on its own connection with its tab and pane focused, whichever host
 * Spaces showed; a herdr-core terminal in World's window (Spaces shows Herdr
 * TUI workspaces only). What cannot open says why.
 */
export async function openWorldFind(
  node: WorldObjectNode,
  deps: WorldFindOpenDeps,
): Promise<boolean> {
  const fail = (detail: string) => {
    deps.notify(`Can't open ${node.label}`, detail);
    return false;
  };
  const reason = worldFindOpenReason(node);
  if (reason) return fail(reason);
  try {
    if (node.kind === "host") {
      if (node.capabilities.activateHost) await deps.activateHost(node);
      deps.goToSpaces();
      return true;
    }
    const target = worldFoundTarget(node);
    if (node.capabilities.openSpaces) {
      if (!(await deps.activateSpacesTarget(target)))
        return fail(`${node.label} is no longer where World last saw it.`);
      deps.goToSpaces();
      return true;
    }
    const opened = await deps.openInWorldWindow({
      ...target,
      view: node.kind === "space" ? "files" : "terminal",
    });
    return (
      opened || fail(`${node.label} is no longer where World last saw it.`)
    );
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The tab a leaf sits at, as the views look its colour up. */
export function worldLeafColorTarget(
  world: Pick<WorldObject, "spaces">,
  leaf: WorldLeafObject,
): TerminalColorTarget {
  return {
    connectionId: leaf.connectionId,
    workspaceId: leaf.workspaceId,
    tabId: leaf.tabId,
    workspaceIds: new Set(
      world.spaces
        .filter((space) => space.connectionId === leaf.connectionId)
        .map((space) => space.nativeId),
    ),
  };
}

/** What choosing a find does, and the colour the views give a tab. */
export type WorldFindHandlers = {
  /** Enter or a click: open it (openWorldFind). */
  open(node: WorldObjectNode): void;
  /**
   * The second action, in a visual view: show it there, offered for what the
   * view shows (a host the Hosts filter hides is found and opened, not shown).
   */
  show?: {
    label: string;
    shows?(node: WorldObjectNode): boolean;
    run(node: WorldObjectNode): void;
  };
  /** A leaf's tab colour as every view shows it (useTerminalColors). */
  colorOf?(leaf: WorldLeafObject): TerminalColor | null;
};

function findIcon(
  result: WorldSearchResult,
  node: WorldObjectNode | undefined,
  color: TerminalColor | null,
): ReactNode {
  const leaf =
    node?.kind === "agent" || node?.kind === "terminal" ? node : null;
  if (!leaf) return KIND_ICONS[result.kind as keyof typeof KIND_ICONS];
  return (
    <span
      className="world-find-icon"
      data-color={color ?? undefined}
      style={
        color
          ? ({
              "--world-find-color": TERMINAL_COLOR_HEX[color],
            } as CSSProperties)
          : undefined
      }
    >
      {leaf.kind === "agent" ? (
        <AgentIcon agent={leaf.pane.agent} compact />
      ) : (
        <SquareTerminal size={13} />
      )}
    </span>
  );
}

function findAction(
  result: WorldSearchResult,
  node: WorldObjectNode | undefined,
  handlers: WorldFindHandlers,
  isCore: (connectionId: string) => boolean,
): ActionDefinition {
  const leaf =
    node?.kind === "agent" || node?.kind === "terminal" ? node : null;
  const mark = result.status
    ? agentMarkKind(result.status, { offline: result.stale })
    : null;
  const excerpt = result.excerpt?.map((part) => part.text).join("");
  const core = node ? isCore(node.connectionId) : false;
  const runtime = core ? "herdr-core" : "Herdr TUI";
  return {
    key: `world-find-${result.id}`,
    icon: findIcon(
      result,
      node,
      leaf ? (handlers.colorOf?.(leaf) ?? null) : null,
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
    trailing: (
      <>
        <span
          className="world-find-runtime"
          role="img"
          aria-label={runtime}
          title={runtime}
        >
          {core ? <Cpu size={13} /> : <Server size={13} />}
        </span>
        {mark ? <AgentMark kind={mark} /> : null}
      </>
    ),
    score: RANK_SCORES[result.rank] ?? 0.5,
    run: () => {
      if (node) handlers.open(node);
    },
    ...(handlers.show && node && (handlers.show.shows?.(node) ?? true)
      ? {
          secondary: {
            label: handlers.show.label,
            run: () => handlers.show!.run(node),
          },
        }
      : {}),
  };
}

/** The found items for a search, or null when it finds nothing. */
export function worldFindGroup(
  world: WorldObject,
  search: string,
  handlers: WorldFindHandlers,
): ActionGroupDefinition | null {
  const results = worldSearchResults(world, search);
  if (!results.length) return null;
  const isCore = (connectionId: string) =>
    world.hosts.find((host) => host.connectionId === connectionId)?.connection
      .runtime === "herdr-core";
  const actions = results
    .slice(0, WORLD_COMMAND_FINDS)
    .map((result) =>
      findAction(result, world.nodeById.get(result.nodeId), handlers, isCore),
    );
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
