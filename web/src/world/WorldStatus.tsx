import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import type { WorldRuntimeState } from "./runtimeStore";
import type { WorldObject } from "./worldObject";

function hostStateLabel(state: WorldObject["hosts"][number]["hostState"]) {
  switch (state) {
    case "active":
      return "Active";
    case "ready-inactive":
      return "Ready · inactive";
    case "reconnecting":
      return "Reconnecting";
    case "offline-stale":
      return "Offline · stale";
  }
}

export function WorldSummaryPanel({
  runtime,
  world,
}: {
  runtime: WorldRuntimeState;
  world: WorldObject;
}) {
  const ready = world.hosts.filter(
    (host) =>
      host.hostState === "active" || host.hostState === "ready-inactive",
  ).length;
  const stale = world.hosts.filter((host) => host.stale).length;
  const selectedHost = world.hosts.find((host) => host.selectedHost);
  const status = world.coverage.status;
  return (
    <details className="world-summary-panel" open>
      <summary>
        <span className="world-summary-title">World summary</span>
        <span className="world-summary-live">
          <span className="world-live-dot" data-status={runtime.status} />
          {runtime.status}
        </span>
      </summary>
      <div className="world-summary-body" aria-live="polite">
        <div className="world-summary-host">
          <span>Selected host</span>
          <strong>
            {selectedHost
              ? `${selectedHost.label} · ${hostStateLabel(selectedHost.hostState)}`
              : "No host selected"}
          </strong>
        </div>
        <dl className="world-summary-grid">
          <div>
            <dt>Ready hosts</dt>
            <dd>{ready}</dd>
          </div>
          <div>
            <dt>Spaces</dt>
            <dd>{world.coverage.spaces}</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>{world.coverage.agents}</dd>
          </div>
          <div>
            <dt>Working</dt>
            <dd>{status.working}</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{status.blocked}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{status.done}</dd>
          </div>
        </dl>
        {stale || runtime.error ? (
          <p className="world-summary-warning">
            {stale ? `${stale} stale host${stale === 1 ? "" : "s"}` : null}
            {stale && runtime.error ? " · " : null}
            {runtime.error ? "World error" : null}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function WorldConnectionRequired({
  status,
}: {
  status: "connecting" | "connected" | "disconnected";
}) {
  return (
    <section
      className="world-connection-required"
      aria-labelledby="world-connection-title"
    >
      <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
      <p className="world-eyebrow">Connection required</p>
      <h2 id="world-connection-title">Choose a Herdr host first</h2>
      <p>
        Office, Tree and Graph keep your selected host stable. Choose or add a
        connection before opening a visual view.
      </p>
      <ConnectionSwitcher />
      {status !== "connected" ? <small>World service: {status}</small> : null}
    </section>
  );
}
