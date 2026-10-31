import { Suspense, useEffect, useState } from "react";
import { worldLocalStorage } from "../browserStorage";
import { useChimeHost, WORLD_SOUNDS_EVENT } from "../chimes/chimeHost";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { ConfirmDialog } from "../components/ModalDialogs";
import { lazyWithReload } from "../lazyWithReload";
import { connectionSnapshot, store } from "../store";
import { WORKSPACE_INSPECTOR_CLOSE_EVENT } from "../workspaceResource";
import {
  type LaunchTarget,
  useAgentProfiles,
  WORLD_AGENT_LAUNCH_EVENT,
  WORLD_AGENT_PROFILES_EVENT,
} from "./agentProfiles";
import { DeskView } from "./DeskView";
import { GroupsWindow } from "./groups/GroupsWindow";
import {
  floatingTerminalGeometryId,
  writeFloatingTerminalDock,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";
import { terminalColorKey } from "./terminalColor";
import { setDeskPinned, useDeskPins } from "./useDeskPins";
import { useTerminalColorChoices } from "./useTerminalColors";
import { dockedWidthAfterPlace } from "./windows/windowManager";
import { useWorldInspectorController } from "./useWorldInspectorController";
import { useWorldVisualActions } from "./useWorldVisualActions";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import WorldIntentProfile from "./WorldIntentProfile";
import { WorldConnectionRequired } from "./WorldStatus";
import { WindowFrame } from "./windows/WindowFrame";
import {
  WorldPanelWindow,
  useWorldPanels,
  useWorldPanelFocus,
} from "./windows/WorldPanel";
import { WindowSurface } from "./windows/WindowSurface";
import { type WorldControlPlaneProps } from "./worldControlPlaneContract";
import {
  activateWorldNodeHost,
  worldNodeForInspectorPaneFocus,
} from "./worldInspectorSelection";
import type {
  WorldAgentStatus,
  WorldLeafObject,
  WorldObject,
  WorldObjectNode,
} from "./worldObject";
import { useWorldAnchorPresent, type WorldAnchorFeed } from "./worldAnchorFeed";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";
import { worldInspectorWindowId } from "./worldTerminalPresentation";

/** Switch to lists the agents waiting on you, then finished ones, then the rest. */
function switchToRank(status: WorldAgentStatus) {
  return status === "blocked" ? 0 : status === "done" ? 1 : 2;
}

const TownView = lazyWithReload("world-town", () => import("./TownView"));
const BoardView = lazyWithReload("world-board", () => import("./BoardView"));

const AgentLauncherDialog = lazyWithReload("world-agent-launcher", () =>
  import("./AgentLauncherDialog").then((module) => ({
    default: module.AgentLauncherDialog,
  })),
);
const SoundsDialog = lazyWithReload("world-sounds", () =>
  import("./SoundsDialog").then((module) => ({
    default: module.SoundsDialog,
  })),
);
const ProfileEditor = lazyWithReload("world-profile-editor", () =>
  import("./ProfileEditor").then((module) => ({
    default: module.ProfileEditor,
  })),
);

/**
 * The launcher and the profile editor, opened from any view by their events
 * (agentProfiles.ts). They see every host's rooms.
 */
function AgentDialogs({
  world,
  onOpenTerminal,
}: {
  world: WorldObject;
  onOpenTerminal(nodeId: string): void;
}) {
  const [launch, setLaunch] = useState<
    (Partial<LaunchTarget> & { profileId?: string }) | null
  >(null);
  const [editing, setEditing] = useState<{ profileId?: string } | null>(null);
  const [sounds, setSounds] = useState(false);
  // Chimes need the profiles document (Town master, profile chimes) and
  // unlocked audio whichever view is open.
  useAgentProfiles();
  useChimeHost();
  // A launched agent or login terminal opens once World's snapshot shows it.
  const [pendingOpen, setPendingOpen] = useState<{
    connectionId: string;
    terminalId: string;
  } | null>(null);
  useEffect(() => {
    if (!pendingOpen) return;
    const leaf = world.leaves.find(
      (candidate) =>
        candidate.connectionId === pendingOpen.connectionId &&
        candidate.terminalId === pendingOpen.terminalId,
    );
    if (!leaf) return;
    setPendingOpen(null);
    onOpenTerminal(leaf.id);
  }, [world, pendingOpen, onOpenTerminal]);
  useEffect(() => {
    const onLaunch = (event: Event) =>
      setLaunch({ ...(event as CustomEvent<LaunchTarget>).detail });
    const onProfiles = (event: Event) =>
      setEditing({ profileId: (event as CustomEvent<string>).detail });
    const onSounds = () => setSounds(true);
    window.addEventListener(WORLD_AGENT_LAUNCH_EVENT, onLaunch);
    window.addEventListener(WORLD_AGENT_PROFILES_EVENT, onProfiles);
    window.addEventListener(WORLD_SOUNDS_EVENT, onSounds);
    return () => {
      window.removeEventListener(WORLD_AGENT_LAUNCH_EVENT, onLaunch);
      window.removeEventListener(WORLD_AGENT_PROFILES_EVENT, onProfiles);
      window.removeEventListener(WORLD_SOUNDS_EVENT, onSounds);
    };
  }, []);
  return (
    <Suspense fallback={null}>
      {sounds ? (
        <SoundsDialog world={world} onClose={() => setSounds(false)} />
      ) : null}
      {editing ? (
        <ProfileEditor
          world={world}
          initialId={editing.profileId}
          onLaunch={(profileId) =>
            setLaunch((current) => ({ ...current, profileId }))
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
      {launch ? (
        <AgentLauncherDialog
          key={launch.profileId ?? ""}
          world={world}
          initial={launch}
          onOpen={setPendingOpen}
          onEditProfiles={() => setEditing({})}
          onClose={() => setLaunch(null)}
        />
      ) : null}
    </Suspense>
  );
}

const WorldIntentConnector = lazyWithReload(
  "world-intent-connector",
  () => import("./WorldIntentConnector"),
);

/** A conversation's connector, shown while its node has an anchor. */
function ConversationConnector({
  feed,
  nodeId,
  target,
}: {
  feed: WorldAnchorFeed;
  nodeId: string;
  target: WorldConnectorTargetBounds;
}) {
  return useWorldAnchorPresent(feed, nodeId) ? (
    <Suspense fallback={null}>
      <WorldIntentConnector feed={feed} nodeId={nodeId} target={target} />
    </Suspense>
  ) : null;
}

const WorldViewErrorBoundary = lazyWithReload("world-view-boundary", () =>
  import("./WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);
export function WorldControlPlane(props: WorldControlPlaneProps) {
  // Panel windows (not Inspectors) that a view opens with <WorldPanel>.
  const panelRegistry = useWorldPanels();
  const { panels, panelBodyRef } = panelRegistry;
  const controller = useWorldInspectorController(props);
  const {
    view,
    active,
    inspectorConversations,
    onInspectorConversationsChange,
    onInspectorTerminalPortal,
    viewToolbarPortal,
    deskReadingPane,
    connectionSelection,
    hostsFilter,
    aggregateWorld,
    world,
    presentedWorld,
    intentRequestRef,
    inspectorFocusIntentRef,
    contextRailRef,
    floatingInspectorPortals,
    setFloatingInspectorPortals,
    intentOpening,
    intentError,
    visualConversationAnchors,
    setVisualConversationAnchors,
    floatingWindowAnchors,
    setFloatingWindowAnchors,
    worldViewLayoutRef,
    inspectorConversationsRef,
    currentSelectionGeneration,
    selected,
    selectedId,
    setWindowLayer,
    windowStage,
    compactArrangement,
    managedWindows,
    windowCommand,
    contextRailInspector,
    visibleFloatingInspectorIds,
    visibleFloatingInspectors,
    raiseInspector,
    revealInspector,
    conversationNodeIds,
    inspectorClose,
    setInspectorClose,
    selectNode,
    closeIntent,
    previewTerminalById,
    closeDeskReading,
    openTerminalById,
    openNodeById,
    closeInspector,
    focusFloatingInspector,
    retireInspectors,
    showSelectionProfile,
    applySelection,
    openInBackground,
    focusInspectorPane,
  } = controller;
  useWorldPanelFocus(panelRegistry, managedWindows, windowCommand);
  /**
   * Only Town reads where a window was left docked, so only Town writes it:
   * snapping or floating a window in Desk never changes where it opens in
   * Town.
   */
  const rememberTownDock = (
    ...args: Parameters<typeof writeFloatingTerminalDock>
  ) => {
    if (view === "town") writeFloatingTerminalDock(...args);
  };
  const {
    workspaceCreationOpen,
    setWorkspaceCreationOpen,
    workspaceCreationDestination,
  } = useWorldVisualActions(controller);
  const colorChoice = useTerminalColorChoices();
  const deskPins = useDeskPins();
  const inspectorTab = (conversation: WorldInspectorConversation) =>
    conversation.tabId
      ? {
          connectionId: conversation.connectionId,
          workspaceId: conversation.workspaceId,
          tabId: conversation.tabId,
          workspaceIds: new Set(
            world.spaces
              .filter(
                (space) => space.connectionId === conversation.connectionId,
              )
              .map((space) => space.nativeId),
          ),
        }
      : null;
  const inspectorColor = (conversation: WorldInspectorConversation) => {
    const tab = inspectorTab(conversation);
    return tab ? colorChoice(tab) : null;
  };
  // An agent window pins its agent's desk in Town.
  const inspectorPin = (conversation: WorldInspectorConversation) => {
    const tab = inspectorTab(conversation);
    return tab
      ? {
          pinned: Boolean(deskPins[terminalColorKey(tab)]),
          onPin: (pinned: boolean) => void setDeskPinned(tab, pinned),
        }
      : null;
  };

  return (
    <main
      className="world-control-plane"
      id="world"
      data-active={active ? "true" : "false"}
    >
      <AgentDialogs
        world={aggregateWorld}
        onOpenTerminal={(nodeId) => void openTerminalById(nodeId)}
      />
      <GroupsWindow
        world={aggregateWorld}
        onOpenTerminal={(id) => void openTerminalById(id)}
      />
      <CreateWorkspaceDialog
        open={workspaceCreationOpen}
        initialDestination={workspaceCreationDestination}
        onClose={() => setWorkspaceCreationOpen(false)}
      />
      <ConfirmDialog
        open={inspectorClose !== null}
        title={`Close Inspector ${inspectorClose?.target.type ?? "tab"}`}
        message={`Close this ${inspectorClose?.target.type ?? "tab"} on ${inspectorClose?.conversation.hostLabel ?? "the captured host"}?`}
        confirmLabel="Close"
        danger
        onClose={() => setInspectorClose(null)}
        onConfirm={() => {
          const captured = inspectorClose;
          setInspectorClose(null);
          if (captured)
            void (
              captured.target.type === "pane"
                ? captured.operations.closePane(captured.target.id)
                : captured.operations.closeTab(captured.target.id)
            ).catch((error) =>
              store.notify({
                kind: "error",
                message: "Tab close failed",
                detail: String(error),
              }),
            );
        }}
      />
      {connectionSelection.connections.length === 0 &&
      inspectorConversations.length === 0 ? (
        <WorldConnectionRequired status={connectionSelection.status} />
      ) : (
        <div
          ref={worldViewLayoutRef}
          className={`world-view-layout ${showSelectionProfile || contextRailInspector ? "has-context" : ""}`}
        >
          <section className="world-view-stage" aria-label={`${view} view`}>
            {active ? (
              <Suspense
                fallback={
                  <div className="world-view-loading">Loading view…</div>
                }
              >
                <WorldViewErrorBoundary key={view}>
                  {view === "desk" ? (
                    <DeskView
                      world={world}
                      aggregate={aggregateWorld}
                      onOpen={openNodeById}
                      reading={
                        deskReadingPane && contextRailInspector
                          ? contextRailInspector.nodeId
                          : null
                      }
                      onPreview={deskReadingPane ? previewTerminalById : null}
                      onCloseReading={closeDeskReading}
                    />
                  ) : view === "town" ? (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">Loading Town…</div>
                      }
                    >
                      <TownView
                        world={presentedWorld}
                        onOpenInspectorView={(id, view, focus = true) => {
                          // An unfocused open (the docked Town master) stays
                          // in the background: no selection, not raised.
                          if (focus) void applySelection(id, view);
                          else openInBackground(id, view);
                        }}
                        toolbarPortal={viewToolbarPortal}
                        selectedId={selectedId}
                        onSelect={selectNode}
                        floatingTerminals={inspectorConversations}
                        onConversationNodeAnchorsChange={
                          setVisualConversationAnchors
                        }
                        onOpenTerminal={openTerminalById}
                      />
                    </Suspense>
                  ) : (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">Loading Board…</div>
                      }
                    >
                      <BoardView
                        world={presentedWorld}
                        toolbarPortal={viewToolbarPortal}
                        selectedId={selectedId}
                        conversationNodeIds={conversationNodeIds}
                        onSelect={selectNode}
                        onOpen={openNodeById}
                        onNodeAnchorsChange={setVisualConversationAnchors}
                      />
                    </Suspense>
                  )}
                </WorldViewErrorBoundary>
              </Suspense>
            ) : null}
          </section>
          {showSelectionProfile && selected ? (
            <aside
              className="world-context-rail"
              ref={contextRailRef}
              aria-label="World context"
            >
              <WorldIntentProfile
                node={selected}
                currentGeneration={currentSelectionGeneration}
                inspectorOpen={Boolean(contextRailInspector)}
                intentOpening={intentOpening}
                resourceError={intentError}
                onActivateHost={async () => {
                  window.dispatchEvent(
                    new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT),
                  );
                  retireInspectors();
                  await activateWorldNodeHost(selected);
                }}
                onClose={closeIntent}
              />
            </aside>
          ) : null}
          {!showSelectionProfile && intentError ? (
            <p className="world-panel-error" role="alert">
              {intentError}
            </p>
          ) : null}
          {visibleFloatingInspectors.map((conversation) => {
            const target =
              floatingWindowAnchors[worldInspectorWindowId(conversation)];
            return presentedWorld.nodeById.get(conversation.nodeId)
              ?.generation === conversation.runtimeGeneration && target ? (
              <ConversationConnector
                key={worldInspectorWindowId(conversation)}
                feed={visualConversationAnchors}
                nodeId={conversation.nodeId}
                target={target}
              />
            ) : null;
          })}
          <WindowSurface
            state={managedWindows}
            dispatch={windowCommand}
            stage={windowStage}
            compact={compactArrangement}
            onLayer={setWindowLayer}
          >
            {({
              entry,
              geometry,
              stage,
              workArea,
              zIndex,
              active: windowActive,
            }) => {
              const panel = panels.find(
                (candidate) => candidate.id === entry.id,
              );
              if (panel)
                return (
                  <WindowFrame
                    key={entry.id}
                    id={entry.id}
                    label={`${panel.label} window`}
                    geometry={geometry}
                    restoreGeometry={
                      entry.maximized ||
                      entry.placement.kind !== "floating" ||
                      managedWindows.focusMode
                        ? entry.floating
                        : undefined
                    }
                    stage={stage}
                    workArea={workArea}
                    zIndex={zIndex}
                    active={windowActive}
                    compact={compactArrangement}
                    // In Town a panel takes the Town window look, as the
                    // Inspector does.
                    className={`world-panel-frame ${
                      view === "town" ? "is-town-skin theme-scope-dark" : ""
                    }`}
                    onRaise={() =>
                      windowCommand({ type: "raise", id: entry.id })
                    }
                    onPlace={(rect) =>
                      windowCommand({ type: "place", id: entry.id, rect })
                    }
                    onSnap={(target) =>
                      windowCommand({ type: "snap", id: entry.id, target })
                    }
                    onMaximize={() =>
                      windowCommand({ type: "maximize", id: entry.id })
                    }
                  >
                    <WorldPanelWindow
                      label={panel.label}
                      onBody={panelBodyRef(entry.id)}
                      controls={{
                        compact: compactArrangement,
                        maximized: entry.maximized || managedWindows.focusMode,
                        onMinimize: () =>
                          windowCommand({ type: "minimize", id: entry.id }),
                        onMaximize: () =>
                          windowCommand({ type: "maximize", id: entry.id }),
                        onClose: panel.onClose,
                        onSnap: (target) =>
                          windowCommand({
                            type: "snap",
                            id: entry.id,
                            target,
                          }),
                        onFloat: () =>
                          windowCommand({ type: "float", id: entry.id }),
                        // A panel is a detail of its view: Back closes it.
                        back: {
                          label: `Back to ${view[0]!.toUpperCase()}${view.slice(1)}`,
                        },
                      }}
                    />
                  </WindowFrame>
                );
              const conversation = inspectorConversations.find(
                (candidate) => worldInspectorWindowId(candidate) === entry.id,
              );
              if (!conversation) return null;
              return (
                <WindowFrame
                  key={entry.id}
                  id={entry.id}
                  label={conversation.label + " Inspector"}
                  geometry={geometry}
                  restoreGeometry={
                    entry.maximized ||
                    entry.placement.kind !== "floating" ||
                    managedWindows.focusMode
                      ? entry.floating
                      : undefined
                  }
                  stage={stage}
                  workArea={workArea}
                  zIndex={zIndex}
                  active={windowActive}
                  compact={compactArrangement}
                  // Town draws its one window in the Town prototype's look;
                  // Board and Desk keep the calm shell look.
                  className={`world-floating-terminal ${
                    view === "town" ? "is-town-skin theme-scope-dark" : ""
                  }`}
                  onTerminalActivate={(paneId) => {
                    const snapshot = connectionSnapshot(
                      store.get(),
                      conversation.connectionId,
                    );
                    if (
                      snapshot.selectedPaneId ===
                      (paneId ?? conversation.paneId)
                    )
                      return;
                    const node = paneId
                      ? worldNodeForInspectorPaneFocus(
                          aggregateWorld,
                          conversation,
                          paneId,
                        )
                      : undefined;
                    void focusFloatingInspector(
                      conversation,
                      true,
                      undefined,
                      node ?? undefined,
                    ).catch(() => undefined);
                  }}
                  onRaise={(explicit) => {
                    if (explicit) intentRequestRef.current++;
                    inspectorFocusIntentRef.current += 1;
                    windowCommand({ type: "raise", id: entry.id });
                  }}
                  onPlace={(rect) => {
                    writeFloatingTerminalGeometry(
                      worldLocalStorage,
                      floatingTerminalGeometryId(conversation),
                      rect,
                    );
                    // Resizing a dock from its inner edge keeps it docked,
                    // and Town remembers the width.
                    const dockWidth = dockedWidthAfterPlace(
                      entry,
                      rect,
                      windowStage,
                    );
                    rememberTownDock(
                      worldLocalStorage,
                      floatingTerminalGeometryId(conversation),
                      dockWidth !== null && entry.placement.kind === "snap"
                        ? entry.placement.target
                        : "float",
                      dockWidth ?? undefined,
                    );
                    windowCommand({ type: "place", id: entry.id, rect });
                  }}
                  onSnap={(target) => {
                    rememberTownDock(
                      worldLocalStorage,
                      floatingTerminalGeometryId(conversation),
                      target,
                    );
                    windowCommand({ type: "snap", id: entry.id, target });
                  }}
                  onMaximize={() =>
                    windowCommand({ type: "maximize", id: entry.id })
                  }
                  onBoundsChange={(bounds) =>
                    setFloatingWindowAnchors((current) => {
                      const previous = current[entry.id];
                      return previous === bounds ||
                        (previous &&
                          bounds &&
                          previous.left === bounds.left &&
                          previous.top === bounds.top &&
                          previous.right === bounds.right &&
                          previous.bottom === bounds.bottom)
                        ? current
                        : { ...current, [entry.id]: bounds };
                    })
                  }
                  onPortalChange={(portal) =>
                    setFloatingInspectorPortals((current) =>
                      current[entry.id] === portal
                        ? current
                        : { ...current, [entry.id]: portal },
                    )
                  }
                >
                  {!world.hosts.some(
                    (host) => host.connectionId === conversation.connectionId,
                  ) && (
                    <div className="world-window-scope" role="status">
                      <span>
                        Outside Hosts filter · {conversation.hostLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          hostsFilter.setIds(
                            hostsFilter.ids === null
                              ? null
                              : [
                                  ...new Set([
                                    ...hostsFilter.ids,
                                    conversation.connectionId,
                                  ]),
                                ],
                          )
                        }
                      >
                        Reveal in Hosts
                      </button>
                    </div>
                  )}
                </WindowFrame>
              );
            }}
          </WindowSurface>
        </div>
      )}
      <Suspense fallback={null}>
        {inspectorConversations.map((conversation) => (
          <WorldInspectorConversationView
            key={worldInspectorWindowId(conversation)}
            conversation={conversation}
            target={
              visibleFloatingInspectorIds.has(
                worldInspectorWindowId(conversation),
              )
                ? (floatingInspectorPortals[
                    worldInspectorWindowId(conversation)
                  ] ?? null)
                : null
            }
            floating
            terminalActive={
              visibleFloatingInspectorIds.has(
                worldInspectorWindowId(conversation),
              ) &&
              Boolean(
                floatingInspectorPortals[worldInspectorWindowId(conversation)],
              )
            }
            onChange={(change) => {
              if (change.view && change.view !== conversation.view)
                intentRequestRef.current++;
              const next = inspectorConversationsRef.current.map((candidate) =>
                worldInspectorWindowId(candidate) ===
                worldInspectorWindowId(conversation)
                  ? { ...candidate, ...change }
                  : candidate,
              );
              inspectorConversationsRef.current = next;
              onInspectorConversationsChange(next);
            }}
            onClose={() => closeInspector(conversation)}
            onSelectPane={(paneId) =>
              focusInspectorPane(worldInspectorWindowId(conversation), paneId)
            }
            windowControls={{
              compact: compactArrangement,
              maximized:
                managedWindows.windows[worldInspectorWindowId(conversation)]
                  ?.maximized === true || managedWindows.focusMode,
              onMinimize: () =>
                windowCommand({
                  type: "minimize",
                  id: worldInspectorWindowId(conversation),
                }),
              onMaximize: () =>
                windowCommand({
                  type: "maximize",
                  id: worldInspectorWindowId(conversation),
                }),
              onClose: () => closeInspector(conversation),
              onSnap: (target) => {
                rememberTownDock(
                  worldLocalStorage,
                  floatingTerminalGeometryId(conversation),
                  target,
                );
                windowCommand({
                  type: "snap",
                  id: worldInspectorWindowId(conversation),
                  target,
                });
              },
              onFloat: () => {
                rememberTownDock(
                  worldLocalStorage,
                  floatingTerminalGeometryId(conversation),
                  "float",
                );
                windowCommand({
                  type: "float",
                  id: worldInspectorWindowId(conversation),
                });
              },
              pin: inspectorPin(conversation),
              // The colour is chosen from the swatch beside the name.
              back: view === "town" ? { label: "Back to Town" } : undefined,
              // A phone switches between agents and terminals from ⋯, as
              // its terminal does: agents open on Chat, terminals on Terminal.
              // The list is the hosts the filter shows, live ones only, those
              // that need you first; the menu scrolls rather than cutting.
              switchTo: compactArrangement
                ? presentedWorld.nodes
                    .filter(
                      (node: WorldObjectNode): node is WorldLeafObject =>
                        (node.kind === "agent" || node.kind === "terminal") &&
                        node.actionable &&
                        !node.stale &&
                        node.id !== conversation.nodeId,
                    )
                    .sort(
                      (a, b) => switchToRank(a.status) - switchToRank(b.status),
                    )
                    .map((node) => ({
                      id: node.id,
                      label: node.label,
                      detail: `${node.stateLabels[node.status] ?? node.status} · ${node.spaceLabel}`,
                      onSelect: () =>
                        void applySelection(
                          node.id,
                          node.kind === "agent" ? "history" : "terminal",
                        ),
                    }))
                : undefined,
            }}
            terminalColor={inspectorColor(conversation)}
            townSkin={view === "town"}
            onBind={() =>
              void store
                .loadConnectionSession(conversation.connectionId)
                .catch(() => undefined)
            }
            onResourceFocus={() => {
              intentRequestRef.current++;
              const id = worldInspectorWindowId(conversation);
              raiseInspector(id);
              revealInspector(id);
            }}
            onTerminalPortalChange={(portal) =>
              onInspectorTerminalPortal(
                worldInspectorWindowId(conversation),
                portal,
              )
            }
          />
        ))}
      </Suspense>
    </main>
  );
}
