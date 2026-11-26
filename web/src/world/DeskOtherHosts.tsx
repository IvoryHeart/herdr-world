import { useState } from "react";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import { agentName, where } from "./deskAgentLabels";
import { deskRevealUnavailable, type DeskRevealResult } from "./deskReveal";
import {
  otherHostSummaries,
  type DeskHostGroupOf,
} from "./deskOtherHostsModel";

export function DeskOtherHosts({
  world,
  filtered,
  label,
  onReveal,
  pinned = () => false,
  groupOf,
}: {
  world: WorldObject;
  filtered: WorldObject;
  label: string | undefined;
  /** The "Group runtimes" groups; without it each connection is its own. */
  groupOf?: DeskHostGroupOf;
  /** Whether an agent is pinned: a host's agents list pinned ones first. */
  pinned?: (leaf: WorldLeafObject) => boolean;
  onReveal?: (leaf: WorldLeafObject) => Promise<DeskRevealResult>;
}) {
  const [expanded, setExpanded] = useState<{
    key: string;
    label: string;
    agents: WorldLeafObject[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const others = otherHostSummaries(world, filtered, groupOf);
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
          key={host.key}
          type="button"
          className={`desk-host${host.needs ? " has-needs" : ""}`}
          disabled={busy}
          aria-expanded={expanded?.key === host.key}
          onClick={() => {
            setError(null);
            setExpanded(
              expanded?.key === host.key
                ? null
                : {
                    key: host.key,
                    label: host.label,
                    // Pinned first; a stable sort keeps the rest in order.
                    agents: world.leaves
                      .filter(
                        (leaf) =>
                          leaf.kind === "agent" &&
                          host.connectionIds.includes(leaf.connectionId),
                      )
                      .sort((a, b) => Number(pinned(b)) - Number(pinned(a))),
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
