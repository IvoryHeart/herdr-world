import { TerminalAppearanceEditor } from "./TerminalAppearanceEditor";
import { leafAppearance, useAppearanceDocument } from "./appearance";
import { useAgentWorktree } from "../useAgentWorktree";
import { requestChatInputFocus } from "../chatFocus";
import type { ManagedWindowControls } from "./windows/WindowControls";
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
import {
  createReviewAnnotation,
  reanchorDiffReviewAnnotations,
  reanchorFileReviewAnnotations,
  type NewReviewAnnotation,
  type ReviewAnnotation,
} from "../annotations";
import { worldLocalStorage } from "../browserStorage";
import { type ActiveDiffSelection } from "../components/DiffViewerPanel";
import { requestFilePreview } from "../components/fileExplorerResources";
import type { ActiveFilePreviewSelection } from "../components/FilePreviewContent";
import { WorkspaceInspectorHost } from "../components/WorkspaceInspectorHost";
import { ThemeScope } from "../themeScope";
import { AgentProfileLink } from "./AgentProfileLink";
import { InspectorPaneMap } from "../components/InspectorPaneMap";
import {
  OperationalContext,
  connectionSnapshot,
  shallowEqual,
  store,
  useStoreSelector,
} from "../store";
import type { FileExplorerEntry, GitDiffEntry } from "../types";
import {
  connectionClientScopeKey,
  ResourceConnectionClientContext,
  useConnectionClient,
} from "../useConnectionClient";
import { useReviewAnnotationDraft } from "../useReviewAnnotationDraft";
import {
  readResourceFileSelection,
  resourceScopeForWorkspace,
  resourceStateKey,
  writeInspectorPreferences,
  writeResourceFileSelection,
  type InspectorDock,
  type InspectorView,
  type WorkspaceInspectorState,
  WORKSPACE_ANNOTATION_REQUEST_EVENT,
  type WorkspaceAnnotationRequest,
} from "../workspaceResource";
import {
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";
import {
  INSPECTOR_TERMINAL_FILE_EVENT,
  inspectorTerminalFileAdmitted,
  type InspectorTerminalFileRequest,
} from "./inspectorTerminalHandoff";
import { townPortrait } from "./town/townSprites";

const emptyDiff = (): ActiveDiffSelection => ({
  entry: null,
  file: null,
  loading: false,
  error: null,
  entries: [],
  files: {},
  fileErrors: {},
  summaryLoading: false,
});

const emptyFile = (): ActiveFilePreviewSelection => ({
  entry: null,
  preview: null,
  loading: false,
  error: null,
});

export default function WorldInspectorConversationView(
  props: Parameters<typeof InspectorResources>[0],
) {
  return (
    <OperationalContext.Provider
      value={{
        connectionId: props.conversation.connectionId,
        runtimeGeneration: props.conversation.runtimeGeneration,
      }}
    >
      <InspectorResources {...props} />
    </OperationalContext.Provider>
  );
}

function InspectorResources({
  conversation,
  target,
  floating,
  terminalActive,
  embedded = false,
  onChange,
  onClose,
  onDockOut,
  onDockIn,
  onFocus,
  onResourceFocus,
  windowControls,
  terminalColor,
  townSkin = false,
  onWindowMaximize,
  windowMaximized = false,
  onTerminalPortalChange,
  onBind,
  onSelectPane,
}: {
  /**
   * The window is shown but its host's session has not loaded this
   * workspace yet (a window restored on page load, on a host not yet opened):
   * load that host's session, without focusing anything there.
   */
  onBind?(): void;
  conversation: WorldInspectorConversation;
  target: Element | null;
  floating: boolean;
  terminalActive: boolean;
  embedded?: boolean;
  onChange(change: Partial<WorldInspectorConversation>): void;
  onClose(): void;
  onDockOut?(): void;
  onDockIn?(): void;
  onFocus?(): void;
  onResourceFocus(): void;
  windowControls?: ManagedWindowControls;
  terminalColor?: ManagedWindowControls["color"];
  /** Town draws the agent with its Town portrait, as the town shows it. */
  townSkin?: boolean;
  onWindowMaximize?(): void;
  windowMaximized?: boolean;
  onTerminalPortalChange(element: HTMLDivElement | null): void;
  /** Show another pane of this window's tab (World-only, from the title map). */
  onSelectPane?(paneId: string): void;
}) {
  const baseConnectionClient = useConnectionClient();
  const portalOwnerRef = useRef<HTMLDivElement | null>(null);
  if (!portalOwnerRef.current) {
    portalOwnerRef.current = document.createElement("div");
    portalOwnerRef.current.className = "world-inspector-transfer-owner";
  }
  const portalOwner = portalOwnerRef.current;
  useLayoutEffect(() => {
    const destination = target ?? document.body;
    if (portalOwner.parentElement !== destination) {
      destination.appendChild(portalOwner);
    }
    portalOwner.style.display = target ? "contents" : "none";
  }, [portalOwner, target]);
  useLayoutEffect(
    () => () => {
      portalOwner.remove();
    },
    [portalOwner],
  );
  const runtimeKey = connectionClientScopeKey(
    baseConnectionClient,
    "world-inspector",
  );
  const appearance = useAppearanceDocument();
  const { workspaces, panes, tabs, status, catalogueReady } = useStoreSelector(
    (snapshot) => ({
      workspaces: snapshot.workspaces,
      tabs: snapshot.tabs,
      panes: snapshot.panes,
      status: snapshot.status,
      catalogueReady: snapshot.catalogueReady,
    }),
    shallowEqual,
  );
  const workspace = workspaces.find(
    (candidate) => candidate.workspace_id === conversation.workspaceId,
  );
  const historyPane = conversation.paneId
    ? panes.find(
        (candidate) =>
          candidate.pane_id === conversation.paneId &&
          candidate.workspace_id === conversation.workspaceId &&
          candidate.tab_id === conversation.tabId,
      )
    : undefined;
  const worktree = useAgentWorktree(baseConnectionClient, {
    enabled: conversation.context.kind === "agent",
    active: ["files", "changes", "commits"].includes(conversation.view),
    paneId: conversation.paneId,
    terminalId: historyPane?.terminal_id,
    sessionFingerprint: conversation.agentSessionFingerprint,
    foregroundCwd: historyPane?.foreground_cwd,
  });
  const connectionClient = worktree.client;
  const scope = useMemo(
    () =>
      workspace
        ? worktree.view?.selected
          ? {
              kind: "worktree" as const,
              connectionId: conversation.connectionId,
              workspaceId: workspace.workspace_id,
              repoKey: worktree.view.selected.gitCommonDir,
              checkoutKey: JSON.stringify([
                worktree.view.selected.gitCommonDir,
                worktree.view.selected.canonicalRoot,
              ]),
              checkoutPath: worktree.view.selected.canonicalRoot,
            }
          : resourceScopeForWorkspace(conversation.connectionId, workspace)
        : null,
    [conversation.connectionId, workspace, worktree.view?.selected],
  );
  const [fileSelection, setFileSelection] =
    useState<ActiveFilePreviewSelection>(emptyFile);
  const [diffSelection, setDiffSelection] =
    useState<ActiveDiffSelection>(emptyDiff);
  const previewRequestRef = useRef(0);
  useEffect(
    () => () => {
      previewRequestRef.current += 1;
    },
    [],
  );
  const resourceClientKey = connectionClientScopeKey(connectionClient);
  const retainedResourceClientKey = useRef(resourceClientKey);
  // An absent binding during transport recovery cannot replace the displayed resource.
  if (connectionClient.agentWorktree !== null)
    retainedResourceClientKey.current = resourceClientKey;
  const resourceKey = JSON.stringify([
    scope ? resourceStateKey(scope) : null,
    retainedResourceClientKey.current,
    conversation.resourceIdentity,
  ]);
  const resourceBinding = useMemo(() => Symbol(resourceKey), [resourceKey]);
  const resourceBindingRef = useRef(resourceBinding);
  useLayoutEffect(() => {
    if (resourceBindingRef.current === resourceBinding) return;
    resourceBindingRef.current = resourceBinding;
    previewRequestRef.current += 1;
    setFileSelection(emptyFile());
    setDiffSelection(emptyDiff());
  }, [resourceBinding]);
  const terminalPortalChangeRef = useRef(onTerminalPortalChange);
  const focusRef = useRef(onFocus);
  terminalPortalChangeRef.current = onTerminalPortalChange;
  focusRef.current = onFocus;
  const setTerminalPortal = useCallback(
    (element: HTMLDivElement | null) =>
      terminalPortalChangeRef.current(element),
    [],
  );

  useEffect(() => {
    if (!target || !onFocus) return;
    const focusConversation = (event: Event) => {
      const clickedPaneId =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              ".pane-layout-cell, .pane-layout-single, .pane-switcher-button",
            )?.dataset.paneId
          : null;
      if (clickedPaneId && clickedPaneId !== conversation.paneId) return;
      if (
        event.target instanceof Element &&
        event.target.closest(".workspace-inspector-head.is-window-drag-handle")
      ) {
        return;
      }
      focusRef.current?.();
    };
    target.addEventListener("pointerdown", focusConversation, true);
    return () =>
      target.removeEventListener("pointerdown", focusConversation, true);
  }, [conversation.paneId, onFocus, target]);
  const {
    read: readAnnotationDraft,
    select: selectAnnotationDraft,
    update: updateAnnotationDraft,
  } = useReviewAnnotationDraft(runtimeKey);

  useEffect(() => {
    selectAnnotationDraft(scope);
  }, [scope, selectAnnotationDraft]);

  const loadFile = useCallback(
    (entry: FileExplorerEntry, fragment?: string) => {
      if (
        !workspace ||
        !connectionClient.isCurrent() ||
        resourceBindingRef.current !== resourceBinding
      )
        return;
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      setFileSelection({
        entry,
        fragment,
        preview: null,
        loading: true,
        error: null,
      });
      void requestFilePreview(workspace.workspace_id, entry.path, {
        client: connectionClient,
        refresh: true,
      })
        .then((preview) => {
          if (
            !connectionClient.isCurrent() ||
            previewRequestRef.current !== requestId
          ) {
            return;
          }
          setFileSelection({
            entry,
            fragment,
            preview,
            loading: false,
            error: null,
          });
        })
        .catch((cause) => {
          if (
            !connectionClient.isCurrent() ||
            previewRequestRef.current !== requestId
          ) {
            return;
          }
          setFileSelection({
            entry,
            fragment,
            preview: null,
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        });
    },
    [connectionClient, workspace, resourceBinding],
  );

  useEffect(() => {
    const openTerminalFile = (event: Event) => {
      const request = (event as CustomEvent<InspectorTerminalFileRequest>)
        .detail;
      if (
        !request ||
        !target ||
        !workspace ||
        !conversation.availableViews.includes("files") ||
        !store
          .getConnection(conversation.connectionId)
          .workspaces.some(
            (candidate) => candidate.workspace_id === request.workspaceId,
          ) ||
        !inspectorTerminalFileAdmitted(
          request,
          conversation,
          connectionClient,
          connectionSnapshot(store.get(), conversation.connectionId).panes,
        )
      )
        return;
      event.preventDefault();
      onChange({ view: "files" });
      onResourceFocus();
      const name =
        request.path.split("/").filter(Boolean).pop() ?? request.path;
      loadFile({
        name,
        path: request.path,
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden: name.startsWith("."),
      });
    };
    window.addEventListener(INSPECTOR_TERMINAL_FILE_EVENT, openTerminalFile);
    return () =>
      window.removeEventListener(
        INSPECTOR_TERMINAL_FILE_EVENT,
        openTerminalFile,
      );
  }, [
    connectionClient,
    conversation,
    loadFile,
    onChange,
    onResourceFocus,
    target,
    workspace,
  ]);

  useEffect(() => {
    if (conversation.view !== "files" || !scope || fileSelection.entry) return;
    const path = readResourceFileSelection(worldLocalStorage, scope);
    if (!path) return;
    const name = path.split("/").filter(Boolean).pop() ?? path;
    loadFile({
      name,
      path,
      type: "file",
      size: 0,
      mtime_ms: 0,
      hidden: name.startsWith("."),
    });
  }, [conversation.view, fileSelection.entry, loadFile, scope]);

  useEffect(() => {
    if (!scope || !fileSelection.entry?.path) return;
    writeResourceFileSelection(
      worldLocalStorage,
      scope,
      fileSelection.entry.path,
    );
  }, [fileSelection.entry?.path, scope]);

  // A shown window waiting for its host's session binds once that host is
  // connected (a reload may mount it first), and says it is loading,
  // instead of an empty frame until the agent is clicked.
  const connectionStatus = useStoreSelector((snapshot) => snapshot.status);
  const bindRequested = useRef(false);
  useEffect(() => {
    if (connectionStatus !== "connected") {
      bindRequested.current = false;
      return;
    }
    if (scope || !target || !onBind || bindRequested.current) return;
    bindRequested.current = true;
    onBind();
  }, [connectionStatus, onBind, scope, target]);

  if (!scope)
    return createPortal(
      <p className="world-inspector-loading" role="status">
        Loading {conversation.label}…
      </p>,
      portalOwner,
      worldInspectorWindowId(conversation),
    );

  const inspectorState: WorkspaceInspectorState = {
    scope,
    open: true,
    view: conversation.view,
    availableViews: conversation.availableViews,
    dock: conversation.dock,
    size: conversation.size,
    expanded: floating ? false : conversation.expanded,
    ...(conversation.paneId ? { originPaneId: conversation.paneId } : {}),
  };

  const changeView = (view: InspectorView) => {
    const next = { ...inspectorState, view };
    onChange({
      view,
      chatFocusIntent: view === "history" ? requestChatInputFocus() : null,
    });
    writeInspectorPreferences(worldLocalStorage, next);
  };
  const changeDock = (dock: InspectorDock) => {
    const next = { ...inspectorState, dock, expanded: false };
    onChange({ dock, expanded: false });
    writeInspectorPreferences(worldLocalStorage, next);
  };
  const changeExpanded = (expanded: boolean) => {
    const next = { ...inspectorState, expanded };
    onChange({ expanded });
    writeInspectorPreferences(worldLocalStorage, next);
  };
  const openFile = (path: string, fragment?: string) => {
    const name = path.split("/").filter(Boolean).pop() ?? path;
    changeView("files");
    loadFile(
      {
        name,
        path,
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden: name.startsWith("."),
      },
      fragment,
    );
  };
  const openAnnotation = (annotation: ReviewAnnotation) => {
    window.dispatchEvent(
      new CustomEvent<WorkspaceAnnotationRequest>(
        WORKSPACE_ANNOTATION_REQUEST_EVENT,
        {
          detail: {
            connectionId: connectionClient.connectionId,
            generation: connectionClient.generation,
            runtimeGeneration: conversation.runtimeGeneration,
            workspaceId: scope.workspaceId,
            annotation,
          },
        },
      ),
    );
  };
  const createAnnotation = (input: NewReviewAnnotation) => {
    if (!connectionClient.isCurrent()) return;
    const annotation = createReviewAnnotation(input);
    updateAnnotationDraft(scope, (current) => [...current, annotation]);
    openAnnotation(annotation);
  };

  const presentationStale =
    status !== "connected" ||
    !catalogueReady ||
    !baseConnectionClient.isCurrent() ||
    Boolean(worktree.view?.selected && !worktree.view.target);
  const content = (
    <div
      tabIndex={
        !floating && target && conversation.view === "terminal" ? 0 : undefined
      }
      onFocus={(event) => {
        if (event.target === event.currentTarget) focusRef.current?.();
      }}
      className={
        floating
          ? "world-floating-inspector-content"
          : `workspace-stage world-inspector-stage inspector-dock-${conversation.dock} ${
              conversation.expanded ? "is-inspector-expanded" : ""
            }`
      }
    >
      <ResourceConnectionClientContext.Provider value={connectionClient}>
        <div
          className="workspace-inspector-slot"
          data-stale={presentationStale || undefined}
        >
          <Suspense fallback={null}>
            <WorkspaceInspectorHost
              state={inspectorState}
              visible={Boolean(target)}
              workspace={workspace}
              historyPane={historyPane}
              historySessionFingerprint={conversation.agentSessionFingerprint}
              chatFocusIntent={conversation.chatFocusIntent}
              fileSelection={fileSelection}
              previewRequestRef={previewRequestRef}
              diffSelection={diffSelection}
              connectionClient={connectionClient}
              onFileSelectionChange={(selection) => {
                if (
                  connectionClient.isCurrent() &&
                  resourceBindingRef.current === resourceBinding
                )
                  setFileSelection(selection);
              }}
              onDiffSelectionChange={(selection) => {
                if (
                  connectionClient.isCurrent() &&
                  resourceBindingRef.current === resourceBinding
                )
                  setDiffSelection(selection);
              }}
              onOpenDiffFile={(entry) => entry && openFile(entry.path)}
              annotations={readAnnotationDraft(scope)}
              onCreateAnnotation={createAnnotation}
              onReanchorFileAnnotations={(path, text) =>
                updateAnnotationDraft(scope, (current) =>
                  reanchorFileReviewAnnotations(current, path, text),
                )
              }
              onReanchorDiffAnnotations={(
                path: string,
                kind: GitDiffEntry["kind"],
                patch: string,
              ) =>
                updateAnnotationDraft(scope, (current) =>
                  reanchorDiffReviewAnnotations(current, path, kind, patch),
                )
              }
              onEditAnnotation={(id) => {
                const annotation = readAnnotationDraft(scope).find(
                  (candidate) => candidate.id === id,
                );
                if (annotation) openAnnotation(annotation);
              }}
              onSelectFileTab={openFile}
              onOpenDocument={openFile}
              onRefreshFile={() => {
                if (fileSelection.entry) {
                  loadFile(fileSelection.entry, fileSelection.fragment);
                }
              }}
              onTerminalPortalChange={
                terminalActive ? setTerminalPortal : undefined
              }
              onViewChange={changeView}
              onDockChange={changeDock}
              onExpandedChange={changeExpanded}
              windowControls={windowControls}
              terminalColor={terminalColor}
              agentSettings={
                conversation.tabId &&
                conversation.paneId &&
                conversation.terminalId &&
                terminalColor ? (
                  <TerminalAppearanceEditor
                    key={JSON.stringify([
                      conversation.connectionId,
                      conversation.runtimeGeneration,
                      conversation.tabId,
                      conversation.paneId,
                      conversation.terminalId,
                    ])}
                    connectionId={conversation.connectionId}
                    generation={conversation.runtimeGeneration}
                    tabId={conversation.tabId}
                    paneId={conversation.paneId}
                    terminalId={conversation.terminalId}
                    tabTerminals={
                      panes.some((pane) => pane.tab_id === conversation.tabId)
                        ? panes
                            .filter(
                              (pane) => pane.tab_id === conversation.tabId,
                            )
                            .map((pane) => pane.terminal_id)
                        : [conversation.terminalId]
                    }
                    workspaceIds={workspaces.map(
                      (workspace) => workspace.workspace_id,
                    )}
                    tabName={
                      tabs.find((tab) => tab.tab_id === conversation.tabId)
                        ?.label ??
                      conversation.context.tabName ??
                      "Terminal"
                    }
                    color={terminalColor}
                    disabled={presentationStale}
                  >
                    {conversation.context.kind === "agent" ? (
                      <AgentProfileLink
                        connectionId={conversation.connectionId}
                        terminalId={conversation.terminalId}
                      />
                    ) : null}
                  </TerminalAppearanceEditor>
                ) : undefined
              }
              paneMap={
                conversation.tabId && onSelectPane ? (
                  <InspectorPaneMap
                    workspaceId={conversation.workspaceId}
                    tabId={conversation.tabId}
                    tabLabel={
                      tabs.find((tab) => tab.tab_id === conversation.tabId)
                        ?.label
                    }
                    tabPanes={panes.filter(
                      (pane) =>
                        pane.workspace_id === conversation.workspaceId &&
                        pane.tab_id === conversation.tabId,
                    )}
                    workspace={workspace}
                    selectedPaneId={conversation.paneId}
                    onSelect={onSelectPane}
                  />
                ) : undefined
              }
              onWindowMaximize={onWindowMaximize}
              windowMaximized={windowMaximized}
              onDockOut={floating ? undefined : onDockOut}
              onDockIn={floating ? onDockIn : undefined}
              controlMode={floating ? "floating" : "docked"}
              windowMovable={!floating && !embedded}
              onClose={onClose}
              onBack={() => {
                if (conversation.view === "files") {
                  previewRequestRef.current += 1;
                  setFileSelection(emptyFile());
                  writeResourceFileSelection(worldLocalStorage, scope, null);
                } else {
                  setDiffSelection(emptyDiff());
                }
              }}
              context={{
                ...(townSkin && conversation.context.kind === "agent"
                  ? {
                      ...conversation.context,
                      portrait: townPortrait(conversation.nodeId),
                    }
                  : conversation.context),
                tabName:
                  tabs.find((tab) => tab.tab_id === conversation.tabId)
                    ?.label ??
                  conversation.context.tabName ??
                  "Terminal",
                appearanceAvatar:
                  conversation.paneId &&
                  conversation.terminalId &&
                  conversation.tabId
                    ? leafAppearance(appearance, {
                        connectionId: conversation.connectionId,
                        tabId: conversation.tabId,
                        nativeId: conversation.paneId,
                        terminalId: conversation.terminalId,
                        stale: presentationStale,
                        actionable: !presentationStale,
                      })?.avatar
                    : undefined,
              }}
              agentWorktree={worktree.view}
              presentationStale={presentationStale}
            />
          </Suspense>
        </div>
      </ResourceConnectionClientContext.Provider>
    </div>
  );

  return createPortal(
    // Town's window is always the dark panel, so its code viewers are too.
    // The provider stays in the tree in every view, so switching views does
    // not remount the Inspector.
    <ThemeScope.Provider value={townSkin ? "dark" : null}>
      {content}
    </ThemeScope.Provider>,
    portalOwner,
    worldInspectorWindowId(conversation),
  );
}
