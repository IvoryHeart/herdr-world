import {
  creationPendingReason,
  creationFailureMessage,
} from "../creationRequests";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  History,
  LayoutGrid,
  Pin,
  PinOff,
  Terminal,
} from "lucide-react";
import type { CommandExtension } from "../components/CommandCombobox";
import { connectionSnapshot, endpointCreationReason, store } from "../store";
import {
  resolveVisualRouteActionTarget,
  visualRouteActionsForNode,
  visualRouteActionTarget,
  visualRouteTargetLabel,
  type VisualRouteAction,
  type VisualRouteActionTarget,
} from "./visualRouteActions";
import { focusWorldNode } from "./worldInspectorSelection";
import { type WorldInspectorController } from "./useWorldInspectorController";
import { EMPTY_VISUAL_ACTION_EXTENSION } from "./worldControlPlaneContract";

export function useWorldVisualActions(controller: WorldInspectorController) {
  const {
    active,
    onVisualActionExtensionReady,
    onGoToSpaces,
    watchlistStore,
    watchlist,
    pinnedOnly,
    setPinnedOnly,
    connectionSelection,
    operationalSnapshot,
    world,
    setSelection,
    watchStatus,
    intentRequestRef,
    creationProgress,
    setIntentOpening,
    setIntentError,
    selected,
    applySelection,
  } = controller;

  const shellActionContext = useRef({
    selected,
    world,
    activeConnectionId: connectionSelection.activeConnectionId,
    runtimeGeneration: connectionSelection.runtimeGeneration,
    applySelection,
    focusWorldNode,
    onGoToSpaces,
    watchlistVerified: watchlist.verified,
    watchlistRecords: watchlist.records,
  });
  shellActionContext.current = {
    selected,
    world,
    activeConnectionId: connectionSelection.activeConnectionId,
    runtimeGeneration: connectionSelection.runtimeGeneration,
    applySelection,
    focusWorldNode,
    onGoToSpaces,
    watchlistVerified: watchlist.verified,
    watchlistRecords: watchlist.records,
  };
  const runVisualResource = useCallback(
    (target: VisualRouteActionTarget, action: VisualRouteAction) => {
      const current = shellActionContext.current;
      const resolved = resolveVisualRouteActionTarget(target, current.world, {
        activeConnectionId: target.connectionId,
        runtimeGeneration:
          current.world.nodeById.get(target.id)?.generation ?? null,
        selectedId: current.selected?.id ?? null,
      });
      if (
        !resolved.node ||
        !visualRouteActionsForNode(resolved.node).includes(action)
      ) {
        setIntentError(
          resolved.reason ?? "The selected action is no longer available.",
        );
        return;
      }
      if (action !== "spaces") {
        void current.applySelection(resolved.node.id, action);
        return;
      }
      const node = resolved.node;
      const requestId = intentRequestRef.current + 1;
      intentRequestRef.current = requestId;
      setIntentError(null);
      setIntentOpening(true);
      void store
        .activateQualifiedSpacesTarget({
          connectionId: node.connectionId,
          runtimeGeneration: node.generation,
          workspaceId:
            node.kind === "space"
              ? node.nativeId
              : node.kind === "host"
                ? ""
                : node.workspaceId,
          paneId:
            node.kind === "agent" || node.kind === "terminal"
              ? node.nativeId
              : null,
        })
        .then((focused) => {
          if (!focused)
            throw new Error("The Spaces target is no longer available");
          if (intentRequestRef.current !== requestId) return;
          const owner = store
            .get()
            .connections.find(
              (connection) => connection.id === node.connectionId,
            );
          if (owner?.state !== "ready" || owner.generation !== node.generation)
            return;
          setSelection(node);
          current.onGoToSpaces();
        })
        .catch((cause: unknown) => {
          if (intentRequestRef.current === requestId)
            setIntentError(
              cause instanceof Error ? cause.message : String(cause),
            );
        })
        .finally(() => {
          if (intentRequestRef.current === requestId) setIntentOpening(false);
        });
    },
    [intentRequestRef, setSelection, setIntentError, setIntentOpening],
  );
  const [workspaceCreationOpen, setWorkspaceCreationOpen] = useState(false);
  const [workspaceCreationDestination, setWorkspaceCreationDestination] =
    useState<{
      connectionId: string;
      runtimeGeneration: number;
      sourceWorkspaceId?: string;
    }>();
  const visualActionExtension = useMemo<CommandExtension>(() => {
    const target = visualRouteActionTarget(selected);
    const resolved = resolveVisualRouteActionTarget(target, world, {
      activeConnectionId: target?.connectionId ?? "",
      runtimeGeneration: target
        ? (world.nodeById.get(target.id)?.generation ?? null)
        : null,
      selectedId: selected?.id ?? null,
    });
    const labels: Record<VisualRouteAction, string> = {
      terminal: "Open Terminal",
      files: "Open Files",
      changes: "Open Changes",
      commits: "Open Git History",
      history: "Open Agent History",
      spaces: "Go to Spaces",
    };
    const icons = {
      terminal: <Terminal size={15} />,
      files: <FolderOpen size={15} />,
      changes: <LayoutGrid size={15} />,
      commits: <History size={15} />,
      history: <History size={15} />,
      spaces: <LayoutGrid size={15} />,
    };
    const targetActions =
      target && resolved.node
        ? visualRouteActionsForNode(resolved.node).map((action) => ({
            key: `visual-${action}`,
            icon: icons[action],
            title: labels[action],
            detail: visualRouteTargetLabel(resolved.node!),
            keywords: ["visual", "inspector", action],
            run: () => runVisualResource(target, action),
          }))
        : [
            {
              key: "visual-select-target",
              icon: <LayoutGrid size={15} />,
              title: "Select a visual entity for target actions",
              detail: resolved.reason ?? undefined,
              disabledReason:
                resolved.reason ?? "Select a space, agent, or terminal first.",
              run: () => {},
            },
          ];
    const workspaceId =
      resolved.node?.kind === "space"
        ? resolved.node.nativeId
        : resolved.node && resolved.node.kind !== "host"
          ? resolved.node.workspaceId
          : undefined;
    const creationActions = [
      {
        key: "visual-new-workspace",
        icon: <LayoutGrid size={15} />,
        title: "New workspace",
        detail: "Confirm a destination host",
        keywords: ["new", "create", "workspace", "room"],
        disabledReason: operationalSnapshot.connections.some(
          (connection) => connection.state === "ready",
        )
          ? null
          : "No destination host is ready.",
        run: () => {
          setWorkspaceCreationDestination(
            resolved.node
              ? {
                  connectionId: resolved.node.connectionId,
                  runtimeGeneration: resolved.node.generation,
                  sourceWorkspaceId: workspaceId,
                }
              : undefined,
          );
          setWorkspaceCreationOpen(true);
        },
      },
      {
        key: "visual-new-tab",
        icon: <Terminal size={15} />,
        title: "New tab",
        detail: resolved.node
          ? visualRouteTargetLabel(resolved.node)
          : "Select a workspace, agent or terminal",
        keywords: ["new", "create", "tab", "desk", "seat"],
        disabledReason:
          resolved.node && workspaceId
            ? (creationPendingReason(
                {
                  connectionId: resolved.node.connectionId,
                  runtimeGeneration: resolved.node.generation,
                },
                "tab",
                workspaceId,
                creationProgress,
              ) ??
              endpointCreationReason(
                connectionSnapshot(
                  operationalSnapshot,
                  resolved.node.connectionId,
                ),
                "tab.create",
                workspaceId,
                resolved.node.kind === "agent" ||
                  resolved.node.kind === "terminal"
                  ? resolved.node.nativeId
                  : undefined,
              ))
            : (resolved.reason ??
              "Select a workspace, agent or terminal first."),
        run: () => {
          const current = shellActionContext.current;
          const checked = resolveVisualRouteActionTarget(
            target,
            current.world,
            {
              activeConnectionId: target?.connectionId ?? "",
              runtimeGeneration: target?.runtimeGeneration ?? null,
              selectedId: current.selected?.id ?? null,
            },
          );
          if (!checked.node || checked.node.kind === "host") {
            setIntentError(checked.reason ?? "Select a workspace first.");
            return;
          }
          const workspaceId =
            checked.node.kind === "space"
              ? checked.node.nativeId
              : checked.node.workspaceId;
          void store
            .createQualifiedTab(
              {
                connectionId: checked.node.connectionId,
                runtimeGeneration: checked.node.generation,
              },
              workspaceId,
              {
                numberedLabel: true,
                sourcePaneId:
                  checked.node.kind === "agent" ||
                  checked.node.kind === "terminal"
                    ? checked.node.nativeId
                    : undefined,
              },
            )
            .catch((error) =>
              store.notify({
                kind: "error",
                message: creationFailureMessage(error, "Tab"),
                detail: String(error),
              }),
            );
        },
      },
    ];
    const pinNode =
      resolved.node &&
      (resolved.node.kind === "agent" || resolved.node.kind === "terminal")
        ? resolved.node
        : null;
    const selectedPinned = Boolean(
      pinNode &&
        watchlist.records.some(
          (record) =>
            record.connectionId === pinNode.connectionId &&
            record.generation === pinNode.generation &&
            record.terminalId === pinNode.terminalId,
        ),
    );
    const pinAction = pinNode
      ? [
          {
            key: "visual-pin",
            icon: selectedPinned ? <PinOff size={15} /> : <Pin size={15} />,
            title: selectedPinned ? "Unpin selected pane" : "Pin selected pane",
            detail: pinNode.label,
            disabledReason: watchlist.verified
              ? null
              : (watchlist.error ?? "Watches unavailable while disconnected"),
            run: () => {
              const current = shellActionContext.current;
              const checked = resolveVisualRouteActionTarget(
                target,
                current.world,
                {
                  activeConnectionId: target?.connectionId ?? "",
                  runtimeGeneration: target
                    ? (current.world.nodeById.get(target.id)?.generation ??
                      null)
                    : null,
                  selectedId: current.selected?.id ?? null,
                },
              );
              if (
                !checked.node ||
                (checked.node.kind !== "agent" &&
                  checked.node.kind !== "terminal") ||
                !current.watchlistVerified ||
                !checked.node.terminalId
              ) {
                setIntentError(
                  checked.reason ?? "The selected pane is unavailable.",
                );
                return;
              }
              const watch = {
                connectionId: checked.node.connectionId,
                generation: checked.node.generation,
                terminalId: checked.node.terminalId,
                label: checked.node.label,
              };
              const pinned = current.watchlistRecords.some(
                (record) =>
                  record.connectionId === watch.connectionId &&
                  record.generation === watch.generation &&
                  record.terminalId === watch.terminalId,
              );
              void watchlistStore.mutate(
                pinned ? "world.watchlist.unpin" : "world.watchlist.pin",
                watch,
              );
            },
          },
        ]
      : [];
    return {
      context: resolved.node
        ? {
            connectionId: resolved.node.connectionId,
            runtimeGeneration: resolved.node.generation,
          }
        : undefined,
      captureKey: resolved.node && target ? JSON.stringify(target) : null,
      groups: [
        { heading: "Create", actions: creationActions },
        { heading: "Visual selection", actions: targetActions },
        {
          heading: "Pinned panes",
          actions: [
            ...pinAction,
            {
              key: "visual-pinned-only",
              icon: <Pin size={15} />,
              title: pinnedOnly ? "Show all panes" : "Pinned only",
              detail: watchStatus,
              run: () => setPinnedOnly((value) => !value),
            },
          ],
        },
      ],
    };
  }, [
    operationalSnapshot,
    creationProgress,
    setIntentError,
    setPinnedOnly,
    selected,
    world,
    watchlist.records,
    watchlist.verified,
    watchlist.error,
    pinnedOnly,
    watchStatus,
    watchlistStore,
    runVisualResource,
  ]);
  useLayoutEffect(() => {
    onVisualActionExtensionReady(
      active ? visualActionExtension : EMPTY_VISUAL_ACTION_EXTENSION,
    );
    return () => onVisualActionExtensionReady(EMPTY_VISUAL_ACTION_EXTENSION);
  }, [active, onVisualActionExtensionReady, visualActionExtension]);
  return {
    workspaceCreationOpen,
    setWorkspaceCreationOpen,
    workspaceCreationDestination,
  };
}
