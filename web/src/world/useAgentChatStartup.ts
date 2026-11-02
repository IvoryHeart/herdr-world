import { useEffect, useMemo, useRef } from "react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import { watchConversation } from "../conversationWatch";
import { connectionClientScopeKey } from "../useConnectionClient";

/** Window-only view intent. Session readiness always comes from its captured source. */
export function useAgentChatStartup(
  client: ConnectionClient,
  pane: Pane | undefined,
  enabled: boolean,
  onReady: () => void,
) {
  const key = connectionClientScopeKey(
    client,
    pane?.pane_id,
    pane?.terminal_id,
  );
  const owner = useMemo(() => ({ active: true }), [key, enabled, client]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    owner.active = true;
    if (!enabled || !pane)
      return () => {
        owner.active = false;
      };
    const isCurrent = () =>
      owner.active && currentOwner.current === owner && client.isCurrent();
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
        .call("agent_conversation.latest", { pane_id: pane.pane_id })
        .then((reply) => {
          if (isCurrent() && reply?.status === "ok") {
            owner.active = false;
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
    const stop = watchConversation(client, pane.pane_id, read);
    read();
    return () => {
      owner.active = false;
      stop();
    };
  }, [client, enabled, key, owner, pane?.pane_id]);
  return () => {
    owner.active = false;
  };
}
