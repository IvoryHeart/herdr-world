import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import { HerdrSetupCard } from "../components/HerdrSetupCard";
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
      {runtime.error ? (
        <span className="world-runtime-error" title={runtime.error}>
          World error
        </span>
      ) : null}
    </div>
  );
}

/** The welcome card's words, apart from its store-bound connection switcher. */
export function WorldWelcomeText() {
  return (
    <>
      <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
      <p className="world-eyebrow">Welcome to Herdr World</p>
      <h2 id="world-connection-title">Add a connection profile</h2>
      <p>
        Connect a local or SSH Herdr runtime to see its agents in Town, Board,
        Desk and Spaces.
      </p>
    </>
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
      <WorldWelcomeText />
      <ConnectionSwitcher />
      {status !== "connected" ? <small>World service: {status}</small> : null}
    </section>
  );
}

/** Town with no hosts: profiles live under Hosts → Manage connections. */
export function TownNoHosts() {
  return (
    <div className="world-empty" role="status">
      <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
      <h2>No connected spaces yet</h2>
      <p>
        Add or reconnect a local or SSH Herdr profile with{" "}
        <strong>Hosts → Manage connections</strong>.
      </p>
    </div>
  );
}

/**
 * Offer local Herdr setup on Town only when the default connection has failed
 * and nothing is ready. A failing local socket keeps its error through
 * error → reconnecting; a normal start or an explicit disconnect has none.
 */
export function localHerdrSetupOffer(world: WorldObject) {
  const local = world.hosts.find((host) => host.connection.isDefault);
  return (
    !!local &&
    local.connection.state !== "ready" &&
    !!local.connection.error &&
    !world.hosts.some((host) => host.connection.state === "ready")
  );
}

export function TownHerdrSetupOffer({
  world,
  aggregate = world,
}: {
  world: WorldObject;
  aggregate?: WorldObject;
}) {
  // Hosts changes presentation, never whether any runtime is already ready.
  if (!localHerdrSetupOffer(aggregate)) return null;
  const local = aggregate.hosts.find((host) => host.connection.isDefault)!;
  return (
    <div className="town-herdr-setup">
      <HerdrSetupCard key={local.connection.connectionId} />
    </div>
  );
}
