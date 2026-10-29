import { useEffect, useRef } from "react";
import { bridge, type ConnectionClient } from "../api";
import type { HostsFilter } from "./hostsFilter";
import { connectionClientScopeGeneration } from "../useConnectionClient";
import {
  taskSummarySessionFingerprint,
  type WorldLeafObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";

/** A summary captures one occupant, even if its pane is reused before activation. */
export function deskRevealUnavailable(
  captured: WorldLeafObject,
  current: WorldObjectNode | undefined,
): string | null {
  if (captured.stale || current?.stale)
    return `Cached observation on ${captured.hostLabel}; wait for a fresh connection.`;
  if (!captured.actionable || !current?.actionable)
    return `Agent unavailable on ${captured.hostLabel}.`;
  if (
    current.kind !== "agent" ||
    current.connectionId !== captured.connectionId ||
    current.generation !== captured.generation ||
    current.terminalId !== captured.terminalId ||
    current.workspaceId !== captured.workspaceId ||
    current.tabId !== captured.tabId ||
    current.pane.pane_id !== captured.pane.pane_id ||
    !captured.agentSessionFingerprint ||
    current.agentSessionFingerprint !== captured.agentSessionFingerprint
  )
    return `Agent session changed or unavailable on ${captured.hostLabel}; reopen the summary to choose a current agent.`;
  return null;
}

type RevealContext = {
  isCurrent?(): boolean;
  world(): WorldObject;
  filter(): HostsFilter;
  client(leaf: WorldLeafObject): ConnectionClient;
  reveal(ids: HostsFilter): void;
  open(
    leaf: WorldLeafObject,
    world: WorldObject,
    sessionId: string,
  ): Promise<boolean>;
};

export async function revealDeskAgent(
  captured: WorldLeafObject,
  context: RevealContext,
): Promise<void> {
  const requireCurrent = () => {
    if (context.isCurrent?.() === false)
      throw new Error("This agent opening was superseded.");
    const world = context.world();
    const reason = deskRevealUnavailable(
      captured,
      world.nodeById.get(captured.id),
    );
    if (reason) throw new Error(reason);
    return world;
  };
  requireCurrent();
  const client = context.client(captured);
  const clientCurrent = () =>
    client.connectionId === captured.connectionId &&
    connectionClientScopeGeneration(client) === captured.generation &&
    client.isCurrent();
  const unavailable = () =>
    new Error(`Agent unavailable or session changed on ${captured.hostLabel}.`);
  if (!clientCurrent()) throw unavailable();
  let result;
  try {
    result = await client.call("pane.get", { pane_id: captured.pane.pane_id });
  } catch {
    throw unavailable();
  }
  const world = requireCurrent();
  const pane = result?.pane;
  const session = pane?.agent_session;
  if (
    !clientCurrent() ||
    !pane ||
    pane.pane_id !== captured.pane.pane_id ||
    pane.workspace_id !== captured.workspaceId ||
    pane.tab_id !== captured.tabId ||
    pane.terminal_id !== captured.terminalId ||
    !session ||
    ![session.source, session.agent, session.kind, session.value].every(
      (value) => typeof value === "string" && value.length > 0,
    ) ||
    taskSummarySessionFingerprint(session) !== captured.agentSessionFingerprint
  )
    throw unavailable();
  // Read the filter after admission so an intervening user edit is retained.
  const ids = context.filter();
  context.reveal(
    ids === null ? null : [...new Set([...ids, captured.connectionId])],
  );
  // The existing qualified focus queue rechecks this live session value before focusing.
  if (
    !(await context.open(
      world.nodeById.get(captured.id) as WorldLeafObject,
      world,
      session.value,
    ))
  )
    throw unavailable();
}

/** Async admission uses the latest observation and filter, without changing resource owners. */
export function useDeskReveal(input: {
  active: boolean;
  intentRequestRef: { current: number };
  world: WorldObject;
  hostsFilter: { ids: HostsFilter; setIds(ids: HostsFilter): void };
  open: RevealContext["open"];
}) {
  const latest = useRef(input);
  latest.current = input;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (captured: WorldLeafObject) => {
    const intent = input.intentRequestRef.current;
    return revealDeskAgent(captured, {
      isCurrent: () =>
        mounted.current &&
        latest.current.active &&
        latest.current.intentRequestRef.current === intent,
      world: () => latest.current.world,
      filter: () => latest.current.hostsFilter.ids,
      client: (leaf) => bridge.connection(leaf.connectionId, leaf.generation),
      reveal: (ids) => latest.current.hostsFilter.setIds(ids),
      open: (...args) => latest.current.open(...args),
    });
  };
}
