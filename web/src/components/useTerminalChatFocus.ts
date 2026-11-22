import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { ConnectionClient } from "../api";
import {
  isEditableElement,
  shouldAvoidVirtualKeyboard,
} from "./terminalViewState";
import { terminalFocusBlockedByOverlay } from "../terminalFocus";
export function useTerminalChatFocus(
  connectionClient: ConnectionClient,
  isActivePaneRef: RefObject<boolean>,
  chatShownRef: RefObject<boolean>,
) {
  // A pane shown as a chat takes the keyboard in its message box, on
  // activation as a terminal would: not on a phone (the keyboard would
  // pop up), nor away from another field or an open overlay.
  const chatLayerRef = useRef<HTMLDivElement | null>(null);
  // The pane's buttons float over the chat's header, which keeps clear of
  // them: their width, as --pane-toolbar-width on the pane.
  const paneToolbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const toolbar = paneToolbarRef.current;
    const shell = toolbar?.parentElement;
    if (!toolbar || !shell) return;
    const observer = new ResizeObserver(() =>
      shell.style.setProperty(
        "--pane-toolbar-width",
        `${toolbar.offsetWidth}px`,
      ),
    );
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const focusChatSoon = useCallback(() => {
    if (!isActivePaneRef.current || shouldAvoidVirtualKeyboard()) return;
    let tries = 0;
    const attempt = () => {
      if (
        !connectionClient.isCurrent() ||
        !isActivePaneRef.current ||
        !chatShownRef.current
      )
        return;
      const layer = chatLayerRef.current;
      const active = document.activeElement;
      const activeElement = active instanceof HTMLElement ? active : null;
      if (!layer || layer.contains(activeElement)) return;
      // Another pane's terminal or message box gives way; other fields not.
      const fromPane = !!activeElement?.closest(".xterm, .terminal-chat-layer");
      if (isEditableElement(active) && !fromPane) return;
      if (terminalFocusBlockedByOverlay(activeElement, document)) return;
      const box = layer.querySelector<HTMLElement>(
        '.agent-history-composer textarea, .agent-history-composer [contenteditable="true"]',
      );
      // The box may still be loading.
      if (!box) {
        if ((tries += 1) < 20) window.setTimeout(attempt, 50);
        return;
      }
      box.focus();
    };
    requestAnimationFrame(() => window.setTimeout(attempt, 0));
  }, [connectionClient, isActivePaneRef, chatShownRef]);
  return { chatLayerRef, paneToolbarRef, focusChatSoon };
}
