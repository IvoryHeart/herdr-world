import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Server } from "lucide-react";
import { WorkspaceTree } from "../components/WorkspaceTree";
import { useLayoutPreferences } from "../layoutPreferences";
import { OperationalContext } from "../store";
import type { InspectorView } from "../workspaceResource";
import type { WorldObject, WorldObjectNode } from "./worldObject";
import { projectWorldTree } from "./treeProjection";

export function WorldNavigator({
  world,
  onSelect,
}: {
  world: WorldObject;
  onSelect(node: WorldObjectNode, view?: InspectorView): void | Promise<void>;
}) {
  const projection = projectWorldTree(world);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
  const { mobile, preferences } = useLayoutPreferences();
  const agentsFirst =
    (mobile
      ? preferences.mobileSidebarOrder
      : preferences.desktopSidebarOrder) === "agents-first";
  return (
    <nav
      aria-label="Hosts and workspaces"
      className="world-navigator"
      tabIndex={0}
    >
      {selectionError ? <p role="alert">{selectionError}</p> : null}
      {projection.hosts.map((host) => {
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
          >
            <button
              type="button"
              className="world-navigator-host tree-row"
              aria-expanded={!collapsed.has(host.source.id)}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(host.source.id)) next.delete(host.source.id);
                  else next.add(host.source.id);
                  return next;
                })
              }
            >
              {collapsed.has(host.source.id) ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              <Server size={14} />
              <span className="ws-label">{host.source.label}</span>
              <span className="muted">
                {host.source.stale ? "stale" : host.source.connection.state}
              </span>
            </button>
            {!host.source.connection.snapshot ? (
              <p>Observation unavailable · counts unknown</p>
            ) : null}
            {!collapsed.has(host.source.id) &&
            host.source.connection.snapshot ? (
              <OperationalContext.Provider
                value={{
                  connectionId: host.source.connectionId,
                  runtimeGeneration: host.source.generation,
                }}
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
      })}
      {!world.hosts.length ? <p>No hosts in this filter.</p> : null}
    </nav>
  );
}
