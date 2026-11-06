import { subscribeLocalStorage } from "../browserStorage";
import { worldLocalStorage } from "../browserStorage";
import { shallowEqual, useOperationalStore, useStoreSelector } from "../store";
import type { Pane, Tab, Workspace } from "../types";
import { projectBrowserNavigation } from "../browserNavigation";
import { useWorkspacePullRequests } from "../useWorktreePullRequests";
import { shortId } from "../utils";
import {
  terminalComposerCloseWarning,
  terminalComposerDraftPaneIds,
} from "../terminalComposer";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { ThemedSelect } from "./ThemedSelect";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { buildWorkspaceHierarchy, worktreeCreationSource } from "../worktree";
import {
  ArrowDownWideNarrow,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  Plus,
} from "lucide-react";
import { WorktreeLifecycleDialog } from "./WorktreeLifecycleDialog";
import {
  WORKSPACE_PINS_STORAGE_KEY,
  parseWorkspacePins,
  serializeWorkspacePins,
  setWorkspacePinned,
} from "../workspacePins";
import {
  COLLAPSED_WORKTREE_GROUPS_STORAGE_KEY,
  parseCollapsedWorktreeGroups,
  serializeCollapsedWorktreeGroups,
  setWorktreeGroupCollapsed,
} from "../workspaceTreeCollapse";
import { workspaceDisplayName } from "../workspaceTreeBadges";
import { pruneClosedWorkspacePreferenceKeys } from "../workspacePreferences";
import { connectionStorageKey } from "../connectionStorage";
import {
  AGENT_ORDER_STORAGE_KEY,
  moveAgentPane,
  sortAgentPanes,
  groupOrderedAgentPanes,
  AGENT_LIST_PREFERENCES_STORAGE_KEY,
  parseAgentListPreferences,
  type AgentSort,
  type AgentGrouping,
  parseAgentOrder,
  serializeAgentOrder,
} from "../agentOrder";
import { workspaceTabChips } from "../workspaceTabChips";
import {
  AGENT_LIST_SCOPE_STORAGE_KEY,
  WORKSPACE_AGENT_LAYOUT_STORAGE_KEY,
  type WorkspaceAgentLayout,
  parseWorkspaceAgentLayout,
} from "../workspaceAgentLayout";
import {
  type ServerAgentPane,
  openServerSession,
  useAllServerAgentSessions,
} from "../useAllServerAgentSessions";
import { useConnectionClient } from "../useConnectionClient";
import { activePaneIdForSnapshot } from "../paneJump";
import { ConfirmDialog } from "./ModalDialogs";
import {
  AgentContextMenu,
  type AgentMenuState,
  AgentRow,
} from "./WorkspaceAgentRows";
import {
  exportSessionForConnection,
  groupAgentPanesByWorkspace,
  paneHasAgentHistory,
} from "./agentSession";
import "./WorkspaceTree.css";
import "./WorkspaceAutoSyncDialog.css";
import {
  EMPTY_AGENT_PANES_BY_WORKSPACE,
  ServerWorkspaceRows,
  WorkspaceRow,
} from "./WorkspaceRows";

function stringArraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function AgentLayoutControl({
  value,
  onChange,
}: {
  value: WorkspaceAgentLayout;
  onChange: (value: WorkspaceAgentLayout) => void;
}) {
  return (
    <div className="workspace-agent-layout-control">
      <span>Agents</span>
      <div role="group" aria-label="Agent list layout">
        <button
          type="button"
          className={value === "compact" ? "is-active" : ""}
          aria-pressed={value === "compact"}
          onClick={() => onChange("compact")}
        >
          Compact
        </button>
        <button
          type="button"
          className={value === "nested" ? "is-active" : ""}
          aria-pressed={value === "nested"}
          onClick={() => onChange("nested")}
        >
          Nested
        </button>
        <button
          type="button"
          className={value === "separate" ? "is-active" : ""}
          aria-pressed={value === "separate"}
          onClick={() => onChange("separate")}
        >
          Separate
        </button>
      </div>
    </div>
  );
}

export function WorkspaceTree({
  agentsFirst = false,
  focusOnSelect = true,
  includeTerminals = false,
  observedTopology,
  onSelect,
  onBrowseFiles,
  onReviewChanges,
  onSelectAgent,
  onBrowseFilesForAgent,
  onReviewChangesForAgent,
  onViewAgentHistory,
}: {
  agentsFirst?: boolean;
  focusOnSelect?: boolean;
  includeTerminals?: boolean;
  observedTopology?: { workspaces: Workspace[]; tabs: Tab[]; panes: Pane[] };
  onSelect?: (workspace: Workspace) => void;
  onBrowseFiles?: (workspace: Workspace) => void;
  onReviewChanges?: (workspace: Workspace) => void;
  onSelectAgent?: (pane: Pane) => void;
  onBrowseFilesForAgent?: (pane: Pane) => void;
  onReviewChangesForAgent?: (pane: Pane) => void;
  onViewAgentHistory?: (pane: Pane) => void;
}) {
  const session = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      connectionGeneration: state.connectionGeneration,
      serverRuntimeGeneration: state.serverRuntimeGeneration,
      connections: state.connections,
      lastRefresh: state.lastRefresh,
      layout: state.layout,
      navigationMode: state.navigationMode,
      browserNavigation: state.browserNavigation,
      panes: state.panes,
      selectedPaneId: state.selectedPaneId,
      status: state.status,
      tabs: state.tabs,
      workspaces: state.workspaces,
    }),
    shallowEqual,
  );
  // Aggregate navigation can show a host before its operational cache is warm.
  // Commands still use the immutable lease supplied by OperationalContext.
  const s = observedTopology
    ? {
        ...session,
        ...(session.navigationMode === "browser-local"
          ? projectBrowserNavigation(
              session.browserNavigation,
              observedTopology.workspaces,
              observedTopology.tabs,
              observedTopology.panes,
            )
          : observedTopology),
      }
    : session;
  const store = useOperationalStore();
  const connectionClient = useConnectionClient();
  const connectedServerCount = s.connections.filter(
    (connection) => connection.state === "ready",
  ).length;
  const reviews = useWorkspacePullRequests(connectionClient, s.workspaces);
  const agentOrderStorageKey = connectionStorageKey(
    s.activeConnectionId,
    AGENT_ORDER_STORAGE_KEY,
  );
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [agentMenu, setAgentMenu] = useState<AgentMenuState | null>(null);
  const [pendingClosePane, setPendingClosePane] = useState<Pane | null>(null);
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(
    null,
  );
  const [workspaceDropTarget, setWorkspaceDropTarget] = useState<{
    workspaceId: string;
    position: "before" | "after";
  } | null>(null);
  const [draggedAgentPaneId, setDraggedAgentPaneId] = useState<string | null>(
    null,
  );
  const [agentDropTarget, setAgentDropTarget] = useState<{
    paneId: string;
    position: "before" | "after";
  } | null>(null);
  const [agentListPreferences, setAgentListPreferences] = useState(() =>
    parseAgentListPreferences(
      worldLocalStorage.getItem(AGENT_LIST_PREFERENCES_STORAGE_KEY),
    ),
  );
  const [collapsedAgentGroups, setCollapsedAgentGroups] = useState<Set<string>>(
    new Set(),
  );
  const manualAgentOrder =
    agentListPreferences.sort === "manual" &&
    agentListPreferences.grouping === "none";
  const [agentPaneOrder, setAgentPaneOrder] = useState<string[]>(() =>
    parseAgentOrder(worldLocalStorage.getItem(agentOrderStorageKey)),
  );
  const [agentLayout, setAgentLayout] = useState<WorkspaceAgentLayout>(() =>
    parseWorkspaceAgentLayout(
      worldLocalStorage.getItem(WORKSPACE_AGENT_LAYOUT_STORAGE_KEY),
    ),
  );
  const [allServersPreferred, setAllServers] = useState(
    () => worldLocalStorage.getItem(AGENT_LIST_SCOPE_STORAGE_KEY) === "all",
  );
  // World's navigator already gives each host its own tree from the aggregate,
  // so its trees always show their own host.
  const allServers = !observedTopology && allServersPreferred;
  const allServerSessions = useAllServerAgentSessions(allServers);
  const agentSort =
    allServers && agentListPreferences.sort === "manual"
      ? "workspace"
      : agentListPreferences.sort;
  const [createOpen, setCreateOpen] = useState(false);
  const [lifecycleWorkspaceId, setLifecycleWorkspaceId] = useState<
    string | null
  >(null);
  const lastPrunedWorkspaceRefresh = useRef(0);
  useEffect(() => {
    setMenu(null);
    setAgentMenu(null);
    setPendingClosePane(null);
    setDraggedWorkspaceId(null);
    setWorkspaceDropTarget(null);
    setDraggedAgentPaneId(null);
    setAgentDropTarget(null);
    setCreateOpen(false);
    setLifecycleWorkspaceId(null);
  }, [s.activeConnectionId, s.connectionGeneration]);
  const pinsStorageKey = connectionStorageKey(
    s.activeConnectionId,
    WORKSPACE_PINS_STORAGE_KEY,
  );
  const collapsedGroupsStorageKey = connectionStorageKey(
    s.activeConnectionId,
    COLLAPSED_WORKTREE_GROUPS_STORAGE_KEY,
  );
  const [pinnedWorkspaceKeys, setPinnedWorkspaceKeys] = useState<string[]>(() =>
    parseWorkspacePins(worldLocalStorage.getItem(pinsStorageKey)),
  );
  const [collapsedWorktreeGroupKeys, setCollapsedWorktreeGroupKeys] = useState<
    string[]
  >(() =>
    parseCollapsedWorktreeGroups(
      worldLocalStorage.getItem(collapsedGroupsStorageKey),
    ),
  );
  const pinnedWorkspaceSet = new Set(pinnedWorkspaceKeys);
  const collapsedWorktreeGroupSet = new Set(collapsedWorktreeGroupKeys);
  const activePaneId = activePaneIdForSnapshot(s) ?? null;
  const agentsByWorkspace = useMemo(
    () => groupAgentPanesByWorkspace(s.panes, includeTerminals),
    [s.panes, includeTerminals],
  );
  const tabChipsByWorkspace = useMemo(
    () => workspaceTabChips(s.tabs, s.panes),
    [s.tabs, s.panes],
  );
  const defaultAgentPanes = useMemo(() => {
    const workspaceNumbers = new Map(
      s.workspaces.map((workspace) => [
        workspace.workspace_id,
        workspace.number,
      ]),
    );
    return s.panes
      .filter((pane) => includeTerminals || paneHasAgentHistory(pane))
      .sort((left, right) => {
        const workspaceOrder =
          (workspaceNumbers.get(left.workspace_id) ?? 0) -
          (workspaceNumbers.get(right.workspace_id) ?? 0);
        return workspaceOrder || left.pane_id.localeCompare(right.pane_id);
      });
  }, [s.panes, s.workspaces, includeTerminals]);
  const agentPanes = useMemo(
    () =>
      sortAgentPanes(
        defaultAgentPanes,
        agentPaneOrder,
        agentListPreferences.sort,
      ),
    [agentPaneOrder, defaultAgentPanes, agentListPreferences.sort],
  );

  const listedAgentPanes: (Pane | ServerAgentPane)[] = allServers
    ? sortAgentPanes(allServerSessions.panes, [], agentSort)
    : agentPanes;
  const agentGroups = groupOrderedAgentPanes(
    listedAgentPanes,
    agentListPreferences.grouping,
    new Map(
      allServers
        ? allServerSessions.panes.map((pane) => [
            pane.workspaceKey,
            `${pane.serverLabel} / ${pane.workspaceLabel}`,
          ])
        : s.workspaces.map((workspace) => [
            workspace.workspace_id,
            workspaceDisplayName(workspace),
          ]),
    ),
  );
  useEffect(() => {
    worldLocalStorage.setItem(
      AGENT_LIST_PREFERENCES_STORAGE_KEY,
      JSON.stringify(agentListPreferences),
    );
  }, [agentListPreferences]);

  useEffect(() => {
    setMenu(null);
    setAgentMenu(null);
    setPendingClosePane(null);
    setDraggedWorkspaceId(null);
    setWorkspaceDropTarget(null);
    setDraggedAgentPaneId(null);
    setAgentDropTarget(null);
  }, [connectionClient]);
  useEffect(() => {
    worldLocalStorage.setItem(WORKSPACE_AGENT_LAYOUT_STORAGE_KEY, agentLayout);
  }, [agentLayout]);
  useEffect(() => {
    worldLocalStorage.setItem(
      AGENT_LIST_SCOPE_STORAGE_KEY,
      allServers ? "all" : "current",
    );
  }, [allServers]);
  useEffect(() => {
    worldLocalStorage.setItem(
      agentOrderStorageKey,
      serializeAgentOrder(agentPaneOrder),
    );
  }, [agentOrderStorageKey, agentPaneOrder]);
  useEffect(() => {
    worldLocalStorage.setItem(
      pinsStorageKey,
      serializeWorkspacePins(pinnedWorkspaceKeys),
    );
  }, [pinnedWorkspaceKeys, pinsStorageKey]);
  useEffect(() => {
    worldLocalStorage.setItem(
      collapsedGroupsStorageKey,
      serializeCollapsedWorktreeGroups(collapsedWorktreeGroupKeys),
    );
  }, [collapsedGroupsStorageKey, collapsedWorktreeGroupKeys]);
  useEffect(() => {
    if (
      s.status !== "connected" ||
      s.lastRefresh === 0 ||
      s.lastRefresh <= lastPrunedWorkspaceRefresh.current
    ) {
      return;
    }
    lastPrunedWorkspaceRefresh.current = s.lastRefresh;
    setPinnedWorkspaceKeys((current) => {
      const next = pruneClosedWorkspacePreferenceKeys(
        current,
        session.workspaces,
      );
      return stringArraysEqual(current, next) ? current : next;
    });
    setCollapsedWorktreeGroupKeys((current) => {
      const next = pruneClosedWorkspacePreferenceKeys(
        current,
        session.workspaces,
      );
      return stringArraysEqual(current, next) ? current : next;
    });
  }, [s.lastRefresh, s.status, session.workspaces]);
  useEffect(() => {
    return subscribeLocalStorage((key) => {
      if (key === pinsStorageKey || key === null) {
        setPinnedWorkspaceKeys(
          parseWorkspacePins(worldLocalStorage.getItem(pinsStorageKey)),
        );
      }
      if (key === collapsedGroupsStorageKey || key === null) {
        setCollapsedWorktreeGroupKeys(
          parseCollapsedWorktreeGroups(
            worldLocalStorage.getItem(collapsedGroupsStorageKey),
          ),
        );
      }
      if (key === WORKSPACE_AGENT_LAYOUT_STORAGE_KEY || key === null) {
        setAgentLayout(
          parseWorkspaceAgentLayout(
            worldLocalStorage.getItem(WORKSPACE_AGENT_LAYOUT_STORAGE_KEY),
          ),
        );
      }
      if (key === AGENT_LIST_PREFERENCES_STORAGE_KEY || key === null) {
        setAgentListPreferences(
          parseAgentListPreferences(
            worldLocalStorage.getItem(AGENT_LIST_PREFERENCES_STORAGE_KEY),
          ),
        );
      }
      if (key === AGENT_LIST_SCOPE_STORAGE_KEY || key === null) {
        setAllServers(
          worldLocalStorage.getItem(AGENT_LIST_SCOPE_STORAGE_KEY) === "all",
        );
      }
      if (key === agentOrderStorageKey || key === null) {
        setAgentPaneOrder(
          parseAgentOrder(worldLocalStorage.getItem(agentOrderStorageKey)),
        );
      }
    });
  }, [agentOrderStorageKey, collapsedGroupsStorageKey, pinsStorageKey]);

  const updatePinnedWorkspace = (workspace: Workspace, pinned: boolean) => {
    setPinnedWorkspaceKeys((current) =>
      setWorkspacePinned(current, workspace, pinned),
    );
    if (!pinned && workspace.worktree?.is_linked_worktree) {
      const parent = worktreeCreationSource(s.workspaces, workspace);
      if (parent) {
        setCollapsedWorktreeGroupKeys((current) =>
          setWorktreeGroupCollapsed(current, parent, false),
        );
      }
    }
  };
  const updateCollapsedWorktreeGroup = (
    workspace: Workspace,
    collapsed: boolean,
  ) => {
    setCollapsedWorktreeGroupKeys((current) =>
      setWorktreeGroupCollapsed(current, workspace, collapsed),
    );
  };

  const clearWorkspaceDrag = () => {
    setDraggedWorkspaceId(null);
    setWorkspaceDropTarget(null);
  };
  const clearAgentDrag = () => {
    setDraggedAgentPaneId(null);
    setAgentDropTarget(null);
  };
  const workspaceDropPosition = (e: React.DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const onWorkspaceDragStart = (
    workspace: Workspace,
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    clearAgentDrag();
    setDraggedWorkspaceId(workspace.workspace_id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", workspace.workspace_id);
  };
  const onWorkspaceDragOver = (
    workspace: Workspace,
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    if (!draggedWorkspaceId || draggedWorkspaceId === workspace.workspace_id) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = workspaceDropPosition(e);
    setWorkspaceDropTarget((current) =>
      current?.workspaceId === workspace.workspace_id &&
      current.position === position
        ? current
        : { workspaceId: workspace.workspace_id, position },
    );
  };
  const onWorkspaceDrop = (
    workspace: Workspace,
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    const draggedId = draggedWorkspaceId;
    const position = workspaceDropPosition(e);
    clearWorkspaceDrag();
    if (!draggedId || draggedId === workspace.workspace_id) return;
    const orderedIds = [...s.workspaces]
      .sort((a, b) => a.number - b.number)
      .map((candidate) => candidate.workspace_id);
    const from = orderedIds.indexOf(draggedId);
    const to = orderedIds.indexOf(workspace.workspace_id);
    if (from < 0 || to < 0) return;
    // workspace.move inserts before the entry currently at insert_index, so
    // an insertion point past the dragged row lands one slot earlier.
    const insertIndex = position === "before" ? to : to + 1;
    if (from < insertIndex ? insertIndex - 1 === from : insertIndex === from) {
      return;
    }
    void store.moveWorkspace(draggedId, insertIndex);
  };
  const onAgentDragStart = (pane: Pane, e: React.DragEvent<HTMLDivElement>) => {
    clearWorkspaceDrag();
    setDraggedAgentPaneId(pane.pane_id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", pane.pane_id);
  };
  const onAgentDragOver = (pane: Pane, e: React.DragEvent<HTMLDivElement>) => {
    if (!draggedAgentPaneId || draggedAgentPaneId === pane.pane_id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = workspaceDropPosition(e);
    setAgentDropTarget((current) =>
      current?.paneId === pane.pane_id && current.position === position
        ? current
        : { paneId: pane.pane_id, position },
    );
  };
  const onAgentDrop = (pane: Pane, e: React.DragEvent<HTMLDivElement>) => {
    if (!draggedAgentPaneId) return;
    e.preventDefault();
    const draggedPaneId = draggedAgentPaneId;
    const position = workspaceDropPosition(e);
    clearAgentDrag();
    if (draggedPaneId === pane.pane_id) return;
    setAgentPaneOrder(
      moveAgentPane(
        agentPanes.map((candidate) => candidate.pane_id),
        draggedPaneId,
        pane.pane_id,
        position,
      ),
    );
  };

  const { topLevel, childrenByParent } = buildWorkspaceHierarchy(
    s.workspaces,
    pinnedWorkspaceSet,
  );
  const focusedRepoWorkspace = s.workspaces.find(
    (workspace) => workspace.focused && workspace.worktree,
  );

  const workspacePanel = (
    <div
      key="workspaces"
      className="panel tree workspace-tree-panel"
      tabIndex={-1}
    >
      <div className="panel-head">
        <h2>Workspaces</h2>
        <div className="panel-actions">
          {/* Only the classic sidebar chooses a scope, and only when there
              is more than one connected server to choose. */}
          {!observedTopology && connectedServerCount > 1 ? (
            <ThemedSelect
              className="workspace-scope-control"
              aria-label="Workspace server scope"
              value={allServers ? "all" : "current"}
              options={[
                { value: "current", label: "Current" },
                { value: "all", label: "All servers" },
              ]}
              onChange={(scope) => {
                clearWorkspaceDrag();
                clearAgentDrag();
                setMenu(null);
                setAgentMenu(null);
                setAllServers(scope === "all");
              }}
            />
          ) : null}
          {focusedRepoWorkspace ? (
            <button
              type="button"
              className="panel-add panel-action-icon"
              title="Worktree lifecycle"
              aria-label="Open worktree lifecycle"
              onClick={() =>
                setLifecycleWorkspaceId(focusedRepoWorkspace.workspace_id)
              }
            >
              <GitBranch size={14} />
            </button>
          ) : null}
          <button
            className="panel-add panel-action-icon"
            title="New workspace"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div
        className="workspace-tree-content"
        role="tree"
        aria-label="Workspaces and agents"
      >
        {allServers ? (
          <>
            {allServerSessions.messages.map((message) => (
              <p key={message} className="muted" role="status">
                {message}
              </p>
            ))}
            {s.connections.map((connection) => {
              const current = connection.id === s.activeConnectionId;
              let snapshot =
                connection.state === "ready"
                  ? allServerSessions.snapshots.find(
                      (entry) =>
                        entry.connection_id === connection.id &&
                        entry.connection_generation === connection.generation,
                    )
                  : undefined;
              if (
                snapshot &&
                !snapshot.error &&
                current &&
                s.lastRefresh > 0 &&
                s.serverRuntimeGeneration === connection.generation
              ) {
                snapshot = {
                  ...snapshot,
                  workspaces: s.workspaces,
                  tabs: s.tabs,
                  panes: s.panes,
                };
              }
              return (
                <ServerWorkspaceRows
                  key={JSON.stringify([connection.id, connection.generation])}
                  connection={connection}
                  snapshot={snapshot}
                  layout={agentLayout}
                  activePaneId={activePaneId}
                  reviews={current ? reviews : {}}
                  pinnedKeys={current ? pinnedWorkspaceSet : undefined}
                  collapsedKeys={
                    current ? collapsedWorktreeGroupSet : undefined
                  }
                  onCollapsedChange={
                    current ? updateCollapsedWorktreeGroup : undefined
                  }
                  onSelect={onSelect}
                  onSelectAgent={onSelectAgent}
                  onContextMenu={setMenu}
                  onAgentContextMenu={setAgentMenu}
                />
              );
            })}
          </>
        ) : s.workspaces.length === 0 ? (
          <p className="muted">
            {s.status === "connected"
              ? "No workspaces."
              : "Connect to the bridge to load workspaces."}
          </p>
        ) : null}
        {!allServers &&
          topLevel.map((w) => (
            <WorkspaceRow
              key={w.workspace_id}
              w={w}
              reviews={reviews}
              depth={0}
              childrenByParent={childrenByParent}
              agentsByWorkspace={
                agentLayout === "nested"
                  ? agentsByWorkspace
                  : EMPTY_AGENT_PANES_BY_WORKSPACE
              }
              tabChipsByWorkspace={tabChipsByWorkspace}
              alwaysShowTabCount={agentLayout === "compact"}
              activePaneId={activePaneId}
              pinnedWorkspaceKeys={pinnedWorkspaceSet}
              collapsedWorktreeGroupKeys={collapsedWorktreeGroupSet}
              onCollapsedChange={updateCollapsedWorktreeGroup}
              focusOnSelect={focusOnSelect}
              onSelect={onSelect}
              onSelectAgent={onSelectAgent}
              onAgentContextMenu={(pane, x, y) => setAgentMenu({ pane, x, y })}
              onContextMenu={(w, x, y) => setMenu({ workspace: w, x, y })}
              workspaceDrag={{
                isDragging: draggedWorkspaceId === w.workspace_id,
                dropPosition:
                  workspaceDropTarget?.workspaceId === w.workspace_id
                    ? workspaceDropTarget.position
                    : null,
                onDragStart: (e) => onWorkspaceDragStart(w, e),
                onDragOver: (e) => onWorkspaceDragOver(w, e),
                onDrop: (e) => onWorkspaceDrop(w, e),
                onDragEnd: clearWorkspaceDrag,
              }}
            />
          ))}
      </div>
      <AgentLayoutControl value={agentLayout} onChange={setAgentLayout} />
    </div>
  );
  const agentsPanel =
    agentLayout === "separate" ? (
      <div key="agents" className="panel agents-panel">
        <div className="panel-head">
          <h2>Agents</h2>
          <div className="panel-actions agent-list-controls">
            <ThemedSelect
              className="agent-list-control"
              icon={<ArrowDownWideNarrow size={15} aria-hidden="true" />}
              align="end"
              aria-label="Agent sort order"
              title={`Sort agents: ${{ attention: "Attention first", workspace: "Workspace order", manual: "Manual order" }[agentSort]}`}
              value={agentSort}
              options={[
                { value: "attention", label: "Attention first" },
                { value: "workspace", label: "Workspace order" },
                ...(!allServers
                  ? [{ value: "manual", label: "Manual order" }]
                  : []),
              ]}
              onChange={(sort) => {
                clearAgentDrag();
                setAgentListPreferences((current) => ({
                  ...current,
                  sort: sort as AgentSort,
                }));
              }}
            />
            <ThemedSelect
              className={`agent-list-control ${agentListPreferences.grouping !== "none" ? "is-active" : ""}`}
              icon={<Layers size={15} aria-hidden="true" />}
              align="end"
              aria-label="Agent grouping"
              title={`Group agents: ${{ none: "No grouping", status: "Status", workspace: "Workspace", agent: "Agent type" }[agentListPreferences.grouping]}`}
              value={agentListPreferences.grouping}
              options={[
                { value: "none", label: "No grouping" },
                { value: "status", label: "Status" },
                { value: "workspace", label: "Workspace" },
                { value: "agent", label: "Agent type" },
              ]}
              onChange={(grouping) => {
                clearAgentDrag();
                setAgentListPreferences((current) => ({
                  ...current,
                  grouping: grouping as AgentGrouping,
                }));
              }}
            />
          </div>
        </div>
        <div className="agents-list">
          {listedAgentPanes.length > 0 ? (
            agentGroups.map((group) => {
              const groupKey = `${agentListPreferences.grouping}:${group.key}`;
              const collapsed = collapsedAgentGroups.has(groupKey);
              return (
                <div key={groupKey} className="agent-list-group">
                  {agentListPreferences.grouping !== "none" ? (
                    <button
                      type="button"
                      className="agent-group-toggle"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedAgentGroups((current) => {
                          const next = new Set(current);
                          if (next.has(groupKey)) next.delete(groupKey);
                          else next.add(groupKey);
                          return next;
                        })
                      }
                    >
                      {collapsed ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                      <span>{group.label}</span>
                      <span className="muted">{group.panes.length}</span>
                    </button>
                  ) : null}
                  {(!collapsed || agentListPreferences.grouping === "none") &&
                    group.panes.map((pane) => {
                      const source = "connectionId" in pane ? pane : null;
                      const current =
                        !source || source.connectionId === s.activeConnectionId;
                      const workspace = s.workspaces.find(
                        (candidate) =>
                          candidate.workspace_id === pane.workspace_id,
                      );
                      return (
                        <AgentRow
                          key={
                            source
                              ? JSON.stringify([
                                  source.workspaceKey,
                                  pane.pane_id,
                                ])
                              : pane.pane_id
                          }
                          pane={pane}
                          selected={
                            current &&
                            (pane.pane_id === activePaneId ||
                              (!activePaneId && pane.focused))
                          }
                          showPaneId
                          variant="standalone"
                          workspaceLabel={
                            source?.workspaceLabel ??
                            (workspace
                              ? workspaceDisplayName(workspace)
                              : pane.workspace_id)
                          }
                          serverLabel={source?.serverLabel}
                          tabLabel={source?.tabLabel}
                          onActivate={
                            source
                              ? () => {
                                  void openServerSession(
                                    source,
                                    source.workspace_id,
                                    source.pane_id,
                                  ).then((opened) => {
                                    if (opened && current)
                                      onSelectAgent?.(pane);
                                  });
                                }
                              : undefined
                          }
                          focusOnSelect={focusOnSelect}
                          onSelect={onSelectAgent}
                          onOpenMenu={(x, y) =>
                            setAgentMenu({
                              pane,
                              x,
                              y,
                              source: source ?? undefined,
                            })
                          }
                          drag={
                            !allServers && manualAgentOrder
                              ? {
                                  isDragging:
                                    draggedAgentPaneId === pane.pane_id,
                                  dropPosition:
                                    agentDropTarget?.paneId === pane.pane_id
                                      ? agentDropTarget.position
                                      : null,
                                  onDragStart: (event) =>
                                    onAgentDragStart(pane, event),
                                  onDragOver: (event) =>
                                    onAgentDragOver(pane, event),
                                  onDrop: (event) => onAgentDrop(pane, event),
                                  onDragEnd: clearAgentDrag,
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                </div>
              );
            })
          ) : (
            <p className="muted">
              {allServers && allServerSessions.loading
                ? "Loading..."
                : "No agent sessions."}
            </p>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      {agentsFirst ? agentsPanel : workspacePanel}
      {agentsFirst ? workspacePanel : agentsPanel}
      <ContextMenu
        state={menu}
        workspaces={observedTopology ? s.workspaces : undefined}
        reviewStatus={menu ? reviews[menu.workspace.workspace_id] : undefined}
        pinnedWorkspaceKeys={pinnedWorkspaceSet}
        onPinnedChange={updatePinnedWorkspace}
        onBrowseFiles={onBrowseFiles}
        onReviewChanges={onReviewChanges}
        onClose={() => setMenu(null)}
      />
      <AgentContextMenu
        state={agentMenu}
        onClose={() => setAgentMenu(null)}
        onFocus={(pane) => {
          if (agentMenu?.source) {
            const current =
              agentMenu.source.connectionId === s.activeConnectionId;
            void openServerSession(
              agentMenu.source,
              pane.workspace_id,
              pane.pane_id,
            ).then((opened) => {
              if (opened && current) onSelectAgent?.(pane);
            });
          } else {
            if (focusOnSelect) void store.focusPane(pane.pane_id);
            onSelectAgent?.(pane);
          }
        }}
        onBrowseFiles={onBrowseFilesForAgent}
        onReviewChanges={onReviewChangesForAgent}
        onViewHistory={onViewAgentHistory}
        onExportSession={(pane) =>
          exportSessionForConnection(pane, connectionClient)
        }
        onClosePane={(pane) => {
          if (store.guardPaneClose(pane.pane_id)) setPendingClosePane(pane);
        }}
      />
      <ConfirmDialog
        open={!!pendingClosePane}
        title="Close Agent Pane"
        message={
          pendingClosePane
            ? `Close pane "${shortId(pendingClosePane.pane_id)}"?${terminalComposerCloseWarning(
                terminalComposerDraftPaneIds(
                  s.activeConnectionId,
                  s.connectionGeneration,
                  [pendingClosePane.pane_id],
                ).length,
              )}`
            : "Close this pane?"
        }
        confirmLabel="Close"
        danger
        onClose={() => setPendingClosePane(null)}
        onConfirm={() => {
          if (pendingClosePane) {
            store.closePane(pendingClosePane.pane_id);
          }
        }}
      />
      <CreateWorkspaceDialog
        key="create-workspace"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <WorktreeLifecycleDialog
        open={!!lifecycleWorkspaceId}
        workspaceId={lifecycleWorkspaceId}
        onClose={() => setLifecycleWorkspaceId(null)}
      />
    </>
  );
}
