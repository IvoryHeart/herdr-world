import { WorkspacePullRequestBadge as PullRequestBadge } from "./WorktreePullRequestBadge";
import { subscribeLocalStorage } from "../browserStorage";
import { worldLocalStorage } from "../browserStorage";
import { shallowEqual, useOperationalStore, useStoreSelector } from "../store";
import type { GitStatusSummary, Pane, Tab, Workspace } from "../types";
import type { PullRequestSummary } from "../../../shared/pullRequest";
import type { ConnectionSummary } from "../api";
import { connectionLifecycleLabel } from "../connectionProfiles";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type ContextMenuState } from "./ContextMenu";
import { WorkspaceColorContext } from "./workspaceColor";
import { buildWorkspaceHierarchy } from "../worktree";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import {
  WORKSPACE_PINS_STORAGE_KEY,
  isWorkspacePinned,
  parseWorkspacePins,
} from "../workspacePins";
import {
  COLLAPSED_WORKTREE_GROUPS_STORAGE_KEY,
  isWorktreeGroupCollapsed,
  parseCollapsedWorktreeGroups,
  serializeCollapsedWorktreeGroups,
  setWorktreeGroupCollapsed,
} from "../workspaceTreeCollapse";
import {
  showWorkspaceBranchBadge,
  workspaceDisplayName,
  workspacePullRequest,
} from "../workspaceTreeBadges";
import { connectionStorageKey } from "../connectionStorage";
import {
  visibleWorkspaceTabChips,
  type WorkspaceTabChip,
  workspaceTabChips,
} from "../workspaceTabChips";
import type { AgentStateKind } from "./agentSession";
import { type WorkspaceAgentLayout } from "../workspaceAgentLayout";
import {
  type ServerSessionSource,
  type ConnectionAgentSessions,
  openServerSession,
} from "../useAllServerAgentSessions";
import {
  type AgentMenuState,
  AgentRow,
  nestedAgentPaneIds,
} from "./WorkspaceAgentRows";
import { groupAgentPanesByWorkspace } from "./agentSession";
import {
  focusTreeItem,
  keyboardContextMenuPoint,
  treeKeyboardAction,
  workspaceTreeItemIsTabStop,
} from "./treeKeyboard";
import { TREE_DEPTH_INDENT } from "./treeIndent";
import "./WorkspaceTree.css";

/**
 * Workspace rows for the Spaces list: one workspace with its tab chips, Git
 * and pull request badges, agents and worktree children, and the All servers
 * rows that show another connection's workspaces from World's aggregate.
 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_PX = 10;
export const EMPTY_AGENT_PANES_BY_WORKSPACE = new Map<string, Pane[]>();

function gitChangedCount(status: GitStatusSummary) {
  return status.staged + status.unstaged + status.untracked + status.conflicted;
}

function gitStatusTitle(status?: GitStatusSummary) {
  if (!status) return "";
  if (status.error) return `git status unavailable: ${status.error}`;
  const parts = [
    status.branch ? `branch: ${status.branch}` : null,
    status.upstream ? `upstream: ${status.upstream}` : null,
    status.ahead ? `ahead: ${status.ahead}` : null,
    status.behind ? `behind: ${status.behind}` : null,
    status.staged ? `staged: ${status.staged}` : null,
    status.unstaged ? `unstaged: ${status.unstaged}` : null,
    status.untracked ? `untracked: ${status.untracked}` : null,
    status.conflicted ? `conflicted: ${status.conflicted}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function GitStatusBadges({
  status,
  showBranch = true,
}: {
  status?: GitStatusSummary;
  showBranch?: boolean;
}) {
  if (!status) return null;
  if (status.error) {
    return (
      <span
        className="git-badge git-badge-error"
        title={gitStatusTitle(status)}
      >
        git?
      </span>
    );
  }

  const changed = gitChangedCount(status);
  const branch = status.branch || "git";
  const hasVisibleBadge =
    showBranch || changed > 0 || status.ahead > 0 || status.behind > 0;
  if (!hasVisibleBadge) return null;
  return (
    <span className="git-status" title={gitStatusTitle(status)}>
      {showBranch ? (
        <span className="git-badge git-branch start-ellipsis">
          <span dir="ltr">{branch}</span>
        </span>
      ) : null}
      {changed > 0 ? (
        <span className="git-badge git-dirty">Δ{changed}</span>
      ) : null}
      {status.ahead > 0 ? (
        <span className="git-badge git-ahead">↑{status.ahead}</span>
      ) : null}
      {status.behind > 0 ? (
        <span className="git-badge git-behind">↓{status.behind}</span>
      ) : null}
    </span>
  );
}

type WorkspaceDragProps = {
  isDragging: boolean;
  dropPosition: "before" | "after" | null;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
};

type WorkspaceTreeSource = ServerSessionSource & { tabs: Tab[] };

export function ServerWorkspaceRows({
  connection,
  snapshot,
  layout,
  activePaneId,
  reviews,
  pinnedKeys,
  collapsedKeys,
  onCollapsedChange,
  onSelect,
  onSelectAgent,
  onContextMenu,
  onAgentContextMenu,
}: {
  connection: ConnectionSummary;
  snapshot?: ConnectionAgentSessions;
  layout: WorkspaceAgentLayout;
  activePaneId: string | null;
  reviews: Record<string, PullRequestSummary>;
  pinnedKeys?: ReadonlySet<string>;
  collapsedKeys?: ReadonlySet<string>;
  onCollapsedChange?: (workspace: Workspace, collapsed: boolean) => void;
  onSelect?: (workspace: Workspace) => void;
  onSelectAgent?: (pane: Pane) => void;
  onContextMenu: (menu: ContextMenuState) => void;
  onAgentContextMenu: (menu: AgentMenuState) => void;
}) {
  const pinsKey = connectionStorageKey(
    connection.id,
    WORKSPACE_PINS_STORAGE_KEY,
  );
  const groupsKey = connectionStorageKey(
    connection.id,
    COLLAPSED_WORKTREE_GROUPS_STORAGE_KEY,
  );
  const readPreferences = useCallback(
    () => ({
      pins: parseWorkspacePins(worldLocalStorage.getItem(pinsKey)),
      groups: parseCollapsedWorktreeGroups(
        worldLocalStorage.getItem(groupsKey),
      ),
    }),
    [pinsKey, groupsKey],
  );
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(
    () =>
      subscribeLocalStorage((key) => {
        if (key === null || key === pinsKey || key === groupsKey)
          setPreferences(readPreferences());
      }),
    [pinsKey, groupsKey, readPreferences],
  );
  const source: WorkspaceTreeSource = {
    connectionId: connection.id,
    runtimeGeneration: connection.generation,
    serverLabel: connection.label,
    tabs: snapshot?.tabs ?? [],
  };
  const workspaces = snapshot?.workspaces ?? [];
  const pins = pinnedKeys ?? new Set(preferences.pins);
  const { topLevel, childrenByParent } = buildWorkspaceHierarchy(
    workspaces,
    pins,
  );
  const agents =
    layout === "nested"
      ? groupAgentPanesByWorkspace(snapshot?.panes ?? [])
      : EMPTY_AGENT_PANES_BY_WORKSPACE;
  const tabChips = workspaceTabChips(source.tabs, snapshot?.panes ?? []);
  const updateCollapsed = (workspace: Workspace, collapsed: boolean) => {
    if (onCollapsedChange) onCollapsedChange(workspace, collapsed);
    else {
      const groups = setWorktreeGroupCollapsed(
        preferences.groups,
        workspace,
        collapsed,
      );
      setPreferences((previous) => ({ ...previous, groups }));
      worldLocalStorage.setItem(
        groupsKey,
        serializeCollapsedWorktreeGroups(groups),
      );
    }
  };
  const message =
    connection.state !== "ready"
      ? connectionLifecycleLabel(connection.state)
      : snapshot?.error
        ? snapshot.error
        : !snapshot
          ? "Loading..."
          : topLevel.length === 0
            ? "No workspaces."
            : null;
  if (message) {
    return (
      <p
        className="muted workspace-server-message"
        data-connection-id={connection.id}
        role="status"
      >
        {connection.label}: {message}
      </p>
    );
  }
  return (
    <>
      {topLevel.map((workspace) => (
        <WorkspaceRow
          key={workspace.workspace_id}
          w={workspace}
          source={source}
          focusOnSelect
          reviews={reviews}
          depth={0}
          childrenByParent={childrenByParent}
          agentsByWorkspace={agents}
          tabChipsByWorkspace={tabChips}
          alwaysShowTabCount={layout === "compact"}
          activePaneId={activePaneId}
          pinnedWorkspaceKeys={pins}
          collapsedWorktreeGroupKeys={
            collapsedKeys ?? new Set(preferences.groups)
          }
          onCollapsedChange={updateCollapsed}
          onSelect={onSelect}
          onSelectAgent={onSelectAgent}
          onContextMenu={(workspace, x, y) =>
            onContextMenu({ workspace, x, y, source })
          }
          onAgentContextMenu={(pane, x, y) =>
            onAgentContextMenu({ pane, x, y, source })
          }
        />
      ))}
    </>
  );
}

function workspaceSubtreeContainsActiveItem(
  workspace: Workspace,
  childrenByParent: ReadonlyMap<string, Workspace[]>,
  agentsByWorkspace: ReadonlyMap<string, Pane[]>,
  activePaneId: string | null,
): boolean {
  if (workspace.focused) return true;
  const agents = agentsByWorkspace.get(workspace.workspace_id) ?? [];
  if (
    agents.some(
      (pane) =>
        pane.pane_id === activePaneId || (!activePaneId && pane.focused),
    )
  ) {
    return true;
  }
  return (childrenByParent.get(workspace.workspace_id) ?? []).some((child) =>
    workspaceSubtreeContainsActiveItem(
      child,
      childrenByParent,
      agentsByWorkspace,
      activePaneId,
    ),
  );
}

const TAB_CHIP_STATUS_LABELS: Record<AgentStateKind, string> = {
  blocked: "Blocked",
  done: "Done",
  working: "Working",
  idle: "Idle",
  unknown: "No agent",
};

function WorkspaceTabChips({
  chips,
  workspaceFocused,
  onOpen,
}: {
  chips: readonly WorkspaceTabChip[];
  workspaceFocused: boolean;
  onOpen: (chip: WorkspaceTabChip) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { visible, hidden } = visibleWorkspaceTabChips(chips, availableWidth);
  const stop = (event: { stopPropagation: () => void }) =>
    event.stopPropagation();
  return (
    <span
      ref={ref}
      className="workspace-tab-chips"
      role="group"
      aria-label="Tabs"
    >
      {visible.map((chip) => {
        const status = TAB_CHIP_STATUS_LABELS[chip.status];
        const name = chip.label.trim() || `Tab ${chip.number}`;
        return (
          <button
            key={chip.tabId}
            type="button"
            className={`workspace-tab-chip is-${chip.status} ${
              workspaceFocused && chip.focused ? "is-active" : ""
            }`}
            title={`${chip.number}: ${name} · ${status}`}
            aria-label={`Tab ${chip.number}, ${name}, ${status}`}
            onPointerDown={stop}
            onPointerMove={stop}
            onPointerUp={stop}
            onPointerCancel={stop}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpen(chip);
            }}
          >
            {chip.number}
          </button>
        );
      })}
      {hidden > 0 ? (
        <span
          className="workspace-tab-chip-more"
          title={`${hidden} more tabs`}
          aria-label={`${hidden} more tabs`}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}

export function WorkspaceRow({
  w,
  source,
  reviews,
  depth,
  childrenByParent,
  agentsByWorkspace,
  tabChipsByWorkspace,
  alwaysShowTabCount = false,
  activePaneId,
  pinnedWorkspaceKeys,
  collapsedWorktreeGroupKeys,
  onCollapsedChange,
  focusOnSelect,
  onSelect,
  onSelectAgent,
  onAgentContextMenu,
  onContextMenu,
  workspaceDrag,
}: {
  w: Workspace;
  source?: WorkspaceTreeSource;
  reviews: Record<string, PullRequestSummary>;
  depth: number;
  childrenByParent: Map<string, Workspace[]>;
  agentsByWorkspace: ReadonlyMap<string, Pane[]>;
  tabChipsByWorkspace: ReadonlyMap<string, WorkspaceTabChip[]>;
  alwaysShowTabCount?: boolean;
  activePaneId: string | null;
  pinnedWorkspaceKeys: ReadonlySet<string>;
  collapsedWorktreeGroupKeys: ReadonlySet<string>;
  onCollapsedChange: (workspace: Workspace, collapsed: boolean) => void;
  focusOnSelect: boolean;
  onSelect?: (workspace: Workspace) => void;
  onSelectAgent?: (pane: Pane) => void;
  onAgentContextMenu: (pane: Pane, x: number, y: number) => void;
  onContextMenu: (w: Workspace, x: number, y: number) => void;
  workspaceDrag?: WorkspaceDragProps;
}) {
  const workspaceColors = useContext(WorkspaceColorContext);
  const workspaceColor = workspaceColors?.colorOf(w.workspace_id);
  const store = useOperationalStore();
  const children = childrenByParent.get(w.workspace_id) ?? [];
  const review = workspacePullRequest(reviews[w.workspace_id]);
  const agents = agentsByWorkspace.get(w.workspace_id) ?? [];
  const tabChips = tabChipsByWorkspace.get(w.workspace_id) ?? [];
  const tabCount = tabChips.length;
  const tabCountVisible = alwaysShowTabCount || tabCount > 1;
  const tabChipsVisible = tabCount > 1;
  const s = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      pendingFocusWorkspaceId: state.pendingFocusWorkspaceId,
      tabs: state.tabs,
    }),
    shallowEqual,
  );
  const current = !source || source.connectionId === s.activeConnectionId;
  const workspaceFocused = current && w.focused;
  const tabs = source?.tabs ?? s.tabs;
  const paneIdsToShow = nestedAgentPaneIds(agents, tabs);
  const isChild = depth > 0;
  const hasChildren = children.length > 0;
  const hasNestedItems = hasChildren || agents.length > 0;
  const hasActiveAgent =
    current &&
    agents.some(
      (pane) =>
        pane.pane_id === activePaneId || (!activePaneId && pane.focused),
    );
  const hiddenDescendantActive =
    current &&
    children.some((child) =>
      workspaceSubtreeContainsActiveItem(
        child,
        childrenByParent,
        agentsByWorkspace,
        activePaneId,
      ),
    );
  const collapsed =
    hasNestedItems && isWorktreeGroupCollapsed(collapsedWorktreeGroupKeys, w);
  const pinned = isWorkspacePinned(pinnedWorkspaceKeys, w);
  const isPendingFocus =
    current && s.pendingFocusWorkspaceId === w.workspace_id && !w.focused;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => clearLongPressTimer, []);

  const openMenu = (x: number, y: number) => {
    onContextMenu(w, x, y);
  };
  const selectWorkspace = () => {
    if (source) {
      void openServerSession(source, w.workspace_id).then((opened) => {
        if (opened && current) onSelect?.(w);
      });
    } else {
      if (focusOnSelect) void store.focusWorkspace(w.workspace_id);
      onSelect?.(w);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    longPressTriggered.current = false;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      openMenu(e.clientX, e.clientY);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStart.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) {
      clearLongPressTimer();
      longPressStart.current = null;
    }
  };

  const onPointerEnd = () => {
    clearLongPressTimer();
    longPressStart.current = null;
  };

  return (
    <>
      <div
        className={`tree-row clickable-row ${workspaceFocused ? "is-focused" : ""} ${
          hasActiveAgent ? "has-active-agent" : ""
        } ${isChild ? "is-child" : ""} ${pinned ? "is-pinned" : ""} ${
          isPendingFocus ? "is-loading" : ""
        } ${tabCountVisible ? "has-tab-count" : ""} ${
          workspaceDrag?.isDragging ? "is-dragging" : ""
        } ${
          workspaceDrag?.dropPosition
            ? `drop-${workspaceDrag.dropPosition}`
            : ""
        }`}
        style={{
          paddingLeft: 6 + depth * TREE_DEPTH_INDENT,
        }}
        role="treeitem"
        data-connection-id={source?.connectionId}
        draggable={!!workspaceDrag}
        onDragStart={workspaceDrag?.onDragStart}
        onDragOver={workspaceDrag?.onDragOver}
        onDrop={workspaceDrag?.onDrop}
        onDragEnd={workspaceDrag?.onDragEnd}
        tabIndex={
          workspaceTreeItemIsTabStop({
            workspaceFocused,
            directAgentActive: hasActiveAgent,
            collapsed,
            hiddenDescendantActive,
          })
            ? 0
            : -1
        }
        aria-level={depth + 1}
        aria-selected={workspaceFocused}
        aria-expanded={hasNestedItems ? !collapsed : undefined}
        onClick={(e) => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          selectWorkspace();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const action = treeKeyboardAction(event.key, event.shiftKey);
          if (!action) return;
          if (
            action === "next" ||
            action === "previous" ||
            action === "first" ||
            action === "last"
          ) {
            event.preventDefault();
            focusTreeItem(event.currentTarget, action);
            return;
          }
          if (action === "expand") {
            event.preventDefault();
            if (hasNestedItems && collapsed) {
              onCollapsedChange(w, false);
            } else {
              focusTreeItem(event.currentTarget, "next");
            }
            return;
          }
          if (action === "collapse") {
            event.preventDefault();
            if (hasNestedItems && !collapsed) {
              onCollapsedChange(w, true);
            } else {
              focusTreeItem(event.currentTarget, "previous");
            }
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (action === "activate") {
            selectWorkspace();
          } else {
            const point = keyboardContextMenuPoint(event.currentTarget);
            openMenu(point.x, point.y);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        title={
          w.worktree
            ? [
                `${w.worktree.repo_name} · ${w.worktree.checkout_path}`,
                gitStatusTitle(w.worktree.git_status),
              ]
                .filter(Boolean)
                .join("\n")
            : w.workspace_id
        }
      >
        {hasNestedItems ? (
          <button
            type="button"
            className="workspace-group-toggle"
            tabIndex={-1}
            title={collapsed ? "Expand workspace" : "Collapse workspace"}
            aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
            aria-expanded={!collapsed}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onPointerCancel={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openMenu(event.clientX, event.clientY);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCollapsedChange(w, !collapsed);
            }}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : (
          <span className="twisty" aria-hidden="true" />
        )}
        {workspaceColor?.custom ? (
          <span
            className="ws-color"
            style={{
              background: workspaceColors?.palette.find(
                (entry) => entry.id === workspaceColor.id,
              )?.hex,
            }}
            title={`Colour ${workspaceColor.id}`}
            aria-hidden="true"
          />
        ) : null}
        <strong
          // A worktree's name mostly repeats its repository's: what tells it
          // apart is its end.
          className={`ws-label${isChild ? " start-ellipsis" : ""}`}
          title={workspaceDisplayName(w)}
        >
          <span dir="ltr">{workspaceDisplayName(w)}</span>
        </strong>
        {tabCountVisible && !tabChipsVisible ? (
          <span
            className="workspace-tab-count"
            title={`${tabCount} tabs`}
            aria-label={`${tabCount} tabs`}
          >
            {tabCount}
          </span>
        ) : null}
        {tabChipsVisible ? (
          <WorkspaceTabChips
            chips={tabChips}
            workspaceFocused={workspaceFocused}
            onOpen={(chip) => {
              if (current) {
                // World's navigator selects without moving Herdr's own focus.
                if (!focusOnSelect) onSelect?.(w);
                else void store.focusTab(chip.tabId).then(() => onSelect?.(w));
                return;
              }
              if (source) {
                void openServerSession(source, w.workspace_id, chip.paneId);
              }
            }}
          />
        ) : null}
        {source ? (
          <span
            className="workspace-server-badge"
            title={source.serverLabel}
            aria-label={`Server: ${source.serverLabel}`}
          >
            {source.serverLabel}
          </span>
        ) : null}
        {pinned ? (
          <Pin
            className="workspace-pin"
            size={11}
            fill="currentColor"
            aria-label="Pinned"
          />
        ) : null}
        {isPendingFocus ? (
          <span className="row-spinner" aria-label="Loading workspace" />
        ) : null}
        {w.worktree ? (
          <>
            {review ? <PullRequestBadge review={review} /> : null}
            <GitStatusBadges
              status={w.worktree.git_status}
              showBranch={!review && showWorkspaceBranchBadge(w)}
            />
          </>
        ) : null}
      </div>
      {!collapsed ? (
        <>
          {agents.map((pane) => (
            <AgentRow
              key={pane.pane_id}
              pane={pane}
              depth={depth + 1}
              showPaneId={paneIdsToShow.has(pane.pane_id)}
              selected={
                current &&
                (pane.pane_id === activePaneId ||
                  (!activePaneId && pane.focused))
              }
              tabLabel={
                source
                  ? (tabs.find(
                      (tab) =>
                        tab.tab_id === pane.tab_id &&
                        tab.workspace_id === pane.workspace_id,
                    )?.label ?? "")
                  : undefined
              }
              onActivate={
                source
                  ? () => {
                      void openServerSession(
                        source,
                        pane.workspace_id,
                        pane.pane_id,
                      ).then((opened) => {
                        if (opened && current) onSelectAgent?.(pane);
                      });
                    }
                  : undefined
              }
              focusOnSelect={focusOnSelect}
              onSelect={onSelectAgent}
              onOpenMenu={(x, y) => onAgentContextMenu(pane, x, y)}
            />
          ))}
          {children.map((child) => (
            <WorkspaceRow
              key={child.workspace_id}
              w={child}
              source={source}
              reviews={reviews}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              agentsByWorkspace={agentsByWorkspace}
              tabChipsByWorkspace={tabChipsByWorkspace}
              alwaysShowTabCount={alwaysShowTabCount}
              activePaneId={activePaneId}
              pinnedWorkspaceKeys={pinnedWorkspaceKeys}
              collapsedWorktreeGroupKeys={collapsedWorktreeGroupKeys}
              onCollapsedChange={onCollapsedChange}
              focusOnSelect={focusOnSelect}
              onSelect={onSelect}
              onSelectAgent={onSelectAgent}
              onAgentContextMenu={onAgentContextMenu}
              onContextMenu={onContextMenu}
            />
          ))}
        </>
      ) : null}
    </>
  );
}
