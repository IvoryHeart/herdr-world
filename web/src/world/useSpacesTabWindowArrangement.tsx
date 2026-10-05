import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  WindowArrangementCommand,
  WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import { useLayoutPreferences } from "../layoutPreferences";
import { shallowEqual, useOperationalStore, useStoreSelector } from "../store";
import {
  availableSpacesWindowStage,
  spacesTabWindowContext,
} from "./spacesTabWindowArrangementModel";
import { terminalWindowArrangementReason } from "./terminalWindowArrangement";
import { useWindowManager } from "./windows/useWindowManager";
import { visibleWindowIds } from "./windows/windowManager";
import { WindowSurface } from "./windows/WindowSurface";
import { WindowFrame } from "./windows/WindowFrame";
import { WindowControls } from "./windows/WindowControls";

const ignoreLayer = () => {};

/** World presentation adapter. Roamgate's native tab and pane ownership stay in App. */
export function useSpacesTabWindowArrangement(active: boolean): {
  arrangementControl: WindowArrangementControl;
  spacesTabWindows: { tabId: string; portal: Element | null }[];
  renderWindows: ReactNode;
  onFocusSpacesTabWindow: (tabId: string, paneId: string | null) => void;
  suspended: boolean;
  presentedTabId: string | null;
  resumeTab: (tabId: string) => void;
  onSpacesWindowLayerReady: (element: HTMLDivElement | null) => void;
} {
  const store = useOperationalStore();
  const snapshot = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      serverRuntimeGeneration: state.serverRuntimeGeneration,
      workspaces: state.workspaces,
      tabs: state.tabs,
    }),
    shallowEqual,
  );
  const { mobile } = useLayoutPreferences();
  const context = useMemo(() => spacesTabWindowContext(snapshot), [snapshot]);
  const scopeKey = context
    ? JSON.stringify([context.leaseKey, context.scopeKey])
    : "unavailable";
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [portals, setPortals] = useState<Record<string, HTMLDivElement | null>>(
    {},
  );
  const inputs = useMemo(
    () =>
      context?.tabs.map((tab) => ({
        id: tab.tab_id,
        label: tab.label || `Tab ${tab.number}`,
      })) ?? [],
    [context],
  );
  const { state, dispatch } = useWindowManager(inputs, stage, scopeKey, true);
  const onSpacesWindowLayerReady = useCallback(
    (element: HTMLDivElement | null) =>
      setLayer((current) => (current === element ? current : element)),
    [],
  );
  useLayoutEffect(() => {
    if (!active || !layer) return;
    const stageHost = layer.closest<HTMLElement>(".workspace-stage");
    let observedInspector: HTMLElement | null = null;
    const observer = new ResizeObserver(() => measure());
    const mutation = new MutationObserver(() => measure());
    const measure = () => {
      const inspector =
        stageHost?.querySelector<HTMLElement>(".workspace-inspector-slot") ??
        null;
      if (inspector !== observedInspector) {
        if (observedInspector) observer.unobserve(observedInspector);
        observedInspector = inspector;
        if (inspector) observer.observe(inspector);
        mutation.disconnect();
        if (stageHost) {
          mutation.observe(stageHost, {
            childList: true,
            attributes: true,
            attributeFilter: ["class"],
          });
        }
        if (inspector) {
          mutation.observe(inspector, {
            attributes: true,
            attributeFilter: ["class", "style"],
          });
        }
      }
      const visibleInspector =
        inspector &&
        !inspector.classList.contains("is-closed") &&
        getComputedStyle(inspector).display !== "none" &&
        getComputedStyle(inspector).visibility !== "hidden"
          ? inspector
          : null;
      const { width, height } = availableSpacesWindowStage(
        { width: layer.clientWidth, height: layer.clientHeight },
        layer.getBoundingClientRect(),
        visibleInspector?.getBoundingClientRect() ?? null,
        stageHost?.classList.contains("inspector-dock-bottom")
          ? "bottom"
          : "right",
      );
      setStage((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    observer.observe(layer);
    if (stageHost) {
      mutation.observe(stageHost, {
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    measure();
    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [active, layer]);

  const visible = visibleWindowIds(state, mobile);
  const suspended = state.order.length > 0 && visible.length === 0;
  // Compact presentation and native Single use the original pane layout host.
  const native =
    mobile || state.focusMode || stage.width < 236 || stage.height < 176;
  const activate = (tabId: string, paneId: string | null) => {
    if (!active || !context?.tabs.some((tab) => tab.tab_id === tabId)) return;
    dispatch({ type: "focus", id: tabId });
    if (paneId === null && context.activeTabId !== tabId)
      void store.focusTab(tabId).catch(() => undefined);
  };
  const previousTab = useRef("");
  useEffect(() => {
    if (!active || !context || !state.windows[context.activeTabId]) return;
    const key = JSON.stringify([scopeKey, context.activeTabId]);
    if (previousTab.current === key) return;
    previousTab.current = key;
    // Returning to a suspended scope must not implicitly reopen it.
    if (!suspended) dispatch({ type: "focus", id: context.activeTabId });
  }, [active, scopeKey, context, suspended, dispatch, state.windows]);
  const resumeTab = (tabId: string) => {
    if (!context?.tabs.some((tab) => tab.tab_id === tabId)) return;
    dispatch({ type: "focus", id: tabId });
    if (suspended) dispatch({ type: "arrange", preset: "single" });
  };
  const onSelect = (command: WindowArrangementCommand) => {
    if (!active || !context || !layer || !stage.width || !stage.height) return;
    if (command === "close-all") {
      dispatch({ type: "dismiss-all" });
      return;
    }
    if (command === "restore") {
      dispatch({ type: "restore-layout" });
      return;
    }
    if (command === "open-all") {
      dispatch({ type: "arrange", preset: "grid", includeMinimized: true });
      return;
    }
    if (mobile && command !== "single") return;
    dispatch({ type: "arrange", preset: command });
  };
  const disabledReasons: WindowArrangementControl["disabledReasons"] = {};
  for (const preset of [
    "single",
    "cascade",
    "columns",
    "rows",
    "grid",
  ] as const) {
    const reason =
      mobile && preset !== "single"
        ? "Available in desktop layout."
        : terminalWindowArrangementReason(
            preset,
            { left: 0, top: 0, ...stage },
            inputs
              .filter((input) => !state.windows[input.id]?.minimized)
              .map((input) => ({
                ...input,
                minWidth: mobile ? Math.min(320, stage.width) : 320,
                minHeight: mobile ? Math.min(180, stage.height) : 180,
              })),
            state.activeId,
          );
    if (reason) disabledReasons[preset] = reason;
  }
  if (!state.baseline)
    disabledReasons.restore = "No arranged positions to restore.";
  if (suspended || !state.order.length)
    disabledReasons["close-all"] = "No windows are presented.";
  const keyFor = (id: string) => JSON.stringify([scopeKey, id]);
  const spacesTabWindows =
    native || !active || suspended
      ? []
      : visible.map((tabId) => ({
          tabId,
          portal: portals[keyFor(tabId)] ?? null,
        }));
  const renderWindows =
    active && layer && context && !native && !suspended
      ? createPortal(
          <WindowSurface
            state={state}
            dispatch={dispatch}
            stage={stage}
            compact={false}
            onLayer={ignoreLayer}
            bounds={stage}
            className="world-spaces-window-surface"
          >
            {({
              entry,
              geometry,
              stage: windowStage,
              workArea,
              zIndex,
              active: windowActive,
            }) => {
              const tab = context.tabs.find((tab) => tab.tab_id === entry.id);
              if (!tab) return null;
              const label = tab.label || `Tab ${tab.number}`;
              return (
                <WindowFrame
                  key={entry.id}
                  id={entry.id}
                  label={`${label} terminal window`}
                  geometry={geometry}
                  restoreGeometry={
                    entry.maximized || entry.placement.kind !== "floating"
                      ? entry.floating
                      : undefined
                  }
                  stage={windowStage}
                  workArea={workArea}
                  active={windowActive}
                  compact={false}
                  zIndex={zIndex}
                  className="spaces-tab-window"
                  onRaise={() => dispatch({ type: "raise", id: entry.id })}
                  onPlace={(rect) =>
                    dispatch({ type: "place", id: entry.id, rect })
                  }
                  onSnap={(target) =>
                    dispatch({ type: "snap", id: entry.id, target })
                  }
                  onMaximize={() =>
                    dispatch({ type: "maximize", id: entry.id })
                  }
                  onPortalChange={(portal) => {
                    const key = keyFor(entry.id);
                    setPortals((previous) =>
                      previous[key] === portal
                        ? previous
                        : { ...previous, [key]: portal },
                    );
                  }}
                >
                  <header className="world-window-header">
                    <button
                      type="button"
                      data-window-drag-handle
                      className="world-window-title spaces-tab-window-move"
                      aria-label={`Move ${label} window`}
                      onClick={() => activate(entry.id, null)}
                    >
                      {label}
                    </button>
                    <WindowControls
                      label={`${label} window`}
                      controls={{
                        maximized: entry.maximized,
                        compact: false,
                        onMinimize: () =>
                          dispatch({ type: "minimize", id: entry.id }),
                        onMaximize: () =>
                          dispatch({ type: "maximize", id: entry.id }),
                        onClose: () =>
                          dispatch({ type: "dismiss", id: entry.id }),
                        onSnap: (target) =>
                          dispatch({ type: "snap", id: entry.id, target }),
                        onFloat: () =>
                          dispatch({ type: "float", id: entry.id }),
                      }}
                    />
                  </header>
                </WindowFrame>
              );
            }}
          </WindowSurface>,
          layer,
          scopeKey,
        )
      : null;
  return {
    arrangementControl: {
      activePreset: native ? "single" : (state.layout?.preset ?? null),
      disabledReasons,
      onSelect,
      windows: inputs
        .filter((input) => !state.windows[input.id]?.dismissed)
        .map((input) => ({
          id: input.id,
          tab: {
            connectionId: snapshot.activeConnectionId,
            runtimeGeneration: snapshot.serverRuntimeGeneration ?? -1,
            tabId: input.id,
          },
          label: input.label,
          active: input.id === state.activeId,
          minimized: state.windows[input.id]?.minimized ?? false,
          onSelect: () => activate(input.id, null),
        })),
    },
    spacesTabWindows,
    renderWindows,
    onFocusSpacesTabWindow: activate,
    suspended,
    presentedTabId: state.activeId,
    resumeTab,
    onSpacesWindowLayerReady,
  };
}
