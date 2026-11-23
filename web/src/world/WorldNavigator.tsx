import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Server } from "lucide-react";
import { WorkspaceTree } from "../components/WorkspaceTree";
import { useLayoutPreferences } from "../layoutPreferences";
import { OperationalContext } from "../store";
import type { InspectorView } from "../workspaceResource";
import type { WorldObject, WorldObjectNode } from "./worldObject";
import { projectWorldTree } from "./treeProjection";
import { ColorSwatchButton } from "../components/ColorSwatch";
import {
  WorkspaceColorContext,
  type WorkspaceColorControl,
} from "../components/workspaceColor";
import { hostColorKey, workspaceColorKey } from "./terminalColor";
import { usePlaceColorChoices } from "./useTerminalColors";
import type { WorldTreeHost } from "./treeProjection";
import { useHostGroupOf } from "./useHostGroups";
import type { ConnectionLifecycleState } from "../api";
import { machineStatus } from "../worldHosts";
import { navigatorHostGroups } from "./navigatorGroups";

export function WorldNavigator({
  world,
  onSelect,
}: {
  world: WorldObject;
  onSelect(node: WorldObjectNode, view?: InspectorView): void | Promise<void>;
}) {
  // Every shell render reaches here; project only when the World changes.
  const projection = useMemo(() => projectWorldTree(world), [world]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Hosts as World's "Group runtimes" setting groups them (worldHosts.ts):
  // a machine's runtimes under one heading, each runtime row naming its
  // runtime; a lone runtime keeps its own row.
  const groupOf = useHostGroupOf();
  const groups = useMemo(
    () => navigatorHostGroups(projection.hosts, groupOf),
    [projection, groupOf],
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionSequence = useRef(0);
  const selectNode = async (node: WorldObjectNode, view?: InspectorView) => {
    const sequence = ++selectionSequence.current;
    setSelectionError(null);
    try {
      await onSelect(node, view);
    } catch (error) {
      if (sequence === selectionSequence.current)
        setSelectionError(
          error instanceof Error ? error.message : String(error),
        );
    }
  };
  // Workspace and host colours, kept with terminal colours (see placeColor).
  const placeChoices = usePlaceColorChoices();
  const workspaceColorsFor = (connectionId: string): WorkspaceColorControl => ({
    palette: placeChoices(hostColorKey(connectionId)).palette,
    colorOf: (workspaceId) =>
      placeChoices(workspaceColorKey(connectionId, workspaceId)).current,
    onColor: (workspaceId, id) =>
      placeChoices(workspaceColorKey(connectionId, workspaceId)).onColor(id),
  });
  const { mobile, preferences } = useLayoutPreferences();
  const agentsFirst =
    (mobile
      ? preferences.mobileSidebarOrder
      : preferences.desktopSidebarOrder) === "agents-first";
  // One host's row and tree; inside a machine group the row names its runtime.
  const renderHost = (host: WorldTreeHost, runtimeTag: string | null) => {
    const spaces = host.spaces.map(({ source }) => source);
    const leaves = host.spaces.flatMap(({ children }) => children);
    const selectWorkspace = (id: string, view?: InspectorView) => {
      const node = spaces.find((space) => space.nativeId === id);
      if (node) void selectNode(node, view);
    };
    const selectPane = (id: string, view?: InspectorView) => {
      const node = leaves.find((leaf) => leaf.nativeId === id);
      if (node) void selectNode(node, view);
    };
    return (
      <section
        key={host.source.id}
        data-world-navigator-host={host.source.connectionId}
        className={runtimeTag ? "world-navigator-runtime" : undefined}
      >
        <div className="world-navigator-host-row">
          <button
            type="button"
            className="world-navigator-host tree-row"
            aria-expanded={!collapsed.has(host.source.id)}
            onClick={() => toggle(host.source.id)}
          >
            {collapsed.has(host.source.id) ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
            <Server size={14} />
            <span className="ws-label">{runtimeTag ?? host.source.label}</span>
            <span className="muted">
              {host.source.stale ? "stale" : host.source.connection.state}
            </span>
          </button>
          <ColorSwatchButton
            className="world-navigator-host-color"
            label={`Colour of ${runtimeTag ? `${host.source.label} (${runtimeTag})` : host.source.label}`}
            {...placeChoices(hostColorKey(host.source.connectionId))}
          />
        </div>
        {!host.source.connection.snapshot ? (
          <p>Observation unavailable · counts unknown</p>
        ) : null}
        {!collapsed.has(host.source.id) && host.source.connection.snapshot ? (
          <OperationalContext.Provider
            value={{
              connectionId: host.source.connectionId,
              runtimeGeneration: host.source.generation,
            }}
          >
            <WorkspaceColorContext.Provider
              value={workspaceColorsFor(host.source.connectionId)}
            >
              <div
                className="world-navigator-tree"
                ref={(element) => {
                  if (element) element.inert = !host.source.actionable;
                }}
              >
                <WorkspaceTree
                  includeTerminals
                  agentsFirst={agentsFirst}
                  focusOnSelect={false}
                  observedTopology={{
                    workspaces: host.spaces.map(
                      ({ source }) => source.workspace,
                    ),
                    tabs: host.spaces.flatMap(({ source }) => source.tabs),
                    panes: host.spaces.flatMap(({ children }) =>
                      children.map((leaf) => leaf.pane),
                    ),
                  }}
                  onSelect={(workspace) =>
                    selectWorkspace(workspace.workspace_id)
                  }
                  onSelectAgent={(pane) => selectPane(pane.pane_id)}
                  onBrowseFiles={(workspace) =>
                    selectWorkspace(workspace.workspace_id, "files")
                  }
                  onReviewChanges={(workspace) =>
                    selectWorkspace(workspace.workspace_id, "changes")
                  }
                  onBrowseFilesForAgent={(pane) =>
                    selectPane(pane.pane_id, "files")
                  }
                  onReviewChangesForAgent={(pane) =>
                    selectPane(pane.pane_id, "changes")
                  }
                  onViewAgentHistory={(pane) =>
                    selectPane(pane.pane_id, "history")
                  }
                />
              </div>
            </WorkspaceColorContext.Provider>
          </OperationalContext.Provider>
        ) : null}
        {host.omittedSpaceCount ? (
          <p>{host.omittedSpaceCount} observed spaces omitted</p>
        ) : null}
        {host.spaces.some((space) => space.omittedChildCount > 0) ? (
          <p>
            {host.spaces.reduce(
              (count, space) => count + space.omittedChildCount,
              0,
            )}{" "}
            observed panes omitted
          </p>
        ) : null}
      </section>
    );
  };
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <nav
      aria-label="Hosts and workspaces"
      className="world-navigator"
      tabIndex={0}
    >
      {selectionError ? <p role="alert">{selectionError}</p> : null}
      {groups.map((group) => {
        if (group.members.length === 1)
          return renderHost(group.members[0]!, null);
        const key = `group:${group.key}`;
        const open = !collapsed.has(key);
        return (
          <section
            key={key}
            className="world-navigator-machine"
            data-world-navigator-machine={group.key}
          >
            <button
              type="button"
              className="world-navigator-host tree-row"
              aria-expanded={open}
              onClick={() => toggle(key)}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Server size={14} />
              <span className="ws-label">{group.label}</span>
              <span className="muted">
                {machineStatus(
                  group.members.map(({ source }) =>
                    source.stale ? "stale" : source.connection.state,
                  ) as ConnectionLifecycleState[],
                )}
              </span>
            </button>
            {open
              ? group.members.map((host) =>
                  renderHost(host, group.tags.get(host.source.id) ?? null),
                )
              : null}
          </section>
        );
      })}
      {!world.hosts.length ? <p>No hosts in this filter.</p> : null}
    </nav>
  );
}
