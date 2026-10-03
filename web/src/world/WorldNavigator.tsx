import type { WorldObject, WorldObjectNode } from "./worldObject";
import { projectWorldTree } from "./treeProjection";

export function WorldNavigator({
  world,
  onSelect,
}: {
  world: WorldObject;
  onSelect(node: WorldObjectNode): void;
}) {
  const projection = projectWorldTree(world);
  return (
    <nav
      aria-label="Hosts and workspaces"
      className="world-navigator"
      tabIndex={0}
    >
      {projection.hosts.map((host) => (
        <section
          key={host.source.id}
          data-world-navigator-host={host.source.connectionId}
        >
          <h3>
            {host.source.label} ·{" "}
            {host.source.stale ? "stale" : host.source.connection.state}
          </h3>
          {!host.source.connection.snapshot ? (
            <p>Observation unavailable · counts unknown</p>
          ) : null}
          {host.spaces.map((space) => (
            <div key={space.source.id}>
              <button
                type="button"
                disabled={!space.source.actionable}
                onClick={() => onSelect(space.source)}
              >
                {space.source.label}
              </button>
              {space.children.map((leaf) => (
                <button
                  type="button"
                  key={leaf.id}
                  className={
                    leaf.kind === "agent" ? "agent-row" : "terminal-row"
                  }
                  aria-label={`${leaf.pane.agent ?? leaf.label} pane · ${leaf.hostLabel}`}
                  data-world-navigator-node={leaf.id}
                  disabled={!leaf.actionable}
                  onClick={() => onSelect(leaf)}
                >
                  {leaf.label} · {leaf.stateLabels[leaf.status] ?? leaf.status}
                </button>
              ))}
              {space.omittedChildCount ? (
                <p>{space.omittedChildCount} observed leaves omitted</p>
              ) : null}
            </div>
          ))}
          {host.omittedSpaceCount ? (
            <p>{host.omittedSpaceCount} observed spaces omitted</p>
          ) : null}
        </section>
      ))}
      {!world.hosts.length ? <p>No hosts in this filter.</p> : null}
    </nav>
  );
}
