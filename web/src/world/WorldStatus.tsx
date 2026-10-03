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
  const unknown = world.hosts.filter(
    (host) => !host.connection.snapshot,
  ).length;
  const summary = `${selectedHostLabel} · ${ready} ready · ${world.coverage.spaces} observed spaces · ${world.coverage.agents} observed agents${stale ? ` · ${stale} stale` : ""}${unknown ? ` · ${unknown} hosts unobserved; counts unknown` : ""}${runtime.error ? " · World error" : ""}`;
  return (
    <div
      className="world-topbar-status"
      aria-label={`World status: ${summary}`}
      aria-live="polite"
      title={summary}
    >
      <span className="world-live-dot" data-status={runtime.status} />
      <span className="world-selected-host">
        {world.coverage.agents} observed agents · {world.coverage.spaces} spaces
        {unknown ? ` · ${unknown} unknown hosts` : ""}
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
      <p className="world-eyebrow">Welcome to Herdr World</p>
      <h2 id="world-connection-title">Add a connection profile</h2>
      <p>
        Connect a local or SSH Herdr runtime to observe it in Office, Tree and
        Graph.
      </p>
      <ConnectionSwitcher />
      {status !== "connected" ? <small>World service: {status}</small> : null}
    </section>
  );
}
