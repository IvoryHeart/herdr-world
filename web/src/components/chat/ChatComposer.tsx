import { useEffect, useMemo, useRef } from "react";
import type { ChatFocusIntent } from "../../chatFocus";
import type { ConnectionClient } from "../../api";
import type { Pane } from "../../types";
import { connectionClientScopeGeneration } from "../../useConnectionClient";
import {
  uploadTerminalFile,
  uploadTerminalImage,
} from "../../terminalImageUpload";
import { terminalUploadedPathsText } from "../../terminalFileDrop";
import { TerminalComposer } from "../TerminalComposer";
import { chatKeyName, chatKeyRows } from "./chatKeys";

const noop = () => {};

/** App admits the connection/runtime prefix; the suffix isolates Chat ownership. */
export const chatComposerDraftKey = (
  client: ConnectionClient,
  pane: Pane,
  fingerprint: string | null | undefined,
) =>
  JSON.stringify([
    client.connectionId,
    connectionClientScopeGeneration(client),
    "chat",
    pane.terminal_id,
    pane.pane_id,
    fingerprint ?? null,
  ]);

export function ChatComposer({
  client,
  pane,
  fingerprint,
  recipient,
  notice,
  active = true,
  focusIntent,
  disabledReason,
  onSubmit,
  onKey,
  onError,
}: {
  client: ConnectionClient;
  pane: Pane;
  fingerprint: string;
  recipient: string;
  notice: string;
  active?: boolean;
  focusIntent: ChatFocusIntent | null;
  disabledReason?: string;
  onSubmit: (text: string) => Promise<void>;
  /** Press one of the terminal's key controls in the agent's pane. */
  onKey?: (key: string) => void;
  onError: (message: string) => void;
}) {
  // The same key controls as the Terminal, read when Chat opens.
  const hasKeys = Boolean(onKey);
  const keyRows = useMemo(() => (hasKeys ? chatKeyRows() : []), [hasKeys]);
  const composerRef = useRef<HTMLDivElement>(null);
  const draftKey = chatComposerDraftKey(client, pane, fingerprint);
  useEffect(() => {
    if (!active || !focusIntent) return;
    let cancelled = false;
    // Focus after React's effects so the shared editor's input-mode handoff
    // runs as an input event, not inside an effect's flush.
    queueMicrotask(() => {
      if (!cancelled) {
        const input =
          composerRef.current?.querySelector<HTMLTextAreaElement>("textarea");
        if (input) focusIntent.focus(input);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, focusIntent]);
  return (
    <div className="agent-chat-composer" ref={composerRef}>
      <TerminalComposer
        surface="chat"
        open={active}
        draftKey={draftKey}
        paneId={pane.pane_id}
        recipient={recipient}
        agent={pane.agent}
        mode="composer"
        onModeChange={noop}
        onFocusDirect={noop}
        directDisabled
        shortcutRows={keyRows}
        onRunShortcut={(shortcut) => {
          const key = chatKeyName(shortcut.action);
          if (key) onKey?.(key);
        }}
        onClose={noop}
        notice={notice}
        disabledReason={disabledReason}
        onSubmit={(text) => onSubmit(text)}
        onError={onError}
        onUploadImage={async (file, progress) =>
          terminalUploadedPathsText([
            await uploadTerminalImage(client, file, progress),
          ])
        }
        onUploadFile={async (file, progress) =>
          terminalUploadedPathsText([
            await uploadTerminalFile(client, file, progress),
          ])
        }
      />
    </div>
  );
}
