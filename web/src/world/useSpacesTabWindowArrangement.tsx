import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  WindowArrangementCommand,
  WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import { requestCloseTab } from "../components/TabBar";
import { useLayoutPreferences } from "../layoutPreferences";
import { shallowEqual, store, useStoreSelector } from "../store";
import { type FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import { SpacesTabWindow } from "./SpacesTabWindow";
import {
  terminalWindowArrangementReason,
  type TerminalWindowArrangementPreset,
  type TerminalWindowArrangementWindow,
} from "./terminalWindowArrangement";
import {
  applyTerminalWindowArrangement,
  createTerminalWindowArrangementState,
  restoreTerminalWindowArrangement,
  retainTerminalWindowArrangementWindows,
  terminalWindowArrangementForLease,
  updateTerminalWindowArrangementGeometry,
} from "./terminalWindowArrangementState";
import {
  availableSpacesWindowStage,
  clampSpacesTabWindowGeometry,
  orderedSpacesTabs,
  spacesTabWindowContext,
  spacesTabWindowEntries,
  SPACES_WINDOW_MIN_HEIGHT,
  SPACES_WINDOW_MIN_WIDTH,
} from "./spacesTabWindowArrangementModel";

type SpacesPresentation = "native-single" | "floating";
type ScopedGeometry = Record<string, Record<string, FloatingTerminalGeometry>>;
type ScopedOrder = Record<string, string[]>;
type LeaseScoped<T> = { leaseKey: string; scopes: T };

const PRESETS: readonly TerminalWindowArrangementPreset[] = [
  "single",
  "cascade",
  "columns",
  "rows",
  "grid",
];
const EMPTY_GEOMETRY: Readonly<Record<string, FloatingTerminalGeometry>> = {};
const EMPTY_ORDER: readonly string[] = [];

/** Adapts the shared geometry and snapshot rules to existing tabs in Spaces. */
export function useSpacesTabWindowArrangement(active: boolean): {
  arrangementControl: WindowArrangementControl;
  spacesTabWindows: { tabId: string; portal: Element | null }[];
  renderWindows: ReactNode;
  onFocusSpacesTabWindow: (tabId: string, paneId: string | null) => void;
  onSpacesWindowLayerReady: (element: HTMLDivElement | null) => void;
} {
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
  const leaseKey =
    snapshot.activeConnectionId && snapshot.serverRuntimeGeneration !== null
      ? JSON.stringify([
          snapshot.activeConnectionId,
          snapshot.serverRuntimeGeneration,
        ])
      : "";
  const [arrangements, setArrangements] = useState(() =>
    createTerminalWindowArrangementState<SpacesPresentation>(leaseKey),
  );
  const [free, setFree] = useState<LeaseScoped<ScopedGeometry>>(() => ({
    leaseKey,
    scopes: {},
  }));
  const [raised, setRaised] = useState<LeaseScoped<ScopedOrder>>(() => ({
    leaseKey,
    scopes: {},
  }));
  const [portals, setPortals] = useState<Record<string, HTMLDivElement | null>>(
    {},
  );
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
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

  useEffect(() => {
    setArrangements((current) =>
      terminalWindowArrangementForLease(current, leaseKey),
    );
    setFree((current) =>
      current.leaseKey === leaseKey ? current : { leaseKey, scopes: {} },
    );
    setRaised((current) =>
      current.leaseKey === leaseKey ? current : { leaseKey, scopes: {} },
    );
    setPortals({});
  }, [leaseKey]);

  useEffect(() => {
    const openByScope = new Map<string, string[]>();
    for (const tab of snapshot.tabs) {
      const key = `spaces:${tab.workspace_id}`;
      const ids = openByScope.get(key) ?? [];
      ids.push(tab.tab_id);
      openByScope.set(key, ids);
    }
    setArrangements((current) => {
      if (current.leaseKey !== leaseKey) return current;
      let next = current;
      for (const key of Object.keys(current.scopes)) {
        if (!key.startsWith("spaces:")) continue;
        next = retainTerminalWindowArrangementWindows(next, {
          leaseKey,
          scopeKey: key,
          openIds: openByScope.get(key) ?? [],
        });
      }
      return next;
    });
    setFree((current) => {
      if (current.leaseKey !== leaseKey) return current;
      let changed = false;
      const scopes: ScopedGeometry = {};
      for (const [key, scoped] of Object.entries(current.scopes)) {
        const open = new Set(openByScope.get(key) ?? []);
        scopes[key] = Object.fromEntries(
          Object.entries(scoped).filter(([id]) => open.has(id)),
        );
        if (Object.keys(scopes[key]!).length !== Object.keys(scoped).length) {
          changed = true;
        }
      }
      return changed ? { ...current, scopes } : current;
    });
    setRaised((current) => {
      if (current.leaseKey !== leaseKey) return current;
      let changed = false;
      const scopes: ScopedOrder = {};
      for (const [key, scoped] of Object.entries(current.scopes)) {
        const open = new Set(openByScope.get(key) ?? []);
        scopes[key] = scoped.filter((id) => open.has(id));
        if (scopes[key]!.length !== scoped.length) changed = true;
      }
      return changed ? { ...current, scopes } : current;
    });
  }, [leaseKey, snapshot.tabs]);

  const currentArrangements =
    arrangements.leaseKey === leaseKey
      ? arrangements
      : createTerminalWindowArrangementState<SpacesPresentation>(leaseKey);
  const scope = context
    ? (currentArrangements.scopes[context.scopeKey] ?? null)
    : null;
  const currentFree =
    free.leaseKey === leaseKey && context
      ? (free.scopes[context.scopeKey] ?? EMPTY_GEOMETRY)
      : EMPTY_GEOMETRY;
  const currentRaised =
    raised.leaseKey === leaseKey && context
      ? (raised.scopes[context.scopeKey] ?? EMPTY_ORDER)
      : EMPTY_ORDER;
  const orderedTabs = context
    ? orderedSpacesTabs(context.tabs, currentRaised, context.activeTabId)
    : [];
  const stageRect = { left: 0, top: 0, ...stage };
  const windowInputs: TerminalWindowArrangementWindow[] = orderedTabs.map(
    (tab) => ({
      id: tab.tab_id,
      minWidth: SPACES_WINDOW_MIN_WIDTH,
      minHeight: SPACES_WINDOW_MIN_HEIGHT,
      geometry:
        scope?.placements.find(({ id }) => id === tab.tab_id)?.geometry ??
        currentFree[tab.tab_id],
      titleHeight: 32,
    }),
  );
  const entries = useMemo(
    () =>
      active && context && layer
        ? spacesTabWindowEntries({
            scope,
            tabs: context.tabs,
            activeTabId: context.activeTabId,
            raisedIds: currentRaised,
            freeGeometry: currentFree,
            stage,
            compact: mobile,
          })
        : [],
    [active, context, layer, scope, currentRaised, currentFree, stage, mobile],
  );

  useEffect(() => {
    if (!context || entries.length === 0) return;
    const arranged = new Set(scope?.placements.map(({ id }) => id) ?? []);
    const missing = entries.filter(
      ({ tab }) => !arranged.has(tab.tab_id) && !currentFree[tab.tab_id],
    );
    if (missing.length === 0) return;
    setFree((current) => {
      if (current.leaseKey !== context.leaseKey) return current;
      const scoped = current.scopes[context.scopeKey] ?? {};
      return {
        ...current,
        scopes: {
          ...current.scopes,
          [context.scopeKey]: {
            ...scoped,
            ...Object.fromEntries(
              missing.map(({ tab, geometry }) => [tab.tab_id, geometry]),
            ),
          },
        },
      };
    });
  }, [context, entries, scope?.placements, currentFree]);

  const raiseSpacesTabWindow = (tabId: string) => {
    if (!active || !context?.tabs.some((tab) => tab.tab_id === tabId)) return;
    setRaised((current) => {
      const safe =
        current.leaseKey === context.leaseKey
          ? current
          : { leaseKey: context.leaseKey, scopes: {} };
      const order = safe.scopes[context.scopeKey] ?? [];
      if (order[order.length - 1] === tabId) return safe;
      return {
        ...safe,
        scopes: {
          ...safe.scopes,
          [context.scopeKey]: [...order.filter((id) => id !== tabId), tabId],
        },
      };
    });
  };
  const onFocusSpacesTabWindow = (tabId: string, paneId: string | null) => {
    if (!active || !context?.tabs.some((tab) => tab.tab_id === tabId)) return;
    raiseSpacesTabWindow(tabId);
    // App's pane callback already calls focusPane. Chrome focus has no pane.
    if (paneId === null && context.activeTabId !== tabId) {
      void store.focusTab(tabId);
    }
  };

  const onSelect = (command: WindowArrangementCommand) => {
    if (!active || !context || !layer || stage.width <= 0 || stage.height <= 0)
      return;
    if (command === "restore") {
      setArrangements(
        (current) =>
          restoreTerminalWindowArrangement(current, {
            leaseKey: context.leaseKey,
            scopeKey: context.scopeKey,
            openIds: context.tabs.map((tab) => tab.tab_id),
          }).state,
      );
      return;
    }
    if (mobile && command !== "single") return;
    const windows = windowInputs.map((window) => ({
      ...window,
      minWidth:
        command === "single"
          ? Math.min(window.minWidth, stage.width)
          : window.minWidth,
      minHeight:
        command === "single"
          ? Math.min(window.minHeight, stage.height)
          : window.minHeight,
      presentation: (currentFree[window.id]
        ? "floating"
        : "native-single") as SpacesPresentation,
    }));
    setArrangements(
      (current) =>
        applyTerminalWindowArrangement(current, {
          leaseKey: context.leaseKey,
          scopeKey: context.scopeKey,
          preset: command,
          stage: stageRect,
          windows,
          activeId: context.activeTabId,
          initialPreset: "single",
        }).state,
    );
  };

  const disabledReasons: WindowArrangementControl["disabledReasons"] = {};
  for (const preset of PRESETS) {
    if (!active || !context) {
      disabledReasons[preset] = "Choose a focused workspace with an open tab.";
    } else if (!layer || stage.width <= 0 || stage.height <= 0) {
      disabledReasons[preset] = "The terminal stage is not ready.";
    } else if (mobile && preset !== "single") {
      disabledReasons[preset] = "Available in desktop layout.";
    } else {
      const windows =
        preset === "single"
          ? windowInputs.map((window) => ({
              ...window,
              minWidth: Math.min(window.minWidth, stage.width),
              minHeight: Math.min(window.minHeight, stage.height),
            }))
          : windowInputs;
      const reason = terminalWindowArrangementReason(
        preset,
        stageRect,
        windows,
        context.activeTabId,
      );
      if (reason) disabledReasons[preset] = reason;
    }
  }
  if (!scope || Object.keys(scope.baselines).length === 0) {
    disabledReasons.restore = "No saved window positions.";
  }

  const onGeometryChange = (
    tabId: string,
    geometry: FloatingTerminalGeometry,
  ) => {
    if (!context) return;
    const bounded = clampSpacesTabWindowGeometry(geometry, stage);
    if (scope?.placements.some(({ id }) => id === tabId)) {
      setArrangements((current) =>
        updateTerminalWindowArrangementGeometry(current, {
          leaseKey: context.leaseKey,
          scopeKey: context.scopeKey,
          id: tabId,
          geometry: bounded,
        }),
      );
    } else {
      setFree((current) => {
        if (current.leaseKey !== context.leaseKey) return current;
        return {
          ...current,
          scopes: {
            ...current.scopes,
            [context.scopeKey]: {
              ...current.scopes[context.scopeKey],
              [tabId]: bounded,
            },
          },
        };
      });
    }
  };
  const portalKey = (tabId: string) =>
    JSON.stringify([leaseKey, context?.scopeKey, tabId]);
  const spacesTabWindows = entries.map(({ tab }) => ({
    tabId: tab.tab_id,
    portal: portals[portalKey(tab.tab_id)] ?? null,
  }));
  const renderWindows =
    active && layer && context
      ? createPortal(
          entries.map(({ tab, geometry, zIndex }) => (
            <SpacesTabWindow
              key={tab.tab_id}
              tabId={tab.tab_id}
              label={tab.label}
              active={tab.tab_id === context.activeTabId}
              geometry={geometry}
              stage={stage}
              zIndex={zIndex}
              onRaise={() => raiseSpacesTabWindow(tab.tab_id)}
              onFocus={() => onFocusSpacesTabWindow(tab.tab_id, null)}
              onClose={() => requestCloseTab(tab.tab_id)}
              onGeometryChange={(next) => onGeometryChange(tab.tab_id, next)}
              onPortalChange={(element) => {
                const key = portalKey(tab.tab_id);
                setPortals((current) => {
                  if (current[key] === element) return current;
                  if (element) return { ...current, [key]: element };
                  const next = { ...current };
                  delete next[key];
                  return next;
                });
              }}
            />
          )),
          layer,
          context.scopeKey,
        )
      : null;

  return {
    arrangementControl: {
      activePreset: mobile ? "single" : (scope?.preset ?? "single"),
      disabledReasons,
      onSelect,
    },
    spacesTabWindows,
    renderWindows,
    onFocusSpacesTabWindow,
    onSpacesWindowLayerReady,
  };
}
