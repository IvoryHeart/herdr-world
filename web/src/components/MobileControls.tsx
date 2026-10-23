import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { paneAgentName } from "../agentName";
import { ChevronDown, EllipsisVertical, Pin, SquareStack } from "lucide-react";
import { useStoreSelector } from "../store";
import type { Pane, Tab } from "../types";
import { agentStateKind, type AgentStateKind } from "./agentSession";
import { ColorSwatchButton } from "./ColorSwatch";
import type { TabColorControl, TabColorOwner } from "./TabBar";
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
  /** Optional terminal colours, chosen from a swatch beside the title. */
  tabColors?: TabColorControl;
  /** Optional pin toggle beside the swatch (World's desk or card pin). */
  tabPin?: TabPinControl;
};

export type TabPinControl = {
  label: { pin: string; unpin: string; title: string };
  pinnedOf(owner: TabColorOwner, tab: Tab): boolean;
  onPin(owner: TabColorOwner, tab: Tab, pinned: boolean): void;
};

type MobileTerminalIdentity = {
  workspaceId: string;
  agent: string;
  place: string;
  status: AgentStateKind;
  tab?: Tab;
  owner: TabColorOwner;
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

// TabBar's tabName, kept here so the terminal does not load the tab bar's
// agent icons.
function tabName(tab?: Tab) {
  if (!tab) return "";
  return tab.label && tab.label !== String(tab.number)
    ? tab.label
    : `Tab ${tab.number}`;
}

const controlsStore = createStore<MobileControls>();
const terminalStore = createStore<MobileTerminalIdentity>();

function useStoreValue<T>(store: ReturnType<typeof createStore<T>>) {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

/** The shell's published mobile controls, or null outside the phone layout. */
export function useMobileControls() {
  return useStoreValue(controlsStore);
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
  const tabColors = controls?.tabColors;
  const tabPin = controls?.tabPin;
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
  }, [key, tabColors, tabPin]);
  useLayoutEffect(() => () => controlsStore.set(null), []);
}

/**
 * The visible, active terminal names itself for the app bar. A separate
 * component, so its updates never re-render the terminal mid-gesture.
 */
export function MobileTerminalIdentity({
  pane,
  active,
  element,
}: {
  pane: Pane | null | undefined;
  active: boolean;
  element: HTMLElement | null;
}) {
  const tab = useStoreSelector((state) =>
    pane ? state.tabs.find((tab) => tab.tab_id === pane.tab_id) : undefined,
  );
  const place = tabName(tab);
  const connectionId = useStoreSelector((state) => state.activeConnectionId);
  const workspaceIds = useStoreSelector((state) =>
    (state.workspaces ?? [])
      .map((workspace) => workspace.workspace_id)
      .join("\n"),
  );
  const agent = pane ? paneAgentName(pane) : "";
  const status = agentStateKind(pane?.agent_status);
  const workspaceId = pane?.workspace_id ?? "";
  // Mounted terminals can sit hidden behind another view (Spaces under a
  // scene, a terminal under a space's Files); only one with size on screen
  // names the app bar.
  const [onScreen, setOnScreen] = useState(false);
  useLayoutEffect(() => {
    if (!element) {
      setOnScreen(false);
      return;
    }
    const measure = () =>
      setOnScreen(element.offsetWidth > 0 && element.offsetHeight > 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const visible = active && !!pane && onScreen;
  useLayoutEffect(() => {
    if (!visible) return;
    const identity = {
      workspaceId,
      agent: agent || "Terminal",
      place,
      status,
      tab,
      owner: {
        connectionId,
        workspaceIds: workspaceIds ? workspaceIds.split("\n") : [],
      },
    };
    terminalStore.set(identity);
    return () => {
      // Another visible terminal may have published since; keep its name.
      if (terminalStore.get() === identity) terminalStore.set(null);
    };
  }, [
    visible,
    workspaceId,
    agent,
    place,
    status,
    tab,
    connectionId,
    workspaceIds,
  ]);
  return null;
}

/** The workspace of the terminal on screen, which Tabs should follow. */
export function useVisibleTerminalWorkspaceId() {
  return useStoreValue(terminalStore)?.workspaceId ?? null;
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
  const onScreen = useStoreValue(terminalStore);
  // The workspace list covers the terminal it was opened from; keep that
  // terminal's title so the same control closes the list again.
  const lastTerminal = useRef(onScreen);
  if (onScreen) lastTerminal.current = onScreen;
  const terminal =
    onScreen ?? (controls?.workspacesOpen ? lastTerminal.current : null);
  if (!controls) return null;
  const description =
    [
      controls.tabCount > 0 ? `${controls.tabCount} open` : "",
      controls.attention ? "an agent needs you" : "",
    ]
      .filter(Boolean)
      .join(", ") || undefined;
  const color =
    terminal?.tab && controls.tabColors
      ? controls.tabColors.colorOf(terminal.owner, terminal.tab)
      : null;
  return (
    <div className="mobile-terminal-appbar">
      {terminal?.tab && controls.tabColors && color ? (
        <ColorSwatchButton
          className="mobile-terminal-swatch"
          label="Terminal colour"
          palette={controls.tabColors.palette}
          current={color}
          onColor={(id) => {
            const { tabColors } = controls;
            if (terminal.tab && tabColors)
              tabColors.onColor(terminal.owner, terminal.tab, id);
          }}
        />
      ) : null}
      {terminal?.tab && controls.tabPin ? (
        <MobileTerminalPin
          pin={controls.tabPin}
          owner={terminal.owner}
          tab={terminal.tab}
        />
      ) : null}
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

function MobileTerminalPin({
  pin,
  owner,
  tab,
}: {
  pin: TabPinControl;
  owner: TabColorOwner;
  tab: Tab;
}) {
  const pinned = pin.pinnedOf(owner, tab);
  return (
    <button
      type="button"
      className="mobile-terminal-pin"
      aria-label={pinned ? pin.label.unpin : pin.label.pin}
      aria-pressed={pinned}
      title={pin.label.title}
      onClick={() => pin.onPin(owner, tab, !pinned)}
    >
      <Pin size={18} aria-hidden="true" />
    </button>
  );
}
