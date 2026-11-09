import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { bridge, type ConnectionClient } from "./api";
import { resourcePresentationScope } from "./resourcePresentationClient";
import { OperationalContext, store, useStoreSelector } from "./store";

export const ResourceConnectionClientContext =
  createContext<ConnectionClient | null>(null);

/** Catalog restoration can make the same client usable after socket hello. */
export function useConnectionReady(client: ConnectionClient): boolean {
  return useSyncExternalStore(store.subscribe, client.isCurrent);
}

/** Captures the active browser routing lease for component-owned work. */
export function useConnectionClient(): ConnectionClient {
  const context = useContext(OperationalContext);
  const resourceClient = useContext(ResourceConnectionClientContext);
  const activeConnectionId = useStoreSelector((s) => s.activeConnectionId);
  const connectionGeneration = useStoreSelector((s) => s.connectionGeneration);
  const transportStatus = useStoreSelector((s) => s.status);
  const attachEpoch = useStoreSelector((s) => s.terminalAttachEpoch);
  // A reconnect captures the client at "connected", before the catalog
  // restores the runtime lease; capture again once the catalog is ready.
  const catalogueReady = useStoreSelector((s) => s.catalogueReady);
  const connections = useStoreSelector((s) => s.connections);
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const runtimeGeneration = activeConnection?.generation ?? null;
  // The bridge grants a fresh lease when a connection becomes ready again,
  // possibly with the same generation number.
  const runtimeState = activeConnection?.state;
  return useMemo(() => {
    // A same-ID runtime replacement must capture a fresh Bridge generation.
    void connectionGeneration;
    void transportStatus;
    void attachEpoch;
    void catalogueReady;
    void runtimeState;
    return (
      resourceClient ??
      bridge.connection(
        context?.connectionId ?? activeConnectionId,
        context?.runtimeGeneration ?? runtimeGeneration,
      )
    );
  }, [
    resourceClient,
    context?.connectionId,
    context?.runtimeGeneration,
    activeConnectionId,
    connectionGeneration,
    runtimeGeneration,
    transportStatus,
    attachEpoch,
    catalogueReady,
    runtimeState,
  ]);
}

export type ConnectionClientScope = Pick<
  ConnectionClient,
  "connectionId" | "generation"
> &
  Partial<Pick<ConnectionClient, "serverRuntimeGeneration" | "agentWorktree">>;

export function connectionClientScopeGeneration(client: ConnectionClientScope) {
  return client.serverRuntimeGeneration ?? client.generation;
}

export function connectionClientScopeKey(
  client: ConnectionClientScope,
  ...parts: unknown[]
): string {
  const scope = resourcePresentationScope(client);
  return JSON.stringify([
    scope.connectionId,
    connectionClientScopeGeneration(scope),
    ...parts,
    ...(scope.agentWorktree !== undefined
      ? [{ agentWorktree: scope.agentWorktree }]
      : []),
  ]);
}
