import type { OfficeAgent, OfficeRosterEntry } from "../herdrOfficeProjection";
import type { WorldAsk } from "../worldAsks";
import type { TownCall } from "./TownRail";

/** Desk admission follows the shared call list and qualified asking identities. */
export function townAttentionDesks(
  calls: readonly TownCall[],
  asks: readonly WorldAsk[],
  roster: readonly OfficeRosterEntry[],
  agentForPane?: (
    connectionId: string,
    paneId: string,
  ) => OfficeAgent | undefined,
): ReadonlySet<string> {
  const desks = new Set<string>();
  for (const { agent } of calls) if (agent.deskKey) desks.add(agent.deskKey);
  const valid = asks.filter(
    ({ actor }) => actor.verified && actor.connection_id && actor.pane_id,
  );
  if (!valid.length) return desks;
  if (agentForPane) {
    for (const { actor } of valid) {
      const agent = agentForPane(actor.connection_id!, actor.pane_id!);
      if (
        agent?.deskKey &&
        (!actor.terminal_id ||
          actor.terminal_id === agent.currentTerminalRef.nativeId)
      )
        desks.add(agent.deskKey);
    }
    return desks;
  }
  const asking = new Map<string, Set<string>>();
  for (const { actor } of valid) {
    const key = JSON.stringify([actor.connection_id, actor.pane_id]);
    if (!asking.has(key)) asking.set(key, new Set());
    asking.get(key)!.add(actor.terminal_id ?? "");
  }
  for (const { agent } of roster) {
    if (!agent.deskKey) continue;
    const terminals = asking.get(
      JSON.stringify([
        agent.currentPaneRef.connectionId,
        agent.currentPaneRef.nativeId,
      ]),
    );
    if (terminals?.has("") || terminals?.has(agent.currentTerminalRef.nativeId))
      desks.add(agent.deskKey);
  }
  return desks;
}
