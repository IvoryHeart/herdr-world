import { normalizeSearchText } from "./searchText";
import { shortId } from "./utils";
import type { Pane, PaneLayout, Tab, Workspace } from "./types";
import type {
  ServerAgentPane,
  ServerSessionSource,
} from "./useAllServerAgentSessions";

export type PaneJumpEntry = {
  paneId: string;
  paneLabel: string;
  title: string;
  tabLabel: string;
  cwd: string;
  agent?: string;
  agentStatus?: string;
  current: boolean;
  /** Set when results span several servers. */
  serverLabel?: string;
  /** Set for panes that live on a server other than the active one. */
  source?: ServerSessionSource & { workspaceId: string };
};

/** Pane IDs are only unique per server, so remote entries add the server. */
export function paneJumpEntryKey(entry: PaneJumpEntry): string {
  return entry.source
    ? JSON.stringify([entry.source.connectionId, entry.paneId])
    : entry.paneId;
}

type ActivePaneSnapshot = {
  selectedPaneId?: string | null;
  layout?: Pick<PaneLayout, "panes" | "focused_pane_id"> | null;
};

type PaneJumpSnapshot = {
  layout?: Pick<PaneLayout, "panes"> | null;
  panes: Pane[];
  recentPaneIds: string[];
  tabs: Tab[];
  workspaces: Workspace[];
};

/** Resolves selection only when it still belongs to the active layout. */
export function activePaneIdForSnapshot(
  snapshot: ActivePaneSnapshot,
): string | undefined {
  return snapshot.selectedPaneId &&
    snapshot.layout?.panes.some(
      (pane) => pane.pane_id === snapshot.selectedPaneId,
    )
    ? snapshot.selectedPaneId
    : snapshot.layout?.focused_pane_id;
}

/** A pane can be closed inline only while a sibling keeps its tab alive. */
export function paneCanClose(
  panes: readonly Pick<Pane, "pane_id" | "tab_id">[],
  paneId: string,
): boolean {
  const target = panes.find((pane) => pane.pane_id === paneId);
  return (
    !!target &&
    panes.some(
      (pane) => pane.pane_id !== paneId && pane.tab_id === target.tab_id,
    )
  );
}

/** Projects live pane state into a deduplicated, most-recent-first switcher. */
export function paneJumpEntries(
  snapshot: PaneJumpSnapshot,
  activePaneId?: string | null,
): PaneJumpEntry[] {
  return orderedPaneJumpEntries(snapshot, activePaneId, false);
}

/**
 * Searches every live pane instead of the recent ones alone, so a pane that was
 * never visited stays reachable by workspace, tab, directory, or agent name.
 * Matches keep the recent-first order rather than a relevance ranking, which
 * leaves the list stable while the query grows.
 */
export function paneSearchEntries(
  snapshot: PaneJumpSnapshot,
  query: string,
  activePaneId?: string | null,
  serverLabel?: string,
): PaneJumpEntry[] {
  const entries = orderedPaneJumpEntries(snapshot, activePaneId, true);
  return filterPaneSearchEntries(
    serverLabel ? entries.map((entry) => ({ ...entry, serverLabel })) : entries,
    query,
  );
}

/**
 * Agent panes from the other ready servers, for the same search. The caller
 * passes them already ordered; panes of the active server are skipped because
 * the live snapshot covers them.
 */
export function serverPaneSearchEntries(
  panes: readonly ServerAgentPane[],
  query: string,
  activeConnectionId: string | null | undefined,
): PaneJumpEntry[] {
  return filterPaneSearchEntries(
    panes
      .filter((pane) => pane.connectionId !== activeConnectionId)
      .map((pane) => ({
        paneId: pane.pane_id,
        paneLabel: `Pane ${shortId(pane.pane_id)}`,
        title: pane.workspaceLabel,
        tabLabel: pane.tabLabel || pane.tab_id,
        cwd: pane.foreground_cwd ?? pane.cwd ?? "",
        agent: pane.agent,
        agentStatus: pane.agent ? pane.agent_status : undefined,
        current: false,
        serverLabel: pane.serverLabel,
        source: {
          connectionId: pane.connectionId,
          runtimeGeneration: pane.runtimeGeneration,
          serverLabel: pane.serverLabel,
          workspaceId: pane.workspace_id,
        },
      })),
    query,
  );
}

function filterPaneSearchEntries(
  entries: PaneJumpEntry[],
  query: string,
): PaneJumpEntry[] {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = normalizeSearchText(paneSearchValue(entry));
    return tokens.every((token) => haystack.includes(token));
  });
}

function orderedPaneJumpEntries(
  snapshot: PaneJumpSnapshot,
  activePaneId: string | null | undefined,
  includeAllPanes: boolean,
): PaneJumpEntry[] {
  const paneById = new Map(snapshot.panes.map((pane) => [pane.pane_id, pane]));
  const workspaceById = new Map(
    snapshot.workspaces.map((workspace) => [workspace.workspace_id, workspace]),
  );
  const tabById = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab]));
  const fallbackPaneIds =
    snapshot.layout?.panes.map((pane) => pane.pane_id) ?? [];
  const seen = new Set<string>();
  const orderedPaneIds = [
    ...snapshot.recentPaneIds,
    ...fallbackPaneIds,
    ...(includeAllPanes ? snapshot.panes.map((pane) => pane.pane_id) : []),
  ];

  return orderedPaneIds
    .filter((paneId) => {
      if (seen.has(paneId)) return false;
      seen.add(paneId);
      return paneById.has(paneId);
    })
    .map((paneId) =>
      paneJumpEntry(
        paneById.get(paneId)!,
        workspaceById,
        tabById,
        paneId === activePaneId,
      ),
    );
}

function paneSearchValue(entry: PaneJumpEntry): string {
  return [
    entry.title,
    entry.serverLabel,
    entry.tabLabel,
    entry.cwd,
    entry.paneLabel,
    entry.agent,
    entry.agentStatus,
    entry.paneId,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Returns a real focus target, excluding an invalid or already-current item. */
export function paneJumpTargetId(
  entries: PaneJumpEntry[],
  index: number,
): string | null {
  const entry = entries[index];
  return entry && !entry.current ? entry.paneId : null;
}

function paneJumpEntry(
  pane: Pane,
  workspaceById: Map<string, Workspace>,
  tabById: Map<string, Tab>,
  current: boolean,
): PaneJumpEntry {
  const workspace = workspaceById.get(pane.workspace_id);
  const tab = tabById.get(pane.tab_id);
  const cwd = pane.foreground_cwd ?? pane.cwd ?? "";
  const workspaceLabel = workspace?.label ?? pane.workspace_id;
  const tabLabel = tab
    ? tab.label && tab.label !== String(tab.number)
      ? tab.label
      : `Tab ${tab.number}`
    : pane.tab_id;

  return {
    paneId: pane.pane_id,
    paneLabel: `Pane ${shortId(pane.pane_id)}`,
    title: workspaceLabel,
    tabLabel,
    cwd,
    agent: pane.agent,
    agentStatus: pane.agent ? pane.agent_status : undefined,
    current,
  };
}
