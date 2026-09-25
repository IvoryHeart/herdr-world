import {
  Suspense,
  useCallback,
  useEffect,
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
import { shallowEqual, useStoreSelector } from "../store";
import type { FileExplorerEntry, GitDiffEntry } from "../types";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../useConnectionClient";
import { useReviewAnnotationDraft } from "../useReviewAnnotationDraft";
import {
  readResourceFileSelection,
  resourceScopeForWorkspace,
  writeInspectorPreferences,
  writeResourceFileSelection,
  type InspectorDock,
  type InspectorView,
  type WorkspaceInspectorState,
  WORKSPACE_ANNOTATION_REQUEST_EVENT,
  type WorkspaceAnnotationRequest,
} from "../workspaceResource";
import type { WorldInspectorConversation } from "./worldTerminalPresentation";

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

export default function WorldInspectorConversationView({
  conversation,
  target,
  floating,
  embedded = false,
  onChange,
  onClose,
  onDockOut,
  onDockIn,
  onFocus,
  onTerminalPortalChange,
}: {
  conversation: WorldInspectorConversation;
  target: Element | null;
  floating: boolean;
  embedded?: boolean;
  onChange(change: Partial<WorldInspectorConversation>): void;
  onClose(): void;
  onDockOut?(): void;
  onDockIn?(): void;
  onFocus?(): void;
  onTerminalPortalChange(element: HTMLDivElement | null): void;
}) {
  const connectionClient = useConnectionClient();
  const runtimeKey = connectionClientScopeKey(
    connectionClient,
    "world-inspector",
  );
  const { workspaces, panes } = useStoreSelector(
    (snapshot) => ({
      workspaces: snapshot.workspaces,
      panes: snapshot.panes,
    }),
    shallowEqual,
  );
  const workspace = workspaces.find(
    (candidate) => candidate.workspace_id === conversation.workspaceId,
  );
  const historyPane = conversation.paneId
    ? panes.find((candidate) => candidate.pane_id === conversation.paneId)
    : undefined;
  const scope = useMemo(
    () =>
      workspace
        ? resourceScopeForWorkspace(conversation.connectionId, workspace)
        : null,
    [conversation.connectionId, workspace],
  );
  const [changesScope, setChangesScope] = useState<"agent" | "workspace">(
    conversation.context.kind === "agent" ? "agent" : "workspace",
  );
  useEffect(() => {
    setChangesScope(
      conversation.context.kind === "agent" ? "agent" : "workspace",
    );
  }, [conversation.context.kind, conversation.resourceIdentity]);
  const [fileSelection, setFileSelection] =
    useState<ActiveFilePreviewSelection>(emptyFile);
  const [diffSelection, setDiffSelection] =
    useState<ActiveDiffSelection>(emptyDiff);
  const previewRequestRef = useRef(0);
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
  }, [onFocus, target]);
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
      if (!workspace) return;
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
    [connectionClient, workspace],
  );

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

  if (!scope || !target) return null;

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
    onChange({ view });
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

  const content = (
    <div
      className={
        floating
          ? "world-floating-inspector-content"
          : `workspace-stage world-inspector-stage inspector-dock-${conversation.dock} ${
              conversation.expanded ? "is-inspector-expanded" : ""
            }`
      }
    >
      <div className="workspace-inspector-slot">
        <Suspense fallback={null}>
          <WorkspaceInspectorHost
            state={inspectorState}
            visible
            workspace={workspace}
            historyPane={historyPane}
            fileSelection={fileSelection}
            previewRequestRef={previewRequestRef}
            diffSelection={diffSelection}
            connectionClient={connectionClient}
            onFileSelectionChange={setFileSelection}
            onDiffSelectionChange={setDiffSelection}
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
            onOpenDocument={openFile}
            onRefreshFile={() => {
              if (fileSelection.entry) {
                loadFile(fileSelection.entry, fileSelection.fragment);
              }
            }}
            onTerminalPortalChange={setTerminalPortal}
            onViewChange={changeView}
            onDockChange={changeDock}
            onExpandedChange={changeExpanded}
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
            context={conversation.context}
            agentCheckout={
              conversation.view === "changes" &&
              conversation.context.kind === "agent" &&
              changesScope === "agent"
                ? {
                    paneId: conversation.paneId,
                    sessionFingerprint: conversation.agentSessionFingerprint,
                    onWorkspaceChanges: () => setChangesScope("workspace"),
                  }
                : undefined
            }
          />
        </Suspense>
      </div>
    </div>
  );

  return createPortal(content, target, conversation.nodeId);
}
