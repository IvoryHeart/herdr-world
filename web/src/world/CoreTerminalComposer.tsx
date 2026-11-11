import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { TerminalComposer } from "../components/TerminalComposer";
import { chatKeyRows } from "../components/chat/chatKeys";
import { useLayoutPreferences } from "../layoutPreferences";
import { mobileTerminalShortcutExecution } from "../mobileTerminalShortcutAction";
import {
  sendTerminalComposerText,
  terminalComposerDraftKey,
} from "../terminalComposer";
import { terminalUploadedPathsText } from "../terminalFileDrop";
import {
  type UploadTarget,
  uploadTerminalFile,
  uploadTerminalImage,
} from "../terminalImageUpload";
import {
  readTerminalInputMode,
  rememberTerminalInputMode,
  type TerminalInputMode,
} from "../terminalInputMode";
import type { CoreWatchTarget } from "./CoreTerminalWatch";

const PASTE_MARKERS = /\x1b\[20[01]~/g;

/**
 * The phone's composer for a herdr-core terminal: the Terminal's own, with
 * its drafts, key controls and uploads. What it sends is typed through the
 * view's keyboard (bracketed when the program asked for it), so it takes
 * the size and stays in order with keys typed directly. Uploads go to the
 * core connection's host and come back as paths, as on a Herdr terminal.
 */
export function CoreTerminalComposer({
  target,
  type,
  terminal,
  onError,
}: {
  target: CoreWatchTarget;
  type(data: string | Uint8Array): Promise<void>;
  terminal: RefObject<Terminal | null>;
  onError(message: string): void;
}) {
  const { mobile } = useLayoutPreferences();
  const [mode, setMode] = useState<TerminalInputMode>(readTerminalInputMode);
  const keyRows = useMemo(() => chatKeyRows(), []);
  const current = useRef(true);
  const { connectionId, generation, address } = target;
  // The draft outlives this composer: the core connection's generation holds
  // its scope (useCoreTerminalWatch), so Back, reopen or a lost stream keep it.
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, [connectionId, generation]);
  const upload: UploadTarget = useMemo(
    () => ({
      connectionId,
      serverRuntimeGeneration: generation,
      isCurrent: () => current.current,
    }),
    [connectionId, generation],
  );
  if (!mobile) return null;
  // sendTerminalComposerText's pane requests, typed instead: text, then Enter.
  const keyboard = {
    call: async (_method: string, params: Record<string, unknown> = {}) => {
      const text = typeof params.text === "string" ? params.text : "";
      if (text) {
        const safe = text.replace(PASTE_MARKERS, "");
        await type(
          terminal.current?.modes.bracketedPasteMode
            ? `\x1b[200~${safe}\x1b[201~`
            : safe,
        );
      }
      if (Array.isArray(params.keys) && params.keys.includes("enter"))
        await type("\r");
    },
  };
  return (
    <div className="core-watch-composer">
      <TerminalComposer
        draftKey={terminalComposerDraftKey(connectionId, generation, address)}
        paneId={address}
        mode={mode}
        onModeChange={(next, remember) => {
          if (remember) rememberTerminalInputMode(next);
          setMode(next);
        }}
        onFocusDirect={() => terminal.current?.focus()}
        directDisabled={false}
        shortcutRows={keyRows}
        shortcutDisabledReason={(shortcut) =>
          mobileTerminalShortcutExecution(shortcut.action, false)
            ? null
            : "This key can't be sent to a herdr-core terminal."
        }
        onRunShortcut={(shortcut) => {
          const run = mobileTerminalShortcutExecution(shortcut.action, false);
          const term = terminal.current;
          if (!run || !term) return;
          if (run.type === "input") {
            void type(Uint8Array.from(run.bytes)).catch(() => undefined);
            return;
          }
          const sign = run.direction === "up" ? -1 : 1;
          if (run.amount === "full") term.scrollPages(sign);
          else term.scrollLines(sign * Math.max(1, Math.floor(term.rows / 2)));
        }}
        onClose={() => undefined}
        onSubmit={(text, submit) =>
          sendTerminalComposerText(keyboard, address, text, submit)
        }
        onUploadImage={async (file, progress) =>
          terminalUploadedPathsText([
            await uploadTerminalImage(upload, file, progress),
          ])
        }
        onUploadFile={async (file, progress) =>
          terminalUploadedPathsText([
            await uploadTerminalFile(upload, file, progress),
          ])
        }
        onError={onError}
      />
    </div>
  );
}
