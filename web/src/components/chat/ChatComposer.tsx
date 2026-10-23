import type { ConnectionClient } from "../../api";
import type { Pane } from "../../types";
import {
  uploadTerminalFile,
  uploadTerminalImage,
} from "../../terminalImageUpload";
import { terminalUploadedPathsText } from "../../terminalFileDrop";
import { TerminalComposer } from "../TerminalComposer";

const noop = () => {};

/** Drafts cannot cross terminal ownership, runtime or conversation replacement. */
export const chatComposerDraftKey = (
  client: ConnectionClient,
  pane: Pane,
  fingerprint: string | null | undefined,
) =>
  JSON.stringify([
    "chat",
    client.connectionId,
    client.serverRuntimeGeneration,
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
  disabledReason,
  onSubmit,
  onError,
}: {
  client: ConnectionClient;
  pane: Pane;
  fingerprint: string;
  recipient: string;
  notice: string;
  disabledReason?: string;
  onSubmit: (text: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <div className="agent-chat-composer">
      <TerminalComposer
        surface="chat"
        draftKey={chatComposerDraftKey(client, pane, fingerprint)}
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
