import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { ChevronDown, EllipsisVertical, SquareStack } from "lucide-react";
import { useStoreSelector } from "../store";
import type { Pane } from "../types";
import { agentStateKind, type AgentStateKind } from "./agentSession";
import { tabName } from "./TabBar";
import "./MobileControls.css";

/**
 * Mobile app-bar controls for a terminal screen, following platform
 * conventions: Back at the far left (World's shell), then the terminal's
 * identity, then Tabs and the ⋮ overflow menu. App owns the workspace state
 * and the visible terminal publishes its identity; both reach the app bar
 * through module stores so App's upstream-shared markup stays unwrapped.
 */
export type MobileControls = {
  tabCount: number;
  /** Another tab in the focused workspace has an agent blocked on the user. */
  attention: boolean;
  tabsDisabled: boolean;
  tabsOpen: boolean;
  showTabs: () => void;
  moreOpen: boolean;
  toggleMore: () => void;
  workspacesOpen: boolean;
  toggleWorkspaces: () => void;
};

type MobileTerminalIdentity = {
  agent: string;
  place: string;
  status: AgentStateKind;
};

function createStore<T>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | null) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const controlsStore = createStore<MobileControls>();
const terminalStore = createStore<MobileTerminalIdentity>();

function useStoreValue<T>(store: ReturnType<typeof createStore<T>>) {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

export function usePublishMobileControls(controls: MobileControls | null) {
  const latest = useRef(controls);
  latest.current = controls;
  const key = controls
    ? [
        controls.tabCount,
        controls.attention,
        controls.tabsDisabled,
        controls.tabsOpen,
        controls.moreOpen,
        controls.workspacesOpen,
      ].join("|")
    : "";
  useLayoutEffect(() => {
    const live = latest.current;
    controlsStore.set(
      live
        ? {
            ...live,
            showTabs: () => latest.current?.showTabs(),
            toggleMore: () => latest.current?.toggleMore(),
            toggleWorkspaces: () => latest.current?.toggleWorkspaces(),
          }
        : null,
    );
  }, [key]);
  useLayoutEffect(() => () => controlsStore.set(null), []);
}

/** The visible, active terminal names itself for the app bar. */
export function usePublishMobileTerminal(
  pane: Pane | null | undefined,
  active: boolean,
) {
  const place = useStoreSelector((state) =>
    pane ? tabName(state.tabs.find((tab) => tab.tab_id === pane.tab_id)) : "",
  );
  const agent = pane?.display_agent?.trim() || pane?.agent?.trim() || "";
  const status = agentStateKind(pane?.agent_status);
  const visible = active && !!pane;
  useLayoutEffect(() => {
    if (!visible) return;
    terminalStore.set({ agent: agent || "Terminal", place, status });
    return () => terminalStore.set(null);
  }, [visible, agent, place, status]);
}

const STATUS_LABEL: Record<AgentStateKind, string> = {
  working: "Working",
  blocked: "Needs you",
  idle: "Idle",
  done: "Done",
  unknown: "",
};

export function MobileTerminalAppBar() {
  const controls = useStoreValue(controlsStore);
  const terminal = useStoreValue(terminalStore);
  if (!controls) return null;
  const description =
    [
      controls.tabCount > 0 ? `${controls.tabCount} open` : "",
      controls.attention ? "an agent needs you" : "",
    ]
      .filter(Boolean)
      .join(", ") || undefined;
  return (
    <div className="mobile-terminal-appbar">
      {terminal ? (
        <button
          type="button"
          className="mobile-terminal-title"
          aria-label={`Switch workspace. Current: ${terminal.agent}${terminal.place ? ` in ${terminal.place}` : ""}`}
          aria-expanded={controls.workspacesOpen}
          onClick={controls.toggleWorkspaces}
        >
          <span className="mobile-terminal-name">
            {terminal.agent}
            {terminal.place ? (
              <span className="mobile-terminal-place"> · {terminal.place}</span>
            ) : null}
          </span>
          {STATUS_LABEL[terminal.status] ? (
            <span
              className="mobile-terminal-status"
              data-status={terminal.status}
            >
              {STATUS_LABEL[terminal.status]}
            </span>
          ) : null}
          <ChevronDown
            className="mobile-terminal-title-chevron"
            size={16}
            aria-hidden="true"
          />
        </button>
      ) : null}
      <button
        type="button"
        className="mobile-tabs-button"
        aria-label="Show tabs"
        aria-description={description}
        aria-pressed={controls.tabsOpen}
        disabled={controls.tabsDisabled}
        onClick={controls.showTabs}
      >
        <SquareStack size={21} aria-hidden="true" />
        {controls.tabCount > 0 ? (
          <span
            className="mobile-tabs-count"
            data-attention={controls.attention || undefined}
            aria-hidden="true"
          >
            {controls.tabCount}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="mobile-more-button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={controls.moreOpen}
        onClick={controls.toggleMore}
      >
        <EllipsisVertical size={21} aria-hidden="true" />
      </button>
    </div>
  );
}
