import type { MutableRefObject } from "react";
import { connectionSnapshot, store } from "../store";
import { inspectorPaneInput } from "./inspectorTerminalHandoff";
import {
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

/** Preserve the existing qualified terminal focus handoff outside controller routing. */
export function createInspectorTerminalFocuser(
  inspectorFocusIntentRef: MutableRefObject<number>,
  inspectorConversationsRef: MutableRefObject<
    readonly WorldInspectorConversation[]
  >,
  floatingInspectorPortalsRef: MutableRefObject<
    Record<string, HTMLDivElement | null>
  >,
) {
  return (windowId: string) => {
    const focusIntent = ++inspectorFocusIntentRef.current;
    const expected = inspectorConversationsRef.current.find(
      (candidate) => worldInspectorWindowId(candidate) === windowId,
    );
    if (!expected?.paneId) return;
    if (
      document.documentElement.dataset.layout === "mobile" ||
      window.matchMedia?.("(any-pointer: coarse)").matches
    ) {
      return;
    }
    const attempt = (remaining: number) => {
      if (inspectorFocusIntentRef.current !== focusIntent) return;
      if (
        document.querySelector(
          '.world-hosts-menu, .command-popover, .modal-backdrop, [role="menu"]',
        )
      )
        return;
      const conversation = inspectorConversationsRef.current.find(
        (candidate) => worldInspectorWindowId(candidate) === windowId,
      );
      const snapshot = conversation
        ? connectionSnapshot(store.get(), conversation.connectionId)
        : null;
      if (
        !conversation ||
        !snapshot ||
        conversation.view !== "terminal" ||
        !conversation.paneId ||
        conversation.paneId !== expected.paneId ||
        conversation.terminalId !== expected.terminalId ||
        snapshot.serverRuntimeGeneration !== conversation.runtimeGeneration ||
        snapshot.selectedPaneId !== conversation.paneId ||
        !snapshot.panes.some(
          (pane) =>
            pane.pane_id === conversation.paneId &&
            pane.terminal_id === conversation.terminalId &&
            pane.workspace_id === conversation.workspaceId &&
            pane.tab_id === conversation.tabId,
        )
      )
        return;
      const target = floatingInspectorPortalsRef.current[windowId];
      const input = inspectorPaneInput(target, conversation.paneId);
      if (input) {
        input.focus({ preventScroll: true });
        return;
      }
      if (remaining > 0) {
        window.setTimeout(() => attempt(remaining - 1), 0);
      }
    };
    requestAnimationFrame(() => attempt(2));
  };
}
