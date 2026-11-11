import { askClosed, type WorldAsk } from "./worldAsks";
import type { WorldLeafObject, WorldObject } from "./worldObject";

/**
 * An ask is attention for its original occupant, never a replacement: the
 * verified caller's terminal, or the one an unverified caller's pane held
 * when it asked (the service records that only when one local Herdr has the
 * pane). Surfaces mark the unverified ones.
 */
export function askMatchesLeaf(ask: WorldAsk, leaf: WorldLeafObject) {
  const actor = ask.actor;
  // A live herdr-core agent is not actionable (World only watches it), but
  // its ask is placed by the program that asked: the service's occupant
  // fingerprint of that terminal, which a replaced program never shares.
  const core = leaf.coreControl === true && !leaf.actionable;
  return (
    !askClosed(ask) &&
    !leaf.stale &&
    (leaf.actionable || core) &&
    actor.connection_id === leaf.connectionId &&
    actor.pane_id === leaf.pane.pane_id &&
    Boolean(actor.terminal_id) &&
    actor.terminal_id === leaf.terminalId &&
    actor.connection_generation === leaf.generation &&
    (core
      ? typeof actor.agent_session_fingerprint === "string" &&
        actor.agent_session_fingerprint === leaf.pane.core_occupant_fingerprint
      : actor.agent_session_fingerprint === undefined ||
        actor.agent_session_fingerprint === leaf.agentSessionFingerprint) &&
    (actor.agent_session_id === undefined ||
      actor.agent_session_id === leaf.pane.agent_session?.value)
  );
}

const NO_ASKS: ReadonlyMap<string, WorldAsk> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_ASKS_BY_ID: ReadonlyMap<string, string> = new Map();

export function askingKeysForWorld(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
) {
  return asks.length ? new Set(asksForWorld(asks, world).keys()) : NO_KEYS;
}

/** Each open ask's own current leaf, by ask ID; unplaced asks are left out. */
export function askLeaves(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
): ReadonlyMap<string, string> {
  if (!asks.length) return NO_ASKS_BY_ID;
  const panes = new Map(
    world.leaves.map((leaf) => [
      JSON.stringify([leaf.connectionId, leaf.pane.pane_id]),
      leaf,
    ]),
  );
  const result = new Map<string, string>();
  for (const ask of asks) {
    const leaf = panes.get(
      JSON.stringify([ask.actor.connection_id, ask.actor.pane_id]),
    );
    if (leaf && askMatchesLeaf(ask, leaf)) result.set(ask.id, leaf.id);
  }
  return result;
}

/** Each asking leaf's first open ask: the one its marks stand for. */
export function asksForWorld(
  asks: readonly WorldAsk[],
  world: Pick<WorldObject, "leaves">,
) {
  if (!asks.length) return NO_ASKS;
  const leaves = askLeaves(asks, world);
  const result = new Map<string, WorldAsk>();
  for (const ask of asks) {
    const leaf = leaves.get(ask.id);
    if (leaf && !result.has(leaf)) result.set(leaf, ask);
  }
  return result;
}
