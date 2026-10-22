import { useLayoutEffect, useMemo, useRef } from "react";
import { worldLocalStorage } from "../../browserStorage";
import { TerminalComposer } from "../../components/TerminalComposer";
import { mobileTerminalShortcutExecution } from "../../mobileTerminalShortcutAction";
import {
  defaultMobileTerminalShortcutRows,
  MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  parseMobileTerminalShortcutRows,
  type MobileTerminalShortcut,
} from "../../mobileTerminalShortcuts";
import { terminalComposerDraftKey } from "../../terminalComposer";
import {
  uploadTerminalFile,
  uploadTerminalImage,
} from "../../terminalImageUpload";
import { sendTerminalInput } from "../../terminalInput";
import type { WorldLeafObject } from "../worldObject";
import { sendTownReply, townOwner, TownReplyError } from "./townChat";

function shortcutRows() {
  try {
    const stored = worldLocalStorage.getItem(
      MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
    );
    return stored === null
      ? defaultMobileTerminalShortcutRows()
      : parseMobileTerminalShortcutRows(stored);
  } catch {
    return defaultMobileTerminalShortcutRows();
  }
}

/**
 * World's terminal composer, in Town, for one exact pane: the same text box,
 * keys, attachments and draft as that pane's terminal, without opening it.
 */
export function TownComposer({
  leaf,
  onClose,
  onSent,
  onError,
  onDirect,
}: {
  leaf: WorldLeafObject;
  /** Direct typing happens in the pane's full terminal. */
  onDirect(): void;
  onClose(): void;
  onSent(submitted: boolean): void;
  onError(message: string): void;
}) {
  const rows = useMemo(shortcutRows, []);
  const box = useRef<HTMLDivElement>(null);
  // Opened from the message box: put the caret in the composer straight away.
  useLayoutEffect(() => {
    box.current
      ?.querySelector<HTMLTextAreaElement>(".terminal-composer-input")
      ?.focus({ preventScroll: true });
  }, []);
  const owner = () => {
    const client = townOwner(leaf);
    if (!client)
      throw new TownReplyError(
        "This agent's host changed; refresh before replying.",
      );
    return client;
  };
  const execution = (shortcut: MobileTerminalShortcut) =>
    mobileTerminalShortcutExecution(shortcut.action, false);
  return (
    <div className="town-composer" ref={box}>
      <TerminalComposer
        draftKey={terminalComposerDraftKey(
          leaf.connectionId,
          leaf.generation,
          leaf.pane.pane_id,
        )}
        agent={leaf.pane.agent}
        mode="composer"
        onModeChange={() => {}}
        onFocusDirect={onDirect}
        directDisabled={false}
        shortcutRows={rows}
        onRunShortcut={(shortcut) => {
          const run = execution(shortcut);
          if (run?.type !== "input") return;
          void sendTerminalInput(
            owner(),
            Uint8Array.from(run.bytes),
            leaf.terminalId,
          ).catch((cause: unknown) =>
            onError(cause instanceof Error ? cause.message : String(cause)),
          );
        }}
        shortcutDisabledReason={(shortcut) => {
          const run = execution(shortcut);
          if (!run) return "This key needs the full terminal.";
          return run.type === "scroll" ? "Scroll in the full terminal." : null;
        }}
        onClose={onClose}
        onSubmit={async (text, submit) => {
          await sendTownReply(leaf, text, submit);
          onSent(submit);
        }}
        onUploadImage={(file, onProgress) =>
          uploadTerminalImage(owner(), file, onProgress)
        }
        onUploadFile={(file, onProgress) =>
          uploadTerminalFile(owner(), file, onProgress)
        }
        onError={onError}
      />
    </div>
  );
}
