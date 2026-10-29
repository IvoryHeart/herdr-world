import type { WorldAsk } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";

/** An ask is attention for its original verified occupant, never a replacement. */
export function askMatchesLeaf(ask: WorldAsk, leaf: WorldLeafObject) {
  const actor = ask.actor;
  return (
    !ask.answer &&
    !ask.withdrawn &&
    actor.verified &&
    !leaf.stale &&
    leaf.actionable &&
    actor.connection_id === leaf.connectionId &&
    actor.pane_id === leaf.pane.pane_id &&
    Boolean(actor.terminal_id) &&
    actor.terminal_id === leaf.terminalId &&
    actor.connection_generation === leaf.generation &&
    (actor.agent_session_fingerprint === undefined ||
      actor.agent_session_fingerprint === leaf.agentSessionFingerprint) &&
    (actor.agent_session_id === undefined ||
      actor.agent_session_id === leaf.pane.agent_session?.value)
  );
}

const NO_ASKS: ReadonlyMap<string, WorldAsk> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

export function askingKeysForWorld(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
) {
  return asks.length ? new Set(asksForWorld(asks, world).keys()) : NO_KEYS;
}

export function asksForWorld(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
) {
  if (!asks.length) return NO_ASKS;
  const panes = new Map(
    world.leaves.map((leaf) => [
      JSON.stringify([leaf.connectionId, leaf.pane.pane_id]),
      leaf,
    ]),
  );
  const result = new Map<string, WorldAsk>();
  for (const ask of asks) {
    const leaf = panes.get(
      JSON.stringify([ask.actor.connection_id, ask.actor.pane_id]),
    );
    if (leaf && askMatchesLeaf(ask, leaf) && !result.has(leaf.id))
      result.set(leaf.id, ask);
  }
  return result;
}
