import { useContext, useMemo } from "react";
import { bridge, type ConnectionClient } from "./api";
import { OperationalContext, useStoreSelector } from "./store";

/** Captures the active browser routing lease for component-owned work. */
export function useConnectionClient(): ConnectionClient {
  const context = useContext(OperationalContext);
  const activeConnectionId = useStoreSelector((s) => s.activeConnectionId);
  const connectionGeneration = useStoreSelector((s) => s.connectionGeneration);
  const transportStatus = useStoreSelector((s) => s.status);
  const attachEpoch = useStoreSelector((s) => s.terminalAttachEpoch);
  const connections = useStoreSelector((s) => s.connections);
  const runtimeGeneration =
    connections.find((connection) => connection.id === activeConnectionId)
      ?.generation ?? null;
  return useMemo(() => {
    // A same-ID runtime replacement must capture a fresh Bridge generation.
    void connectionGeneration;
    void transportStatus;
    void attachEpoch;
    return bridge.connection(
      context?.connectionId ?? activeConnectionId,
      context?.runtimeGeneration ?? runtimeGeneration,
    );
  }, [
    context?.connectionId,
    context?.runtimeGeneration,
    activeConnectionId,
    connectionGeneration,
    runtimeGeneration,
    transportStatus,
    attachEpoch,
  ]);
}

export function connectionClientScopeKey(
  client: Pick<ConnectionClient, "connectionId" | "generation"> &
    Partial<Pick<ConnectionClient, "serverRuntimeGeneration">>,
  ...parts: unknown[]
): string {
  return JSON.stringify([
    client.connectionId,
    client.serverRuntimeGeneration ?? client.generation,
    ...parts,
  ]);
}
