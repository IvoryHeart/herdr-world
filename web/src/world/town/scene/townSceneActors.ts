/**
 * Which hosts' agents to reconcile after a change. An agent's goal and path
 * read its own status, seat, pin and summoned/asking marks, the
 * other agents of its host (the reception queue and lounge are per host) and
 * its building (seats, queue, lounge and navigation). A host whose key below
 * is unchanged would be left exactly as it is by a full reconciliation, so it
 * is skipped (townActors.ts `sync` with `hosts`). Every sync still takes the
 * new model, so stepping reads each agent's latest staleness.
 */

import type { TownLayout } from "../townLayout";
import type { TownModel } from "../townModel";

/** Each host's actor inputs, by host key. */
export type TownActorKeys = ReadonlyMap<string, string>;

export function townActorKeys(
  model: Pick<TownModel, "agents" | "agentSeats" | "deskPins">,
  layout: TownLayout,
  summoned: ReadonlySet<string>,
  asking: ReadonlySet<string>,
): TownActorKeys {
  const agents = new Map<string, string[]>();
  for (const agent of model.agents.values()) {
    const seat = model.agentSeats.get(agent.key);
    const list = agents.get(agent.hostKey) ?? [];
    list.push(
      [
        agent.key,
        agent.semanticStatus,
        seat ? `${seat.deskKey}#${seat.seat}` : "-",
        seat && model.deskPins.has(seat.deskKey) ? "pin" : "",
        summoned.has(agent.key) ? "summoned" : "",
        asking.has(agent.key) ? "asking" : "",
      ].join("|"),
    );
    agents.set(agent.hostKey, list);
  }
  const keys = new Map<string, string>();
  const buildings = new Map(layout.buildings.map((b) => [b.hostKey, b]));
  for (const hostKey of new Set([...buildings.keys(), ...agents.keys()]))
    keys.set(
      hostKey,
      `${JSON.stringify(buildings.get(hostKey) ?? null)}\n${(agents.get(hostKey) ?? []).join("\n")}`,
    );
  return keys;
}

/** The hosts whose actor inputs changed, appeared or went away. */
export function townActorDirty(
  previous: TownActorKeys,
  next: TownActorKeys,
): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const [hostKey, key] of next)
    if (previous.get(hostKey) !== key) hosts.add(hostKey);
  for (const hostKey of previous.keys())
    if (!next.has(hostKey)) hosts.add(hostKey);
  return hosts;
}
