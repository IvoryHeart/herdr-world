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
import { View } from "lucide-react";
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
  initialView,
} from "./worldViewRouting";
import {
  dispatchWorldInspectorRequest,
  focusWorldNode,
  activateWorldNodeHost,
} from "./worldInspectorSelection";
import { WorldControlPlane } from "./WorldControlPlane";
import { EMPTY_VISUAL_ACTION_EXTENSION } from "./worldControlPlaneContract";

export const OfficeObservabilityDialog = lazyWithReload(
  "world-observability",
  () =>
    import("./PixelOfficeView").then((module) => ({
      default: module.OfficeObservabilityDialog,
    })),
);

export default function WorldFoundationApp() {
  const [view, setViewState] = useState<WorldView>(initialView);
  const creationIntentRevision = useRef(0);
  const spaces = useSpacesTabWindowArrangement(view === "spaces");
  const [visualView, setVisualView] = useState<Exclude<WorldView, "spaces">>(
    () => {
      const initial = initialView();
      return initial === "spaces" ? "office" : initial;
    },
  );
  const [topbarPortal, setTopbarPortal] = useState<HTMLElement | null>(null);
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
    const lease =
      conversationStatus === "connected"
        ? conversationConnections
            .filter((connection) => connection.state === "ready")
            .map((connection) => ({
              connectionId: connection.id,
              runtimeGeneration: connection.generation,
            }))
        : [];
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
  }, [conversationConnections, conversationStatus, inspectorConversations]);

  useEffect(() => {
    worldRuntimeStore.start();
    return () => worldRuntimeStore.stop();
  }, []);

  useEffect(() => {
    const open = () => setOfficeMetricsOpen(true);
    window.addEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
    return () =>
      window.removeEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/") {
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

  const setView = (next: WorldView) => {
    setViewState(next);
    if (next !== "spaces") setVisualView(next);
    if (window.location.pathname !== WORLD_VIEW_PATHS[next]) {
      const url = new URL(window.location.href);
      url.pathname = WORLD_VIEW_PATHS[next];
      window.history.pushState(window.history.state, "", url);
    }
    if (next === "spaces") {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
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
    <div className="world-foundation-shell">
      <div className="world-topbar-host" ref={setTopbarPortal} />
      <div className="world-spaces-layer is-active">
        <App
          operationalShortcutsEnabled={view === "spaces"}
          shellActionsEnabled
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
                  onChange={(event) => setView(event.target.value as WorldView)}
                >
                  {WORLD_VIEWS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate[0].toUpperCase() + candidate.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
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
export { shouldCloseWorldInspector } from "./worldInspectorSelection";
export { dispatchWorldInspectorRequest } from "./worldInspectorSelection";
export { focusWorldNode } from "./worldInspectorSelection";
export { activateWorldNodeHost } from "./worldInspectorSelection";
export { reconcileObservedInspectors } from "./worldInspectorSelection";

export {
  retainWorldFloatingTerminals,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";
