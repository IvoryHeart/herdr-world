import { useEffect } from "react";
import type { State } from "./store";
import {
  activateTerminalComposerDraftScope,
  terminalComposerScopeGeneration,
} from "./terminalComposer";

/** Only a fresh catalogue may retire the memory scopes of other Inspectors. */
export function useTerminalComposerDraftScopes(
  snapshot: Pick<
    State,
    | "activeConnectionId"
    | "connectionGeneration"
    | "serverRuntimeGeneration"
    | "connections"
    | "catalogueReady"
    | "status"
  >,
) {
  const generation = terminalComposerScopeGeneration(snapshot);
  useEffect(() => {
    if (!snapshot.catalogueReady || snapshot.status !== "connected") return;
    activateTerminalComposerDraftScope(
      snapshot.activeConnectionId,
      generation,
      snapshot.connections.map((owner) => ({
        connectionId: owner.id,
        connectionGeneration: owner.generation,
      })),
    );
  }, [
    snapshot.activeConnectionId,
    generation,
    snapshot.connections,
    snapshot.catalogueReady,
    snapshot.status,
  ]);
}
