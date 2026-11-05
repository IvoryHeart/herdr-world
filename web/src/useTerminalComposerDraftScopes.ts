import { useEffect, useRef } from "react";
import type { ConnectionSummary } from "./api";
import type { State } from "./store";
import {
  activateTerminalComposerDraftScope,
  moveTerminalComposerDrafts,
  terminalComposerDraftKey,
  terminalComposerScopeGeneration,
} from "./terminalComposer";

type Topology = {
  connectionId: string;
  generation: number;
  destination: string;
  terminals: ReadonlyMap<string, string>;
};

/** Where a connection's runtime lives; a changed destination is another runtime. */
function destinationOf(connection: ConnectionSummary | undefined): string {
  return JSON.stringify([
    connection?.source,
    connection?.type,
    connection?.control_socket_path,
    connection?.ssh_destination,
    connection?.remote_control_socket_path,
    connection?.remote_session,
  ]);
}

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
    | "panes"
    | "lastRefresh"
  >,
) {
  const generation = terminalComposerScopeGeneration(snapshot);
  const previous = useRef<Topology | null>(null);
  useEffect(() => {
    if (!snapshot.catalogueReady || snapshot.status !== "connected") return;
    const connection = snapshot.connections.find(
      (owner) => owner.id === snapshot.activeConnectionId,
    );
    const current: Topology | null =
      snapshot.lastRefresh > 0
        ? {
            connectionId: snapshot.activeConnectionId,
            generation,
            destination: destinationOf(connection),
            terminals: new Map(
              snapshot.panes.map((pane) => [pane.pane_id, pane.terminal_id]),
            ),
          }
        : null;
    // Roamgate #485, within this document only: a reconnect to the same
    // runtime destination keeps unsent text on the same pane and terminal.
    // Drafts never reach browser storage (terminal input can hold secrets).
    const prior = previous.current;
    if (
      prior &&
      current &&
      prior.connectionId === current.connectionId &&
      prior.generation !== current.generation &&
      prior.destination === current.destination
    )
      moveTerminalComposerDrafts(
        [...prior.terminals].flatMap(([paneId, terminalId]) =>
          current.terminals.get(paneId) === terminalId
            ? [
                {
                  from: terminalComposerDraftKey(
                    prior.connectionId,
                    prior.generation,
                    paneId,
                  ),
                  to: terminalComposerDraftKey(
                    current.connectionId,
                    current.generation,
                    paneId,
                  ),
                },
              ]
            : [],
        ),
      );
    // Until the new generation's topology arrives, its predecessor's drafts
    // stay reachable so they can still move.
    const pending =
      !current &&
      prior?.connectionId === snapshot.activeConnectionId &&
      prior.generation !== generation
        ? [
            {
              connectionId: prior.connectionId,
              connectionGeneration: prior.generation,
            },
          ]
        : [];
    if (current) previous.current = current;
    activateTerminalComposerDraftScope(
      snapshot.activeConnectionId,
      generation,
      [
        ...snapshot.connections.map((owner) => ({
          connectionId: owner.id,
          connectionGeneration: owner.generation,
        })),
        ...pending,
      ],
    );
  }, [
    snapshot.activeConnectionId,
    generation,
    snapshot.connections,
    snapshot.catalogueReady,
    snapshot.status,
    snapshot.panes,
    snapshot.lastRefresh,
  ]);
}
