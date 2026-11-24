/**
 * World's part of the one search box (#782, #1329, #1355): what a search
 * finds in World on every runtime and machine, with the views' own matching
 * (worldSearch.ts), and the views to go to. Every view, Spaces included,
 * lists the same finds from the one World object. Choosing one (Enter or a
 * click) goes to it in the current view, as `/` always did: Town flies to its
 * table and keeps the list open, so choosing it again opens its Inspector;
 * Board and Desk select it, Spaces shows its terminal. The second
 * action (Shift+Enter, or the row's button) opens its terminal in Spaces, on
 * its own connection whichever runtime runs it. Where the current view cannot
 * show a find (Code, or a host the Hosts filter hides), choosing opens it and
 * the row says so. worldFinder.ts holds the search the box shares with a view.
 */

import {
  Armchair,
  Building,
  Cpu,
  DoorOpen,
  Landmark,
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
import { AGENT_MARKS, agentMarkKind } from "./agentMarks";
import {
  TERMINAL_COLOR_HEX,
  type TerminalColor,
  type TerminalColorTarget,
} from "./terminalColor";
import {
  type WorldLeafObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";
import { worldSearchResults, type WorldSearchResult } from "./worldSearch";
import { WORLD_VIEW_DESTINATIONS } from "./WorldMobileNav";
import type { WorldView } from "./worldViewRouting";

/**
 * Found items the box lists at once; its Next and Previous rows page through
 * the rest, so every match stays reachable however alike they look.
 */
export const WORLD_COMMAND_FINDS = 12;

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
  landmark: <Landmark size={15} />,
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
 * @internal Exported for its unit tests.
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
 * The live herdr-core terminal Spaces shows for a found core node: the agent
 * or terminal itself, or for a core room the one it focuses, else its first
 * agent, else its first terminal. Undefined for a Herdr TUI node, or a core
 * one World does not watch (stale, or watched from another machine).
 */
export function coreSpacesLeaf(
  node: WorldObjectNode,
): WorldLeafObject | undefined {
  const watched = (leaf: WorldLeafObject) =>
    leaf.coreControl === true && !leaf.stale && leaf.watch !== undefined;
  if (node.kind === "agent" || node.kind === "terminal")
    return watched(node) ? node : undefined;
  if (node.kind !== "space" || node.coreControl !== true || node.stale) return;
  const live = node.children.filter(watched);
  return (
    live.find((leaf) => leaf.focused) ??
    live.find((leaf) => leaf.kind === "agent") ??
    live[0]
  );
}

/**
 * Why Enter cannot open a found node, or null when it can. An offline or
 * reconnecting host's agents stay listed, marked, and opening one says this.
 * @internal Exported for its unit tests.
 */
export function worldFindOpenReason(node: WorldObjectNode): string | null {
  if (node.hostState === "reconnecting")
    return `${node.hostLabel} is reconnecting. Try again when it is back.`;
  if (node.stale || node.hostState === "offline-stale")
    return `${node.hostLabel} is offline. World shows what it last saw there.`;
  if (node.kind === "host")
    return node.viewOnly
      ? `${node.hostLabel} runs herdr-core. Find one of its agents or rooms to open it in Spaces.`
      : null;
  if (node.capabilities.openSpaces) return null;
  // Spaces shows a live herdr-core terminal World watches (coreSpacesLeaf).
  if (coreSpacesLeaf(node)) return null;
  if (node.kind === "space")
    return node.coreControl
      ? `${node.label} has no terminal open.`
      : `World can't open ${node.label} here.`;
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
  /**
   * Show a live herdr-core terminal in Spaces, on its own connection and
   * runtime generation; false when World no longer sees it there.
   */
  openCoreInSpaces(leaf: WorldLeafObject): boolean;
  goToSpaces(): void;
  notify(message: string, detail: string): void;
};

/**
 * Open a found node (#1329) in Spaces, on its own connection with its tab and
 * pane focused, whichever host Spaces showed: a Herdr TUI agent, terminal,
 * table or room through Herdr's focus, a herdr-core terminal (or a core
 * room's terminal) through World's watch of it. What cannot open says why.
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
  const moved = () =>
    fail(`${node.label} is no longer where World last saw it.`);
  try {
    if (node.kind === "host") {
      if (node.capabilities.activateHost) await deps.activateHost(node);
      deps.goToSpaces();
      return true;
    }
    if (node.capabilities.openSpaces) {
      if (!(await deps.activateSpacesTarget(worldFoundTarget(node))))
        return moved();
      deps.goToSpaces();
      return true;
    }
    const leaf = coreSpacesLeaf(node);
    if (!leaf || !deps.openCoreInSpaces(leaf)) return moved();
    deps.goToSpaces();
    return true;
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
  /**
   * Open its terminal in Spaces (openWorldFind): the second action, or what
   * choosing does where the current view cannot show it.
   */
  open(node: WorldObjectNode): void;
  /**
   * Go to it in the current view (Town, Board, Desk): what choosing does, for
   * what the view shows (a host the Hosts filter hides is opened instead).
   */
  go?: {
    shows?(node: WorldObjectNode): boolean;
    /** Whether choosing it now leaves the box open (Town's first choice). */
    stays?(result: WorldSearchResult): boolean;
    run(result: WorldSearchResult): void;
  };
  /** Said on a row whose choosing opens it, outside Spaces. */
  opensNote?: string;
  /** Results only the current view has, such as Town's landmarks. */
  extra?(search: string): readonly WorldSearchResult[];
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
  // A view's own result (a landmark) has no node: the view always shows it.
  const goes = Boolean(
    handlers.go && (!node || (handlers.go.shows?.(node) ?? true)),
  );
  const open = node
    ? {
        label: leaf ? "Open terminal" : "Open in Spaces",
        run: () => handlers.open(node),
      }
    : null;
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
      !goes ? (handlers.opensNote ?? null) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    trailing: node ? (
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
    ) : undefined,
    score: RANK_SCORES[result.rank] ?? 0.5,
    run: () => {
      if (goes) handlers.go!.run(result);
      else open?.run();
    },
    ...(goes && open ? { secondary: open } : {}),
    ...(goes && handlers.go!.stays
      ? { stay: () => handlers.go!.stays!(result) }
      : {}),
  };
}

/**
 * A page of the found items for a search, from the `from`th, or null when it
 * finds nothing. The box pages through the rest (ActionGroupDefinition.page).
 */
export function worldFindGroup(
  world: WorldObject,
  search: string,
  handlers: WorldFindHandlers,
  from = 0,
): ActionGroupDefinition | null {
  const extra = handlers.extra?.(search) ?? [];
  // A stable sort keeps the view's own results first within a rank.
  const results = [...extra, ...worldSearchResults(world, search)].sort(
    (a, b) => a.rank - b.rank,
  );
  if (!results.length) return null;
  const isCore = (connectionId: string) =>
    world.hosts.find((host) => host.connectionId === connectionId)?.connection
      .runtime === "herdr-core";
  // A page World emptied as it changed shows its last page instead.
  const lastPage =
    Math.floor((results.length - 1) / WORLD_COMMAND_FINDS) *
    WORLD_COMMAND_FINDS;
  const start = Math.min(
    Math.max(0, Math.floor(from / WORLD_COMMAND_FINDS) * WORLD_COMMAND_FINDS),
    lastPage,
  );
  const actions = results
    .slice(start, start + WORLD_COMMAND_FINDS)
    .map((result) =>
      findAction(result, world.nodeById.get(result.nodeId), handlers, isCore),
    );
  return {
    heading: "In World",
    actions,
    page: { from: start, size: WORLD_COMMAND_FINDS, total: results.length },
  };
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
