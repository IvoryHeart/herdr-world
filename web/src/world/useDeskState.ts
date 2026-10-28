import { useEffect, useMemo } from "react";
import { deskKey, type DeskIdentity } from "../../../shared/deskState";
import { bridge } from "../api";
import { deskClient, receiptIdentity, type DeskClients } from "./handoffs";
import { useWorldDeskState, WorldDeskStore } from "./deskStateStore";
import type { WorldLeafObject } from "./worldObject";

export function deskIdentity(leaf: WorldLeafObject): DeskIdentity {
  return {
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    terminal_id: leaf.terminalId,
    agent_session_fingerprint: leaf.agentSessionFingerprint ?? null,
  };
}

export function useDeskState(
  agents: WorldLeafObject[],
  clients: DeskClients,
  provided?: WorldDeskStore,
) {
  const store = useMemo(
    () => provided ?? new WorldDeskStore(bridge),
    [provided],
  );
  const state = useWorldDeskState(store);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const { handled, stops, opens } = useMemo(() => {
    const records = new Map(
      (state.verified ? state.records : []).map((record) => [
        deskKey(record),
        record,
      ]),
    );
    const handled = new Set<string>();
    const stops = new Map<string, number>();
    const opens = new Map<string, number>();
    for (const leaf of agents) {
      const record = records.get(deskKey(deskIdentity(leaf)));
      if (!record) continue;
      const key = receiptIdentity(leaf);
      if (record.reviewed_stop !== null)
        handled.add(JSON.stringify([key, record.reviewed_stop]));
      if (record.stopped_at !== null) stops.set(key, record.stopped_at);
      if (record.opened_at !== null) opens.set(key, record.opened_at);
    }
    return { handled, stops, opens };
  }, [agents, state]);
  const mark = async (handoffId: string, reviewed: boolean) => {
    const [identity, stop] = JSON.parse(handoffId) as [string, string];
    const leaf = agents.find((agent) => receiptIdentity(agent) === identity);
    if (!leaf || !deskClient(clients, leaf)) return false;
    return store.mutate("world.desk.review", deskIdentity(leaf), {
      stop_id: stop,
      reviewed,
    });
  };
  const record = async (leaf: WorldLeafObject) => {
    if (!deskClient(clients, leaf)) return false;
    return store.mutate("world.desk.open", deskIdentity(leaf));
  };
  return {
    handled,
    stops,
    opens,
    mark,
    record,
    verified: state.verified,
    error: state.error,
  };
}
