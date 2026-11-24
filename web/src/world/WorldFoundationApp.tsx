import { useAssistantShow } from "./useAssistantShow";
import { useWorldAsks } from "./worldAsks";
import "./world.css";
import "./windows/WorldLayout.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { store, useStoreSelector } from "../store";
import {
  type InspectorView,
  resourceScopeForWorkspace,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  writeInspectorPreferences,
} from "../workspaceResource";
import { coreAuthorityFrom, provideFloatShellAuthority } from "./floatShell";
import { useWorldRuntime, worldRuntimeStore } from "./runtimeStore";
import {
  buildWorldObject,
  type WorldLeafObject,
  type WorldObject,
} from "./worldObject";
import { worldObjectForHosts } from "./worldFilters";
import { useHostsFilter } from "./hostsFilter";
import { HostsControl, selectedHostCount } from "./HostsControl";
import { worldHosts } from "../worldHosts";
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
import { HelpPanelHost } from "../help/HelpPanelHost";
import { applyWhatsNewSwitch } from "../help/greetingNews";
import {
  openWorldFind,
  withWorldViews,
  worldFindGroup,
  worldLeafColorTarget,
} from "./worldCommandBox";
import { useTerminalColors } from "./useTerminalColors";
import { terminalColor } from "./terminalColor";
import { NeedsYouCounter } from "./NeedsYouTab";
import { needsYouInTopbar } from "./needsYou";
import { WorldControlPlane } from "./WorldControlPlane";
import { SpacesCoreTerminal } from "./SpacesCoreTerminal";
import { spacesCoreChoice, type SpacesCoreChoice } from "./spacesCore";
import { coreSpacesLeaf } from "./worldCommandBox";
import {
  WorldPanelsContext,
  useWorldPanelRegistry,
} from "./windows/WorldPanel";
import { EMPTY_VISUAL_ACTION_EXTENSION } from "./worldControlPlaneContract";

export default function WorldFoundationApp() {
  useWorldAsks();
  const [view, setViewState] = useState<WorldView>(initialView);
  // The `?whatsNewSince=` testing switch leaves the address before anything
  // reads it (help/whatsNew.ts).
  useState(applyWhatsNewSwitch);
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
  const [topbarToolbarHost, setTopbarToolbarHost] =
    useState<HTMLDivElement | null>(null);
  const [zenToolbarHost, setZenToolbarHost] = useState<HTMLDivElement | null>(
    null,
  );
  // Zen, World's default, parks the topbar off screen, so the view's search
  // moves into the Zen dock while Zen is on.
  const viewToolbarPortal =
    zenActive && zenToolbarHost ? zenToolbarHost : topbarToolbarHost;
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
  // The herdr-core terminal Spaces shows in place of a Herdr tab (#1329).
  // Each open is a new choice, so a phone comes back to it from the list.
  const [spacesCore, setSpacesCore] = useState<
    (SpacesCoreChoice & { opened: number }) | null
  >(null);
  const spacesCoreOpens = useRef(0);
  // Each terminal World opens in Spaces asks App to show it over whatever
  // Inspector covered it (#1329), for every runtime alike.
  const [terminalReveals, setTerminalReveals] = useState(0);
  const revealSpacesTerminal = () => setTerminalReveals((count) => count + 1);
  const showCoreInSpaces = (leaf: WorldLeafObject) => {
    setSpacesCore({
      ...spacesCoreChoice(leaf),
      opened: ++spacesCoreOpens.current,
    });
    revealSpacesTerminal();
  };
  const [inspectorTerminalPortals, setInspectorTerminalPortals] = useState<
    Record<string, HTMLDivElement | null>
  >({});
  const workspaceSurfaceSelectionRef = useRef<
    ((selection: WorkspaceSurfaceSelection) => Promise<boolean>) | null
  >(null);
  useAssistantShow(workspaceSurfaceSelectionRef);
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
  const hosts = useStoreSelector(worldHosts);
  const catalogueReady = useStoreSelector(
    (snapshot) => snapshot.catalogueReady,
  );
  const hostsFilter = useHostsFilter(hosts, catalogueReady);
  // Every connected host's World; the finds search it whatever Hosts shows.
  const fullWorld = useMemo(
    () => buildWorldObject(topbarRuntime.connections, topbarConnectionId),
    [topbarConnectionId, topbarRuntime.connections],
  );
  const topbarWorld = useMemo(
    () => worldObjectForHosts(fullWorld, hostsFilter.ids),
    [fullWorld, hostsFilter.ids],
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
    // Windows of every current host stay, a herdr-core host's included.
    const lease = hosts.map((host) => ({
      connectionId: host.id,
      runtimeGeneration: host.generation,
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
  }, [catalogueReady, hosts, conversationStatus, inspectorConversations]);

  useEffect(() => {
    // The shell and views present the focused host's variant of the World.
    worldRuntimeStore.presentSelectionFrom(
      () => store.get().activeConnectionId,
    );
    worldRuntimeStore.start();
    // Open again in a core float shell takes authority from this read model.
    const offFloat = provideFloatShellAuthority(
      coreAuthorityFrom(worldRuntimeStore),
    );
    return () => {
      offFloat();
      worldRuntimeStore.stop();
    };
  }, []);

  // The view on <html> too, for surfaces portaled to <body> (the phone's
  // Needs you sheet). `body:has(.world-foundation-shell[data-view])` would
  // restyle the page on every DOM change, typing included (#1231).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-world-view", view);
    return () => root.removeAttribute("data-world-view");
  }, [view]);

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

  // World's finds (#1329): one search of the whole World object, in every
  // view, on every connected host whatever the Hosts filter shows. Enter opens
  // what was found in Spaces, whichever runtime runs it; in a visual view the
  // second action shows it there, as clicking it does, when the view shows
  // its host.
  const terminalColors = useTerminalColors();
  // Only the views that draw World's nodes can show one; Code and Spaces can't.
  const showNode =
    view === "town" || view === "board" || view === "desk"
      ? visualActionExtension.showNode
      : undefined;
  const worldFind = (search: string) =>
    worldFindGroup(fullWorld, search, {
      open: (node) =>
        void openWorldFind(node, {
          activateSpacesTarget: async (target) => {
            const opened = await store.activateQualifiedSpacesTarget(target);
            if (opened) setSpacesCore(null);
            return opened;
          },
          activateHost: async (host) => {
            await activateWorldNodeHost(host);
            setSpacesCore(null);
          },
          openCoreInSpaces: (leaf) => {
            showCoreInSpaces(leaf);
            return true;
          },
          goToSpaces: () => {
            setView("spaces");
            revealSpacesTerminal();
          },
          notify: (message, detail) =>
            store.notify({ kind: "error", message, detail }),
        }),
      ...(showNode
        ? {
            show: {
              label: `Show in ${worldViewLabel(view)}`,
              shows: (node) => topbarWorld.nodeById.has(node.id),
              run: (node) => showNode(node.id),
            },
          }
        : {}),
      colorOf: (leaf) =>
        terminalColor(terminalColors, worldLeafColorTarget(fullWorld, leaf)),
    });

  // Panel windows (Town's summary and the like) beside the Inspectors.
  const panelRegistry = useWorldPanelRegistry();
  const canReturnToView =
    mobile &&
    view !== "spaces" &&
    inspectorConversations.length > 0 &&
    visualArrangementControl &&
    !visualArrangementControl.disabledReasons["close-all"];
  const showNeedsYouCounter = needsYouInTopbar({
    view,
    mobile,
    zen: zenActive,
    detail: Boolean(canReturnToView),
  });
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

  const hostsControl = {
    connections: hosts,
    ids: hostsFilter.ids,
    explanation: hostsFilter.explanation,
    onChange: hostsFilter.setIds,
  };
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
              // The topbar's Hosts filter, one tap away in the phone's corner.
              hosts={hostsControl}
              extra={
                view === "spaces" ? null : (
                  <NeedsYouCounter world={topbarWorld} />
                )
              }
              // A phone's corner holds Town's search only, clear of the
              // other views' floating controls.
              search={
                view === "spaces" || (mobile && view !== "town") ? null : (
                  <div
                    className="world-view-toolbar-host"
                    ref={setZenToolbarHost}
                  />
                )
              }
            />
          )}
          onZenActiveChange={setZenActive}
          topbarPortal={topbarPortal}
          visualActionExtension={withWorldViews(
            { ...visualActionExtension, find: worldFind },
            view,
            setView,
          )}
          connectionControl={<HostsControl {...hostsControl} />}
          workspaceNavigator={(onSelectionAdmitted) => (
            <WorldNavigator
              world={topbarWorld}
              onSelect={async (node, requestedView) => {
                if (node.kind === "host") return;
                if (view === "spaces") {
                  // A live herdr-core terminal shows in Spaces as Cmd+K's
                  // Enter shows it (#1329); a Herdr one leaves it.
                  const coreLeaf = requestedView
                    ? undefined
                    : coreSpacesLeaf(node);
                  if (coreLeaf) {
                    showCoreInSpaces(coreLeaf);
                    onSelectionAdmitted();
                    return;
                  }
                  if (!node.coreControl) setSpacesCore(null);
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
              {!mobile && showNeedsYouCounter ? (
                <NeedsYouCounter world={topbarWorld} />
              ) : null}
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
                <>
                  <h1 className="world-mobile-title">{worldViewLabel(view)}</h1>
                  {/* A phone's counter follows the view's name, compact. */}
                  {showNeedsYouCounter ? (
                    <NeedsYouCounter world={topbarWorld} compact />
                  ) : null}
                </>
              ) : null}
              {view !== "spaces" ? (
                <>
                  <WorldTopbarStatus
                    runtime={topbarRuntime}
                    world={presentedStatusWorld ?? topbarWorld}
                    selectedHostLabel={
                      hostsFilter.ids === null
                        ? "All hosts"
                        : `${selectedHostCount(hosts, hostsFilter.ids)} selected hosts`
                    }
                  />
                  <div
                    className="world-view-toolbar-host"
                    ref={setTopbarToolbarHost}
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
                onGoToTown={() => setView("town")}
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
          spacesSurface={
            view === "spaces" && spacesCore
              ? {
                  key: String(spacesCore.opened),
                  content: (
                    <SpacesCoreTerminal
                      world={fullWorld}
                      choice={spacesCore}
                      onClose={() => setSpacesCore(null)}
                    />
                  ),
                }
              : null
          }
          revealTerminal={terminalReveals}
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
      <HelpPanelHost view={view} mobile={mobile} onView={setView} />
      {mobile && view !== "spaces" && !canReturnToView && !zenActive ? (
        <WorldMobileNav view={view} onSelect={setView} />
      ) : null}
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
