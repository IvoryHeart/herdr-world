import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import type { WorldRuntimeState } from "./runtimeStore";
import type { WorldObject } from "./worldObject";

export function WorldStatusHeader({
  runtime,
  world,
  selectedHostLabel,
}: {
  runtime: WorldRuntimeState;
  world: WorldObject;
  selectedHostLabel: string;
}) {
  const ready = world.hosts.filter(
    (host) =>
      host.hostState === "active" || host.hostState === "ready-inactive",
  ).length;
  const stale = world.hosts.filter((host) => host.stale).length;
  return (
    <header className="world-status-header">
      <div>
        <p className="world-eyebrow">Visual control plane</p>
        <h1>Your agent world</h1>
      </div>
      <div className="world-status-summary" aria-live="polite">
        <span className="world-live-dot" data-status={runtime.status} />
        <span>{ready} ready</span>
        <span className="world-selected-host">{selectedHostLabel}</span>
        <span>{world.spaces.length} spaces</span>
        <span>
          {world.leaves.filter((leaf) => leaf.kind === "agent").length} agents
        </span>
        {stale ? (
          <span className="world-stale-count">{stale} stale</span>
        ) : null}
        {runtime.error ? (
          <span className="world-runtime-error">{runtime.error}</span>
        ) : null}
      </div>
    </header>
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
