import type { WindowSwitcherEntry } from "../world/windows/WindowSwitcher";
import { Pin, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  shallowEqual,
  useOperationalStore,
  useStoreSelector,
  useEndpointCreationReason,
} from "../store";
import { AgentStatusIcon } from "./AgentStatusIcon";
import { summarizeTabAgents } from "./agentSession";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import { requestCloseTab, tabName } from "./TabBar";
import { orderTabsForDisplay, setTabPinned, useTabPins } from "../tabPins";
import "./MobileTabSheet.css";

/**
 * The shared mobile tab list keeps native creation/closure controls and restores
 * managed windows, including retained windows from other workspaces or hosts.
 */
export function MobileTabSheet({
  open,
  onClose,
  onShowSession,
  onSelectTab,
  windows = [],
}: {
  open: boolean;
  windows?: readonly WindowSwitcherEntry[];
  onClose: () => void;
  onShowSession: () => void;
  onSelectTab?: (tabId: string) => void | Promise<unknown>;
}) {
  const store = useOperationalStore();
  const s = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      panes: state.panes,
      connectionId: state.activeConnectionId,
      runtimeGeneration: state.serverRuntimeGeneration,
      tabs: state.tabs,
      workspaces: state.workspaces,
    }),
    shallowEqual,
  );
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const transitionPendingRef = useRef(false);
  const [transitionPending, setTransitionPending] = useState(false);

  const closeIfIdle = () => {
    if (!transitionPendingRef.current) onClose();
  };
  onCloseRef.current = closeIfIdle;

  const runTabTransition = async (operation: () => Promise<unknown>) => {
    if (transitionPendingRef.current) return;
    transitionPendingRef.current = true;
    setTransitionPending(true);
    try {
      await operation();
      onClose();
      onShowSession();
    } finally {
      transitionPendingRef.current = false;
      setTransitionPending(false);
    }
  };

  const pinnedTabIds = useTabPins(s.activeConnectionId);
  const focusedWs = s.workspaces.find((w) => w.focused);
  const createReason = useEndpointCreationReason(
    "tab.create",
    focusedWs?.workspace_id,
  );
  const tabs = focusedWs
    ? orderTabsForDisplay(
        s.tabs.filter((t) => t.workspace_id === focusedWs.workspace_id),
        pinnedTabIds,
      )
    : [];

  const windowForTab = (tabId: string) =>
    windows.find(
      (entry) =>
        entry.tab?.tabId === tabId &&
        entry.tab.connectionId === s.connectionId &&
        entry.tab.runtimeGeneration === s.runtimeGeneration,
    );
  const otherWindows = windows.filter(
    (entry) => !tabs.some((tab) => windowForTab(tab.tab_id)?.id === entry.id),
  );

  useEffect(() => {
    if (!open) return;
    const cancelFocus = focusDialogElement(sheetRef.current);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let stacked dialogs (e.g. the close-tab confirmation) handle Escape.
      if (
        document.querySelector(
          ".modal-backdrop:not(.mobile-tab-sheet-backdrop)",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      cancelFocus();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [open]);

  if (!open || (!focusedWs && !windows.length)) return null;

  return createPortal(
    <div
      className="modal-backdrop mobile-tab-sheet-backdrop"
      onMouseDown={closeIfIdle}
    >
      <div
        ref={sheetRef}
        className="mobile-tab-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Tabs"
        data-window-count={windows.length}
        aria-busy={transitionPending}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mobile-tab-sheet-head">
          <h3>Tabs</h3>
          <CloseButton
            label="Close tab switcher"
            disabled={transitionPending}
            onClick={closeIfIdle}
          />
        </div>
        <div className="mobile-tab-sheet-list" role="list">
          {tabs.map((t) => {
            const name = tabName(t);
            const windowEntry = windowForTab(t.tab_id);
            const agentSummary = summarizeTabAgents(s.panes, t.tab_id);
            return (
              <div
                key={t.tab_id}
                role="listitem"
                className={`mobile-tab-sheet-row ${(windowEntry?.active ?? t.focused) ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="mobile-tab-sheet-focus"
                  disabled={transitionPending}
                  onClick={() =>
                    void runTabTransition(() => {
                      windowEntry?.onSelect();
                      return Promise.resolve(
                        onSelectTab
                          ? onSelectTab(t.tab_id)
                          : store.focusTab(t.tab_id),
                      );
                    })
                  }
                >
                  {agentSummary ? (
                    <span
                      className="tabbar-agent-marker"
                      aria-label={`${agentSummary.primaryAgent}, status ${agentSummary.status}`}
                    >
                      <AgentStatusIcon
                        agent={agentSummary.primaryAgent}
                        status={agentSummary.status}
                      />
                      {agentSummary.additionalAgents > 0 ? (
                        <span className="tabbar-agent-more">
                          +{agentSummary.additionalAgents}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="mobile-tab-sheet-name">{name}</span>
                  {windowEntry?.minimized ? <small>Minimized</small> : null}
                </button>
                {pinnedTabIds.has(t.tab_id) ? (
                  <button
                    type="button"
                    className="mobile-tab-sheet-close is-pinned"
                    aria-label={`Unpin ${name}`}
                    title={`Unpin ${name}`}
                    disabled={transitionPending}
                    onClick={() =>
                      setTabPinned(s.activeConnectionId, t.tab_id, false)
                    }
                  >
                    <Pin size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mobile-tab-sheet-close"
                    aria-label={`Close ${name}`}
                    title={`Close ${name}`}
                    disabled={transitionPending}
                    onClick={() =>
                      requestCloseTab(t.tab_id, {
                        connectionId: store.get().activeConnectionId,
                        runtimeGeneration:
                          store.get().serverRuntimeGeneration ?? -1,
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {otherWindows.length ? (
            <div className="mobile-tab-sheet-section">Other open windows</div>
          ) : null}
          {otherWindows.map((entry) => (
            <div
              key={entry.id}
              role="listitem"
              className={`mobile-tab-sheet-row ${entry.active ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="mobile-tab-sheet-focus"
                disabled={transitionPending}
                onClick={() => {
                  entry.onSelect();
                  onClose();
                  onShowSession();
                }}
              >
                <span className="mobile-tab-sheet-name">{entry.label}</span>
                {entry.minimized ? <small>Minimized</small> : null}
              </button>
            </div>
          ))}
        </div>
        {focusedWs ? (
          <button
            type="button"
            className="mobile-tab-sheet-new"
            title={createReason ?? undefined}
            disabled={transitionPending || !!createReason}
            onClick={() =>
              void runTabTransition(() =>
                store.createTab(focusedWs.workspace_id),
              )
            }
          >
            <Plus size={15} />
            <span>{createReason ?? "New Tab"}</span>
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
