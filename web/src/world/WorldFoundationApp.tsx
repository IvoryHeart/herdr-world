import { useWorldAsks } from "./worldAsks";
import "./world.css";
import "./windows/WorldLayout.css";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, View } from "lucide-react";
import { useLayoutPreferences } from "../layoutPreferences";
import App, { type WorkspaceSurfaceSelection } from "../App";
import { worldLocalStorage } from "../browserStorage";
import {
  WINDOW_ARRANGEMENT_CHOICES,
  type WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import type { CommandExtension } from "../components/CommandCombobox";
import { shortcutMatches } from "../shortcutPreferences";
import { lazyWithReload } from "../lazyWithReload";
import { store, useStoreSelector } from "../store";
import {
  type InspectorView,
  resourceScopeForWorkspace,
  WORLD_OBSERVABILITY_SETTINGS_EVENT,
  WORLD_OBSERVABILITY_UPDATED_EVENT,
  WORLD_SOURCES_SETTINGS_EVENT,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  writeInspectorPreferences,
} from "../workspaceResource";
import { useWorldRuntime, worldRuntimeStore } from "./runtimeStore";
import {
  buildWorldObject,
  type WorldObject,
  worldObjectForHosts,
} from "./worldObject";
import { useHostsFilter } from "./hostsFilter";
import { HostsControl } from "./HostsControl";
import { WorldNavigator } from "./WorldNavigator";
import { useSpacesTabWindowArrangement } from "./useSpacesTabWindowArrangement";
import { WorldTopbarStatus } from "./WorldStatus";
import {
  retainWorldInspectorConversations,
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";
import {
  type WorldView,
  WORLD_VIEWS,
  WORLD_VIEW_PATHS,
  worldViewFromPath,
  worldPathNeedsCanonical,
  initialView,
  parseWorldView,
} from "./worldViewRouting";
import {
  dispatchWorldInspectorRequest,
  focusWorldNode,
  activateWorldNodeHost,
} from "./worldInspectorSelection";
import {
  isBackPending,
  pushRoute,
  stepBack,
  useSystemBack,
} from "../systemBack";
import { closeTopLayer } from "../layerStack";
import "./worldFonts.css";
import { WorldMobileNav, worldViewLabel } from "./WorldMobileNav";
import { WorldViewPicker } from "./WorldViewPicker";
import { NeedsYouCounter } from "./NeedsYouWindow";
import { WorldControlPlane } from "./WorldControlPlane";
import {
  WorldPanelsContext,
  useWorldPanelRegistry,
} from "./windows/WorldPanel";
import { EMPTY_VISUAL_ACTION_EXTENSION } from "./worldControlPlaneContract";

export const OfficeObservabilityDialog = lazyWithReload(
  "world-observability",
  () =>
    import("./OfficeObservabilityDialog").then((module) => ({
      default: module.OfficeObservabilityDialog,
    })),
);

export const SourcesDialog = lazyWithReload("world-sources", () =>
  import("./SourcesDialog").then((module) => ({
    default: module.SourcesDialog,
  })),
);

export default function WorldFoundationApp() {
  useWorldAsks();
  const [view, setViewState] = useState<WorldView>(initialView);
  const { mobile } = useLayoutPreferences();
  const creationIntentRevision = useRef(0);
  const spaces = useSpacesTabWindowArrangement(view === "spaces");
  const [visualView, setVisualView] = useState<Exclude<WorldView, "spaces">>(
    () => {
      const initial = initialView();
      return initial === "spaces" ? "town" : initial;
    },
  );
  const [topbarPortal, setTopbarPortal] = useState<HTMLElement | null>(null);
  const [zenActive, setZenActive] = useState(false);
  const [viewToolbarPortal, setViewToolbarPortal] =
    useState<HTMLDivElement | null>(null);
  const [visualActionExtension, setVisualActionExtension] =
    useState<CommandExtension>(EMPTY_VISUAL_ACTION_EXTENSION);
  const [visualArrangementControl, setVisualArrangementControl] = useState<
    WindowArrangementControl | undefined
  >();
  const [inspectorConversations, setInspectorConversations] = useState<
    WorldInspectorConversation[]
  >([]);
  const [activeInspectorWindowId, setActiveInspectorWindowId] = useState<
    string | null
  >(null);
  const [dockedInspectorId, setDockedInspectorId] = useState<string | null>(
    null,
  );
  const [inspectorTerminalPortals, setInspectorTerminalPortals] = useState<
    Record<string, HTMLDivElement | null>
  >({});
  const [officeMetricsOpen, setOfficeMetricsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const workspaceSurfaceSelectionRef = useRef<
    ((selection: WorkspaceSurfaceSelection) => Promise<boolean>) | null
  >(null);
  const inspectorPaneFocusRef = useRef<
    ((windowId: string, paneId: string) => void) | null
  >(null);
  const registerWorkspaceSurfaceSelection = useCallback(
    (
      handler:
        | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
        | null,
    ) => {
      workspaceSurfaceSelectionRef.current = handler;
    },
    [],
  );
  const topbarRuntime = useWorldRuntime();
  const [presentedStatusWorld, setPresentedStatusWorld] =
    useState<WorldObject | null>(null);
  const topbarConnectionId = useStoreSelector(
    (snapshot) => snapshot.activeConnectionId,
  );
  const conversationConnections = useStoreSelector(
    (snapshot) => snapshot.connections,
  );
  const catalogueReady = useStoreSelector(
    (snapshot) => snapshot.catalogueReady,
  );
  const hostsFilter = useHostsFilter(
    conversationConnections.map((connection) => connection.id),
    catalogueReady,
  );
  const topbarWorld = useMemo(
    () =>
      worldObjectForHosts(
        buildWorldObject(topbarRuntime.connections, topbarConnectionId),
        hostsFilter.ids,
      ),
    [topbarConnectionId, topbarRuntime.connections, hostsFilter.ids],
  );
  const conversationStatus = useStoreSelector((snapshot) => snapshot.status);
  const workspaceSurfaceInspectorConversation = inspectorConversations.find(
    (conversation) =>
      worldInspectorWindowId(conversation) === activeInspectorWindowId,
  );
  const changeWorkspaceSurfaceInspectorView = useCallback(
    (nextView: InspectorView) => {
      const conversation = workspaceSurfaceInspectorConversation;
      if (!conversation?.availableViews.includes(nextView)) return;
      creationIntentRevision.current++;
      setInspectorConversations((current) =>
        current.map((candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation)
            ? { ...candidate, view: nextView }
            : candidate,
        ),
      );
      const workspace = store
        .getConnection(conversation.connectionId)
        .workspaces.find(
          (candidate) => candidate.workspace_id === conversation.workspaceId,
        );
      if (!workspace) return;
      writeInspectorPreferences(worldLocalStorage, {
        scope: resourceScopeForWorkspace(conversation.connectionId, workspace),
        open: true,
        view: nextView,
        availableViews: conversation.availableViews,
        dock: conversation.dock,
        size: conversation.size,
        expanded: conversation.expanded,
        ...(conversation.paneId ? { originPaneId: conversation.paneId } : {}),
      });
    },
    [workspaceSurfaceInspectorConversation],
  );

  useLayoutEffect(() => {
    if (conversationStatus !== "connected" || !catalogueReady) return;
    const lease = conversationConnections.map((connection) => ({
      connectionId: connection.id,
      runtimeGeneration: connection.generation,
    }));
    const retained = retainWorldInspectorConversations(
      inspectorConversations,
      lease,
    );
    if (retained.length === inspectorConversations.length) return;
    const retainedIds = new Set(retained.map(worldInspectorWindowId));
    setInspectorConversations(retained);
    setDockedInspectorId((current) =>
      current && retainedIds.has(current) ? current : null,
    );
    setInspectorTerminalPortals((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => retainedIds.has(nodeId)),
      ),
    );
  }, [
    catalogueReady,
    conversationConnections,
    conversationStatus,
    inspectorConversations,
  ]);

  useEffect(() => {
    worldRuntimeStore.start();
    return () => worldRuntimeStore.stop();
  }, []);

  useEffect(() => {
    const open = () => setSourcesOpen(true);
    window.addEventListener(WORLD_SOURCES_SETTINGS_EVENT, open);
    return () => window.removeEventListener(WORLD_SOURCES_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    const open = () => setOfficeMetricsOpen(true);
    window.addEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
    return () =>
      window.removeEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    // The root, retired views (/office, /graph, /tree) and unknown paths
    // show their view's canonical address; Back does not return to them.
    if (worldPathNeedsCanonical(window.location.pathname)) {
      const url = new URL(window.location.href);
      url.pathname = WORLD_VIEW_PATHS[view];
      window.history.replaceState(window.history.state, "", url);
    }
    const onPopState = () => {
      const next = worldViewFromPath(window.location.pathname);
      setViewState(next);
      if (next !== "spaces") setVisualView(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);

  const setView = (next: WorldView, replace = false) => {
    setViewState(next);
    if (next !== "spaces") setVisualView(next);
    // While our own Back traverses, the location is stale: always record the
    // route so the traversal cannot land on another view.
    if (
      window.location.pathname !== WORLD_VIEW_PATHS[next] ||
      (!replace && isBackPending())
    ) {
      const url = new URL(window.location.href);
      url.pathname = WORLD_VIEW_PATHS[next];
      // Records the route it came from, so an on-screen Back can return
      // through history instead of adding the route again.
      const state = { herdrFrom: window.location.pathname };
      if (replace) window.history.replaceState({}, "", url);
      else pushRoute(state, url);
    }
    if (next === "spaces") {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  };

  // Panel windows (Town's summary and the like) beside the Inspectors.
  const panelRegistry = useWorldPanelRegistry();
  const canReturnToView =
    mobile &&
    view !== "spaces" &&
    inspectorConversations.length > 0 &&
    visualArrangementControl &&
    !visualArrangementControl.disabledReasons["close-all"];
  const returnLabel = `Back to ${view[0].toUpperCase()}${view.slice(1)}`;
  // The phone's Back gesture leaves a terminal for the scene, like the button.
  useSystemBack(
    Boolean(canReturnToView),
    () => {
      creationIntentRevision.current++;
      visualArrangementControl?.onSelect("close-all");
    },
    "screen",
  );
  // Spaces' Back first closes an open menu or sheet, like the phone's Back.
  // Then it undoes the in-app navigation that opened Spaces, so the next
  // system Back does not reopen it. Opened directly, it replaces itself.
  const leaveSpaces = () => {
    // A Back already traversing takes this press; a second would leave.
    if (isBackPending() || closeTopLayer() || stepBack()) return;
    const from = (window.history.state as { herdrFrom?: unknown } | null)
      ?.herdrFrom;
    if (from === WORLD_VIEW_PATHS[visualView]) window.history.back();
    else setView(visualView, true);
  };
  const activeArrangementControl =
    view === "spaces" ? spaces.arrangementControl : visualArrangementControl;
  useEffect(() => {
    if (!activeArrangementControl) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector(
          '.modal-backdrop, .command-popover, .context-menu, .pane-jump-backdrop, [role="menu"]',
        )
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !target.closest(".xterm") &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      const choice = WINDOW_ARRANGEMENT_CHOICES.find(({ shortcutId }) =>
        shortcutId ? shortcutMatches(event, shortcutId) : false,
      );
      if (!choice) return;
      event.preventDefault();
      event.stopPropagation();
      if (!activeArrangementControl.disabledReasons[choice.command])
        activeArrangementControl.onSelect(choice.command);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeArrangementControl]);

  return (
    <div
      className="world-foundation-shell"
      data-view={view}
      data-zen={zenActive ? "" : undefined}
    >
      <div className="world-topbar-host" ref={setTopbarPortal} />
      <div className="world-spaces-layer is-active">
        <App
          operationalShortcutsEnabled={view === "spaces"}
          shellActionsEnabled
          // On a phone an open agent window's own bar replaces the topbar:
          // one bar, with Back, the views and the window's actions.
          topbarHidden={Boolean(canReturnToView)}
          // Every World view opens full-bleed: Zen with the floating view
          // picker is the default, one choice for all views, kept apart from
          // the shell's own Zen setting. On a phone, Zen covers every root
          // screen, Spaces' list included; a terminal is a detail screen and
          // keeps its own bar, with Back.
          zenScope="world"
          zenDefault
          zenOnMobile={mobile && view !== "spaces" && !canReturnToView}
          zenOnMobileList={view === "spaces"}
          renderZenControl={(exitZen) => (
            <WorldViewPicker
              view={view}
              mobile={mobile}
              onSelect={setView}
              onExitZen={exitZen}
              extra={
                view === "spaces" ? null : (
                  <NeedsYouCounter world={topbarWorld} />
                )
              }
            />
          )}
          onZenActiveChange={setZenActive}
          topbarPortal={topbarPortal}
          visualActionExtension={visualActionExtension}
          connectionControl={
            <HostsControl
              connections={conversationConnections}
              ids={hostsFilter.ids}
              explanation={hostsFilter.explanation}
              onChange={hostsFilter.setIds}
            />
          }
          workspaceNavigator={(onSelectionAdmitted) => (
            <WorldNavigator
              world={topbarWorld}
              onSelect={async (node, requestedView) => {
                if (node.kind === "host") return;
                if (view === "spaces") {
                  if (store.get().activeConnectionId !== node.connectionId)
                    await activateWorldNodeHost(node);
                  const resourceView =
                    requestedView ?? (node.kind === "space" ? "files" : null);
                  if (resourceView)
                    await dispatchWorldInspectorRequest(
                      node,
                      resourceView,
                      store,
                      window,
                      () => {
                        if (
                          store.get().activeConnectionId !== node.connectionId
                        )
                          throw new Error(
                            "The selected host changed while it was opening",
                          );
                      },
                    );
                  else {
                    window.dispatchEvent(
                      new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT),
                    );
                    await focusWorldNode(node);
                    if (store.get().activeConnectionId !== node.connectionId)
                      throw new Error(
                        "The selected host changed while it was opening",
                      );
                    onSelectionAdmitted();
                  }
                  return;
                }
                const admitted = await workspaceSurfaceSelectionRef.current?.({
                  connectionId: node.connectionId,
                  runtimeGeneration: node.generation,
                  view: requestedView,
                  workspaceId:
                    node.kind === "space" ? node.nativeId : node.workspaceId,
                  ...(node.kind === "space" ? {} : { paneId: node.nativeId }),
                });
                if (admitted) onSelectionAdmitted();
              }}
            />
          )}
          primaryViewControl={
            <div className="world-topbar-control-plane">
              <label
                className="world-primary-view-select"
                title={`World view: ${view}`}
              >
                <View
                  className="world-primary-view-icon"
                  size={18}
                  aria-hidden="true"
                />
                <select
                  aria-label="World view"
                  value={view}
                  onChange={(event) =>
                    setView(parseWorldView(event.target.value))
                  }
                >
                  {WORLD_VIEWS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate[0].toUpperCase() + candidate.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              {/* A phone's top bar is a detail screen's; its counter sits
                  beside the views instead. */}
              {view === "spaces" || mobile ? null : (
                <NeedsYouCounter world={topbarWorld} />
              )}
              {canReturnToView ? (
                <button
                  type="button"
                  className="world-back-to-view"
                  title={returnLabel}
                  aria-label={returnLabel}
                  data-layer-back
                  onClick={() => {
                    // An open menu or list above the terminal closes first;
                    // a Back already traversing takes this press.
                    if (isBackPending() || closeTopLayer()) return;
                    // Then the on-screen Back returns to the view at once,
                    // Composer or not; the phone's Back closes the Composer
                    // first.
                    creationIntentRevision.current++;
                    visualArrangementControl?.onSelect("close-all");
                  }}
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
              ) : mobile && view === "spaces" ? (
                <button
                  type="button"
                  className="world-back-to-view"
                  title={`Back to ${worldViewLabel(visualView)}`}
                  aria-label={`Back to ${worldViewLabel(visualView)}`}
                  data-layer-back
                  onClick={leaveSpaces}
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
              ) : mobile ? (
                <h1 className="world-mobile-title">{worldViewLabel(view)}</h1>
              ) : null}
              {view !== "spaces" ? (
                <>
                  <WorldTopbarStatus
                    runtime={topbarRuntime}
                    world={presentedStatusWorld ?? topbarWorld}
                    selectedHostLabel={
                      hostsFilter.ids === null
                        ? "All hosts"
                        : `${hostsFilter.ids.length} selected hosts`
                    }
                  />
                  <div
                    className="world-view-toolbar-host"
                    ref={setViewToolbarPortal}
                  />
                </>
              ) : null}
            </div>
          }
          workspaceSurface={
            <WorldPanelsContext.Provider value={panelRegistry}>
              <WorldControlPlane
                view={visualView}
                active={view !== "spaces"}
                creationIntentRevision={creationIntentRevision}
                inspectorConversations={inspectorConversations}
                dockedInspectorId={dockedInspectorId}
                onDockedInspectorIdChange={setDockedInspectorId}
                onInspectorConversationsChange={setInspectorConversations}
                onInspectorTerminalPortal={(windowId, portal) =>
                  setInspectorTerminalPortals((current) =>
                    current[windowId] === portal
                      ? current
                      : { ...current, [windowId]: portal },
                  )
                }
                onWorkspaceSurfaceSelectionReady={
                  registerWorkspaceSurfaceSelection
                }
                onInspectorPaneFocusReady={(handler) => {
                  inspectorPaneFocusRef.current = handler;
                }}
                onActiveInspectorChange={setActiveInspectorWindowId}
                onVisualArrangementControlReady={setVisualArrangementControl}
                onVisualActionExtensionReady={setVisualActionExtension}
                viewToolbarPortal={viewToolbarPortal}
                onGoToSpaces={() => setView("spaces")}
                onPresentedWorldChange={setPresentedStatusWorld}
              />
            </WorldPanelsContext.Provider>
          }
          workspaceSurfaceVisible={view !== "spaces"}
          workspaceSurfaceContext={
            view !== "spaces" ? visualActionExtension?.context : null
          }
          arrangementControl={activeArrangementControl}
          spacesTabWindows={spaces.spacesTabWindows}
          onFocusSpacesTabWindow={spaces.onFocusSpacesTabWindow}
          spacesWindowsSuspended={spaces.suspended}
          presentedSpacesTabId={
            view === "spaces" ? spaces.presentedTabId : undefined
          }
          onSelectSpacesTab={spaces.resumeTab}
          onSpacesWindowLayerReady={spaces.onSpacesWindowLayerReady}
          workspaceSurfaceInspector={
            view !== "spaces" && workspaceSurfaceInspectorConversation
              ? {
                  view: workspaceSurfaceInspectorConversation.view,
                  availableViews:
                    workspaceSurfaceInspectorConversation.availableViews,
                  onViewChange: changeWorkspaceSurfaceInspectorView,
                }
              : null
          }
          onWorkspaceSurfaceSelect={
            view !== "spaces"
              ? (selection) =>
                  workspaceSurfaceSelectionRef.current?.(selection) ??
                  Promise.resolve(false)
              : undefined
          }
          worldTerminalPresentations={
            view === "spaces"
              ? []
              : inspectorConversations.flatMap((conversation) =>
                  conversation.tabId &&
                  conversation.paneId &&
                  conversation.terminalId
                    ? [
                        {
                          ...conversation,
                          tabId: conversation.tabId,
                          paneId: conversation.paneId,
                          terminalId: conversation.terminalId,
                          portal:
                            inspectorTerminalPortals[
                              worldInspectorWindowId(conversation)
                            ] ?? null,
                          onFocusPane: (paneId: string) =>
                            inspectorPaneFocusRef.current?.(
                              worldInspectorWindowId(conversation),
                              paneId,
                            ),
                        },
                      ]
                    : [],
                )
          }
        />
        {spaces.renderWindows}
      </div>
      {mobile && view !== "spaces" && !canReturnToView && !zenActive ? (
        <WorldMobileNav view={view} onSelect={setView} />
      ) : null}
      {sourcesOpen
        ? createPortal(
            <Suspense fallback={null}>
              <SourcesDialog onClose={() => setSourcesOpen(false)} />
            </Suspense>,
            document.body,
          )
        : null}
      {officeMetricsOpen
        ? createPortal(
            <Suspense fallback={null}>
              <OfficeObservabilityDialog
                onClose={() => setOfficeMetricsOpen(false)}
                onSaved={() =>
                  window.dispatchEvent(
                    new Event(WORLD_OBSERVABILITY_UPDATED_EVENT),
                  )
                }
              />
            </Suspense>,
            document.body,
          )
        : null}
    </div>
  );
}

export type { WorldView } from "./worldViewRouting";
export { parseWorldView } from "./worldViewRouting";
export { worldViewFromPath } from "./worldViewRouting";
export { visualGridArrangementStage } from "./worldInspectorGeometry";
export { visualInspectorTerminalActive } from "./worldInspectorGeometry";
export { visualInspectorArrangementStage } from "./worldInspectorGeometry";
export { fitVisualInspectorArrangementGeometry } from "./worldInspectorGeometry";
export { moveDockedInspectorGeometry } from "./worldInspectorGeometry";
export { shouldRecordVisualInspectorGeometry } from "./worldInspectorGeometry";
export { worldSelectionIsCurrent } from "./worldInspectorSelection";
export { worldNodeForWorkspaceSurfaceSelection } from "./worldInspectorSelection";
export { worldNodeForInspectorConversation } from "./worldInspectorSelection";
export { worldNodeForInspectorPaneFocus } from "./worldInspectorSelection";
export { worldIntentViews } from "./worldInspectorSelection";
export { worldInspectorContext } from "./worldInspectorSelection";
export { worldIntentInitialView } from "./worldInspectorSelection";
export { worldSnapshotPriorityForNode } from "./worldInspectorSelection";
export { hasValidSelectedConnection } from "./worldInspectorSelection";
export { chooseWorldSelectedConnection } from "./worldInspectorSelection";
export { selectedHostStatusLabel } from "./worldInspectorSelection";
export { dispatchWorldInspectorRequest } from "./worldInspectorSelection";
export { focusWorldNode } from "./worldInspectorSelection";
export { activateWorldNodeHost } from "./worldInspectorSelection";
export { reconcileObservedInspectors } from "./worldInspectorSelection";

export {
  retainWorldFloatingTerminals,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";
