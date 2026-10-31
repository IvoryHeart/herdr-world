import { useState } from "react";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import { agentName, where } from "./deskAgentLabels";
import { deskRevealUnavailable, type DeskRevealResult } from "./deskReveal";

type Elsewhere = {
  connectionId: string;
  label: string;
  stale: boolean;
  needs: number;
  done: number;
  working: number;
};

/** Read-only summaries of managed hosts other than the selected one. */
export function otherHostSummaries(
  world: WorldObject,
  filtered?: WorldObject,
): Elsewhere[] {
  const included = filtered
    ? new Set(filtered.hosts.map((host) => host.connectionId))
    : null;
  const hosts = new Map<string, Elsewhere>();
  for (const leaf of world.leaves) {
    if (
      leaf.kind !== "agent" ||
      (included ? included.has(leaf.connectionId) : leaf.selectedHost)
    )
      continue;
    const host = hosts.get(leaf.connectionId) ?? {
      connectionId: leaf.connectionId,
      label: leaf.hostLabel,
      stale: false,
      needs: 0,
      done: 0,
      working: 0,
    };
    host.stale ||= leaf.stale;
    if (leaf.status === "blocked") host.needs += 1;
    else if (leaf.status === "done") host.done += 1;
    else if (leaf.status === "working") host.working += 1;
    hosts.set(leaf.connectionId, host);
  }
  return [...hosts.values()];
}

export function DeskOtherHosts({
  world,
  filtered,
  label,
  onReveal,
}: {
  world: WorldObject;
  filtered: WorldObject;
  label: string | undefined;
  onReveal?: (leaf: WorldLeafObject) => Promise<DeskRevealResult>;
}) {
  const [expanded, setExpanded] = useState<{
    connectionId: string;
    label: string;
    agents: WorldLeafObject[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const others = otherHostSummaries(world, filtered);
  const reveal = async (leaf: WorldLeafObject) => {
    setBusy(true);
    setError(null);
    try {
      if ((await onReveal?.(leaf)) === "opened") setExpanded(null);
    } catch (cause) {
      setError({
        id: leaf.id,
        message:
          cause instanceof Error
            ? cause.message
            : `Could not open the agent on ${leaf.hostLabel}.`,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="desk-hosts">
      <span className="desk-host is-selected">{label}</span>
      {others.map((host) => (
        <button
          key={host.connectionId}
          type="button"
          className={`desk-host${host.needs ? " has-needs" : ""}`}
          disabled={busy}
          aria-expanded={expanded?.connectionId === host.connectionId}
          onClick={() => {
            setError(null);
            setExpanded(
              expanded?.connectionId === host.connectionId
                ? null
                : {
                    connectionId: host.connectionId,
                    label: host.label,
                    agents: world.leaves.filter(
                      (leaf) =>
                        leaf.kind === "agent" &&
                        leaf.connectionId === host.connectionId,
                    ),
                  },
            );
          }}
        >
          {host.label}
          {host.stale ? " · cached" : ""}
          {host.needs ? ` · ${host.needs} need you` : ""}
          {host.done ? ` · ${host.done} done` : ""}
          {host.working ? ` · ${host.working} working` : ""}
          {!host.needs && !host.done && !host.working ? " · quiet" : ""}
        </button>
      ))}
      {expanded && (
        <section
          className="desk-host-agents"
          aria-label={`Agents outside Hosts filter on ${expanded.label}`}
        >
          <div className="desk-host-heading">
            <strong>Outside Hosts filter · {expanded.label}</strong>
            <button
              type="button"
              disabled={busy}
              onClick={() => setExpanded(null)}
            >
              Close summary
            </button>
          </div>
          <p>
            Reveal &amp; open adds this host to Hosts and opens the selected
            agent. Open Inspectors keep their own hosts.
          </p>
          <ul>
            {expanded.agents.map((leaf) => {
              const reason = deskRevealUnavailable(
                leaf,
                world.nodeById.get(leaf.id),
              );
              return (
                <li key={leaf.id}>
                  <div>
                    <strong>{agentName(leaf)}</strong>
                    <small>
                      {where(leaf)} · {leaf.status}
                    </small>
                    {reason && <span>{reason}</span>}
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy || !!reason || error?.id === leaf.id || !onReveal
                    }
                    onClick={() => void reveal(leaf)}
                  >
                    Reveal &amp; open {agentName(leaf)} on {leaf.hostLabel}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && (
            <p role="alert" className="desk-error">
              {error.message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
