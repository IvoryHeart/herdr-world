import {
  floatingTerminalGeometryId,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";
import { WindowSurface } from "./windows/WindowSurface";
import { WindowFrame } from "./windows/WindowFrame";
import { Suspense } from "react";
import { worldLocalStorage } from "../browserStorage";
import { ConfirmDialog } from "../components/ModalDialogs";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { lazyWithReload } from "../lazyWithReload";
import { connectionSnapshot, store } from "../store";
import { WORKSPACE_INSPECTOR_CLOSE_EVENT } from "../workspaceResource";
import WorldIntentProfile from "./WorldIntentProfile";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import { WorldConnectionRequired } from "./WorldStatus";
import { DeskView } from "./DeskView";
import { worldInspectorWindowId } from "./worldTerminalPresentation";
import {
  worldNodeForInspectorPaneFocus,
  activateWorldNodeHost,
} from "./worldInspectorSelection";
import { type WorldControlPlaneProps } from "./worldControlPlaneContract";
import { useWorldInspectorController } from "./useWorldInspectorController";
import { useWorldVisualActions } from "./useWorldVisualActions";

const PixelOfficeView = lazyWithReload(
  "world-pixel-office",
  () => import("./PixelOfficeView"),
);

const ConnectedTreeView = lazyWithReload(
  "world-connected-tree",
  () => import("./ConnectedTreeView"),
);

const SpatialGraphView = lazyWithReload(
  "world-spatial-graph",
  () => import("./SpatialGraphView"),
);

const WorldIntentConnector = lazyWithReload(
  "world-intent-connector",
  () => import("./WorldIntentConnector"),
);

const WorldViewErrorBoundary = lazyWithReload("world-view-boundary", () =>
  import("./WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);
export function WorldControlPlane(props: WorldControlPlaneProps) {
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
    setSelectedVisualAnchor,
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
    closeInspector,
    focusFloatingInspector,
    retireInspectors,
    showSelectionProfile,
  } = controller;
  const {
    workspaceCreationOpen,
    setWorkspaceCreationOpen,
    workspaceCreationDestination,
  } = useWorldVisualActions(controller);

  return (
    <main
      className="world-control-plane"
      id="world"
      data-active={active ? "true" : "false"}
    >
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
      {connectionSelection.connections.length === 0 ? (
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
                      onOpenTerminal={openTerminalById}
                      reading={
                        deskReadingPane && contextRailInspector
                          ? contextRailInspector.nodeId
                          : null
                      }
                      onPreview={deskReadingPane ? previewTerminalById : null}
                      onCloseReading={closeDeskReading}
                    />
                  ) : view === "office" ? (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">
                          Loading Office…
                        </div>
                      }
                    >
                      <PixelOfficeView
                        world={presentedWorld}
                        toolbarPortal={viewToolbarPortal}
                        selectedId={selectedId}
                        onSelect={selectNode}
                        floatingTerminals={inspectorConversations}
                        onConversationNodeAnchorsChange={
                          setVisualConversationAnchors
                        }
                        onOpenTerminal={openTerminalById}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                      />
                    </Suspense>
                  ) : view === "tree" ? (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">Loading Tree…</div>
                      }
                    >
                      <ConnectedTreeView
                        world={presentedWorld}
                        toolbarPortal={viewToolbarPortal}
                        selectedId={selectedId}
                        conversationNodeIds={conversationNodeIds}
                        inlineInspectorNodeId={null}
                        onSelect={selectNode}
                        onOpenTerminal={openTerminalById}
                        onInlineInspectorPortalChange={() => {}}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                        onNodeAnchorsChange={setVisualConversationAnchors}
                      />
                    </Suspense>
                  ) : (
                    <SpatialGraphView
                      world={presentedWorld}
                      toolbarPortal={viewToolbarPortal}
                      selectedId={selectedId}
                      conversationNodeIds={conversationNodeIds}
                      onSelect={selectNode}
                      onOpenTerminal={openTerminalById}
                      onSelectedAnchorChange={setSelectedVisualAnchor}
                      onNodeAnchorsChange={setVisualConversationAnchors}
                    />
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
            const source =
              presentedWorld.nodeById.get(conversation.nodeId)?.generation ===
              conversation.runtimeGeneration
                ? visualConversationAnchors?.[conversation.nodeId]
                : null;
            const target =
              floatingWindowAnchors[worldInspectorWindowId(conversation)];
            return source && target ? (
              <Suspense
                key={worldInspectorWindowId(conversation)}
                fallback={null}
              >
                <WorldIntentConnector source={source} target={target} />
              </Suspense>
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
                  className="world-floating-terminal"
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
                    windowCommand({ type: "place", id: entry.id, rect });
                  }}
                  onSnap={(target) =>
                    windowCommand({ type: "snap", id: entry.id, target })
                  }
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
              onSnap: (target) =>
                windowCommand({
                  type: "snap",
                  id: worldInspectorWindowId(conversation),
                  target,
                }),
              onFloat: () =>
                windowCommand({
                  type: "float",
                  id: worldInspectorWindowId(conversation),
                }),
            }}
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
