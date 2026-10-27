import { useEffect, useRef } from "react";
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
  onError: (message: string) => void;
}) {
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
        shortcutRows={[]}
        onRunShortcut={noop}
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
