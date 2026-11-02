import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import { watchConversation } from "../conversationWatch";
import {
  connectionClientScopeGeneration,
  connectionClientScopeKey,
} from "../useConnectionClient";

export type AgentChatStartupIntent = {
  connectionId: string;
  runtimeGeneration: number;
  paneId: string;
  terminalId: string;
  agent?: string;
};

/** Window-only view intent. Session readiness always comes from its captured source. */
export function useAgentChatStartup(
  client: ConnectionClient,
  pane: Pane | undefined,
  enabled: boolean,
  onReady: () => void,
  captured?: AgentChatStartupIntent,
  onRetired?: () => void,
) {
  const intent = useMemo(
    () => ({ witness: captured, retired: false }),
    [captured],
  );
  if (!intent.witness && enabled && pane)
    intent.witness = {
      connectionId: client.connectionId,
      runtimeGeneration: connectionClientScopeGeneration(client),
      paneId: pane.pane_id,
      terminalId: pane.terminal_id,
      agent: pane.agent,
    };
  const witness = intent.witness;
  if (
    witness &&
    (client.connectionId !== witness.connectionId ||
      connectionClientScopeGeneration(client) !== witness.runtimeGeneration ||
      (pane &&
        (pane.pane_id !== witness.paneId ||
          pane.terminal_id !== witness.terminalId ||
          pane.agent !== witness.agent)))
  ) {
    intent.retired = true;
  }
  const retired = intent.retired;
  const retire = useRef(onRetired);
  retire.current = onRetired;
  useLayoutEffect(() => {
    if (enabled && retired) retire.current?.();
  }, [enabled, retired, intent]);
  const key = connectionClientScopeKey(
    client,
    pane?.pane_id,
    pane?.terminal_id,
    pane?.agent,
  );
  const owner = useMemo(
    () => ({ active: true }),
    [key, enabled, client, intent, retired],
  );
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const ready = useRef(onReady);
  ready.current = onReady;
  const paneId = pane?.pane_id;
  useEffect(() => {
    owner.active = true;
    if (!enabled || !paneId || retired)
      return () => {
        owner.active = false;
      };
    const isCurrent = () =>
      owner.active &&
      !intent.retired &&
      currentOwner.current === owner &&
      client.isCurrent();
    let flight = false,
      again = false;
    const read = () => {
      if (!isCurrent()) return;
      if (flight) {
        again = true;
        return;
      }
      flight = true;
      void client
        .call("agent_conversation.latest", { pane_id: paneId })
        .then((reply) => {
          if (isCurrent() && reply?.status === "ok") {
            owner.active = false;
            intent.retired = true;
            ready.current();
          }
        })
        .catch(() => {})
        .finally(() => {
          flight = false;
          if (again) {
            again = false;
            read();
          }
        });
    };
    const stop = watchConversation(client, paneId, read);
    read();
    return () => {
      owner.active = false;
      stop();
    };
  }, [client, enabled, key, owner, intent, retired, paneId]);
  return () => {
    intent.retired = true;
    owner.active = false;
  };
}
