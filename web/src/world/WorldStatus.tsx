import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import type { WorldRuntimeState } from "./runtimeStore";
import type { WorldObject } from "./worldObject";

export function WorldTopbarStatus({
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
    <div
      className="world-topbar-status"
      aria-label="World status"
      aria-live="polite"
    >
      <span className="world-live-dot" data-status={runtime.status} />
      <span className="world-selected-host">{selectedHostLabel}</span>
      <span title={`${ready} ready hosts`}>{ready} ready</span>
      <span title={`${world.spaces.length} spaces`}>
        {world.spaces.length} spaces
      </span>
      <span title="Visible agents">
        {world.leaves.filter((leaf) => leaf.kind === "agent").length} agents
      </span>
      {stale ? <span className="world-stale-count">{stale} stale</span> : null}
      {runtime.error ? (
        <span className="world-runtime-error" title={runtime.error}>
          World error
        </span>
      ) : null}
    </div>
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
