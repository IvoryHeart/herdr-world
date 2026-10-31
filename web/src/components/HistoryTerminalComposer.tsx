import { useCallback, useEffect, useMemo, useRef } from "react";
import { useOperationalStore, useStoreSelector } from "../store";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../useConnectionClient";
import {
  sendTerminalComposerText,
  terminalComposerDraftKey,
  terminalComposerScopeGeneration,
} from "../terminalComposer";
import { uploadTerminalImage } from "../terminalImageUpload";
import type { Pane } from "../types";
import { AgentHistoryComposer } from "./AgentHistoryComposer";

/** World connection/draft adapter; the shared composer owns editing and confirmation. */
export function HistoryTerminalComposer({
  pane,
  open,
  onSent,
}: {
  pane: Pane;
  open: boolean;
  onSent: () => void;
}) {
  const store = useOperationalStore();
  const client = useConnectionClient();
  const connectionId = useStoreSelector((state) => state.activeConnectionId);
  const runtimeGeneration = useStoreSelector(terminalComposerScopeGeneration);
  const draftKey = terminalComposerDraftKey(
    connectionId,
    runtimeGeneration,
    pane.pane_id,
  );
  const scope = connectionClientScopeKey(
    client,
    pane.pane_id,
    pane.terminal_id,
  );
  const identity = useMemo(() => ({ scope, open }), [scope, open]);
  const current = useRef<object | null>(identity);
  current.current = identity;
  const refresh = useRef(onSent);
  refresh.current = onSent;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    current.current = identity;
    return () => {
      current.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [identity]);
  const send = useCallback(
    async (text: string) => {
      if (!open || current.current !== identity || !client.isCurrent())
        throw new Error(
          "The terminal connection changed. Reopen History to send.",
        );
      await sendTerminalComposerText(client, pane.pane_id, text, true);
      if (current.current !== identity || !client.isCurrent()) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        // The bounded History hook queues this behind an in-flight refresh.
        if (current.current === identity && client.isCurrent())
          refresh.current();
      }, 1000);
    },
    [client, identity, open, pane.pane_id],
  );
  return (
    <AgentHistoryComposer
      key={draftKey}
      draftKey={draftKey}
      agent={pane.agent}
      status={pane.agent_status}
      stateSeq={pane.state_change_seq}
      onSend={send}
      onUploadImage={async (file) => {
        if (!open || current.current !== identity || !client.isCurrent())
          throw new Error("The terminal connection changed.");
        // Preserve successful paths in this captured draft even after retirement.
        return uploadTerminalImage(client, file);
      }}
      onError={(detail) =>
        store.notify({ kind: "error", message: "Message input failed", detail })
      }
    />
  );
}
