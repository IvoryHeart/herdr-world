import {
  floatingTerminalGeometryId,
  readFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";
import { useLayoutPreferences } from "../layoutPreferences";
import { fitWindow, initialWindowRect } from "./windows/windowManager";
import {
  useWindowManager,
  useWindowWorkArea,
} from "./windows/useWindowManager";
import { visibleWindowIds } from "./windows/windowManager";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { worldLocalStorage } from "../browserStorage";
import { type WindowArrangementControl } from "../components/WindowArrangementMenu";
import { store } from "../store";
import {
  readInspectorPreferences,
  resourceScopeForWorkspace,
} from "../workspaceResource";
import { worldRuntimeStore, type WorldRuntimePriority } from "./runtimeStore";
import { type WorldLeafObject, type WorldObjectNode } from "./worldObject";
import {
  terminalWindowArrangementReason,
  type TerminalWindowArrangementPreset,
} from "./terminalWindowArrangement";
import {
  worldInspectorForNode,
  worldInspectorWindowId,
  worldInspectorWindowIdForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";
import {
  worldIntentViews,
  worldInspectorContext,
  worldSnapshotPriorityForNode,
  snapshotPriorityForConversation,
} from "./worldInspectorSelection";
import { type WorldControlPlaneProps } from "./worldControlPlaneContract";
import { Dispatch, SetStateAction, MutableRefObject } from "react";
import { type WorldObservation } from "./useWorldObservation";

type Input = Pick<
  WorldControlPlaneProps,
  | "active"
  | "view"
  | "inspectorConversations"
  | "onActiveInspectorChange"
  | "onDockedInspectorIdChange"
  | "onVisualArrangementControlReady"
> &
  Pick<
    WorldObservation,
    | "world"
    | "connectionSelection"
    | "aggregateWorld"
    | "officeInspectorPresentation"
  > & {
    pendingSurfacePriority: WorldRuntimePriority | null;
    selection: WorldObjectNode | null;
    setSelection: Dispatch<SetStateAction<WorldObjectNode | null>>;
    intentRequestRef: MutableRefObject<number>;
    inspectorConversationsRef: MutableRefObject<
      readonly WorldInspectorConversation[]
    >;
    onInspectorConversationsChangeRef: MutableRefObject<
      WorldControlPlaneProps["onInspectorConversationsChange"]
    >;
    onInspectorTerminalPortalRef: MutableRefObject<
      WorldControlPlaneProps["onInspectorTerminalPortal"]
    >;
  };

export function useWorldInspectorWindows({
  view,
  active,
  inspectorConversations,
  onDockedInspectorIdChange,
  onActiveInspectorChange,
  onVisualArrangementControlReady,
  connectionSelection,
  aggregateWorld,
  world,
  officeInspectorPresentation,
  selection,
  setSelection,
  pendingSurfacePriority,
  intentRequestRef,
  inspectorConversationsRef,
  onInspectorConversationsChangeRef,
  onInspectorTerminalPortalRef,
}: Input) {
  const [windowLayer, setWindowLayer] = useState<HTMLDivElement | null>(null);
  const windowStage = useWindowWorkArea(windowLayer, active);
  const { mobile: compactArrangement } = useLayoutPreferences();
  const windowInputs = useMemo(
    () =>
      inspectorConversations.map((conversation, index) => ({
        id: worldInspectorWindowId(conversation),
        label: `${conversation.label} · ${conversation.hostLabel}`,
        initialSnap:
          view === "desk" ||
          (view === "office" && officeInspectorPresentation === "docked")
            ? ("right" as const)
            : undefined,
        initialGeometry: readFloatingTerminalGeometry(
          worldLocalStorage,
          floatingTerminalGeometryId(conversation),
          initialWindowRect(index, windowStage),
          windowStage,
          JSON.stringify([conversation.connectionId, conversation.nodeId]),
          fitWindow,
        ),
      })),
    [inspectorConversations, windowStage, view, officeInspectorPresentation],
  );
  const { state: managedWindows, dispatch: windowCommand } = useWindowManager(
    windowInputs,
    windowStage,
  );
  const activeInspectorId = managedWindows.activeId;
  useLayoutEffect(
    () => onActiveInspectorChange(activeInspectorId),
    [activeInspectorId, onActiveInspectorChange],
  );
  const contextRailInspector = inspectorConversations.find(
    (conversation) =>
      worldInspectorWindowId(conversation) === activeInspectorId,
  );
  const visibleFloatingInspectorIds = new Set(
    visibleWindowIds(managedWindows, compactArrangement),
  );
  const visibleFloatingInspectors = inspectorConversations.filter(
    (conversation) =>
      visibleFloatingInspectorIds.has(worldInspectorWindowId(conversation)),
  );
  const raiseInspector = useCallback(
    (id: string, pointer = false) =>
      windowCommand({ type: pointer ? "raise" : "focus", id }),
    [windowCommand],
  );
  const revealInspector = useCallback(
    (id: string) => windowCommand({ type: "focus", id }),
    [windowCommand],
  );
  const conversationNodeIds = useMemo(
    () => inspectorConversations.map(({ nodeId }) => nodeId),
    [inspectorConversations],
  );
  const snapshotPriorities = useMemo(
    () => [
      ...(pendingSurfacePriority ? [pendingSurfacePriority] : []),
      ...(selection
        ? [worldSnapshotPriorityForNode(selection)].filter(
            (priority): priority is WorldRuntimePriority => priority !== null,
          )
        : []),
      ...inspectorConversations.map(snapshotPriorityForConversation),
    ],
    [inspectorConversations, pendingSurfacePriority, selection],
  );

  useLayoutEffect(() => {
    worldRuntimeStore.setVisibleConnectionIds(
      world.hosts
        .filter((host) =>
          connectionSelection.connections.some(
            (connection) => connection.id === host.connectionId,
          ),
        )
        .map((host) => host.connectionId),
    );
  }, [world, connectionSelection.connections]);

  useLayoutEffect(() => {
    worldRuntimeStore.setPriorities(
      snapshotPriorities.filter((priority) =>
        connectionSelection.connections.some(
          (connection) => connection.id === priority.connectionId,
        ),
      ),
    );
  }, [snapshotPriorities, connectionSelection.connections]);

  const availableWindowTabs = useMemo(() => {
    const tabs = new Map<string, WorldLeafObject>();
    for (const node of world.leaves) {
      if (
        !node.actionable ||
        !node.capabilities.openTerminal ||
        !connectionSelection.connections.some(
          (owner) =>
            owner.id === node.connectionId &&
            owner.state === "ready" &&
            owner.generation === node.generation,
        )
      )
        continue;
      const id = worldInspectorWindowIdForNode(node);
      if (!tabs.has(id) || node.focused) tabs.set(id, node);
    }
    return tabs;
  }, [world, connectionSelection.connections]);
  const pendingArrange = useRef(false);
  useLayoutEffect(() => {
    if (pendingArrange.current && windowStage.width > 0) {
      pendingArrange.current = false;
      windowCommand({
        type: "arrange",
        preset: "grid",
        includeMinimized: true,
      });
    }
  }, [inspectorConversations, windowStage.width, windowCommand]);
  const selectVisualArrangement = useCallback(
    (
      command:
        | TerminalWindowArrangementPreset
        | "restore"
        | "close-all"
        | "open-all",
    ) => {
      if (command === "open-all") {
        const uniqueTabs = availableWindowTabs;
        const omitted = Math.max(
          0,
          world.hosts.reduce((count, host) => count + host.coverage.tabs, 0) -
            uniqueTabs.size,
        );
        if (omitted > 0)
          store.notify({
            kind: "info",
            message: `Open all omitted ${omitted} observed ${omitted === 1 ? "tab" : "tabs"}`,
            detail:
              "Those tabs have no current available terminal target in the Hosts filter.",
          });
        const current = inspectorConversationsRef.current;
        const openIds = new Set(current.map(worldInspectorWindowId));
        const added: WorldInspectorConversation[] = [];
        const workspaces = new Map(
          world.spaces
            .filter((space) => space.actionable && !space.stale)
            .map((space) => [
              JSON.stringify([space.connectionId, space.nativeId]),
              space.workspace,
            ]),
        );
        for (const [id, node] of uniqueTabs) {
          if (openIds.has(id)) continue;
          const workspace = workspaces.get(
            JSON.stringify([node.connectionId, node.workspaceId]),
          );
          const context = worldInspectorContext(node);
          if (!workspace || !context) continue;
          const preferences = readInspectorPreferences(
            worldLocalStorage,
            resourceScopeForWorkspace(node.connectionId, workspace),
          );
          const conversation = worldInspectorForNode(
            node,
            "terminal",
            worldIntentViews(node),
            context,
            {
              dock: preferences.dock,
              expanded: preferences.expanded,
              size:
                preferences.dock === "right"
                  ? preferences.rightSize
                  : preferences.bottomSize,
            },
          );
          if (conversation) added.push(conversation);
        }

        const next = [...current, ...added];
        inspectorConversationsRef.current = next;
        onInspectorConversationsChangeRef.current(next);
        pendingArrange.current = true;
        return;
      }
      if (command === "close-all") {
        for (const conversation of inspectorConversationsRef.current)
          onInspectorTerminalPortalRef.current(
            worldInspectorWindowId(conversation),
            null,
          );
        inspectorConversationsRef.current = [];
        onInspectorConversationsChangeRef.current([]);
        onDockedInspectorIdChange(null);
        setSelection(null);
        return;
      }
      if (command === "restore") windowCommand({ type: "restore-layout" });
      else if (!compactArrangement || command === "single")
        windowCommand({ type: "arrange", preset: command });
    },
    [
      compactArrangement,
      onDockedInspectorIdChange,
      inspectorConversationsRef,
      onInspectorConversationsChangeRef,
      onInspectorTerminalPortalRef,
      setSelection,
      windowCommand,
      world,
      availableWindowTabs,
    ],
  );
  const visualArrangementControl = useMemo<WindowArrangementControl>(() => {
    const disabledReasons: WindowArrangementControl["disabledReasons"] = {};
    for (const preset of [
      "single",
      "cascade",
      "columns",
      "rows",
      "grid",
    ] as const) {
      const reason =
        compactArrangement && preset !== "single"
          ? "Available in desktop layout."
          : terminalWindowArrangementReason(
              preset,
              { left: 0, top: 0, ...windowStage },
              windowInputs
                .filter((input) => !managedWindows.windows[input.id]?.minimized)
                .map((input) => ({
                  ...input,
                  minWidth: Math.min(420, windowStage.width),
                  minHeight: Math.min(280, windowStage.height),
                })),
              activeInspectorId,
            );
      if (reason) disabledReasons[preset] = reason;
    }
    if (!managedWindows.baseline)
      disabledReasons.restore = "No arranged positions to restore.";
    if (!windowInputs.length)
      disabledReasons["close-all"] = "No windows are open.";
    if (!availableWindowTabs.size)
      disabledReasons["open-all"] =
        "No available terminal tabs in the Hosts filter.";
    else if (
      [...availableWindowTabs.keys()].every((id) => {
        const entry = managedWindows.windows[id];
        return entry && !entry.minimized && !entry.dismissed;
      })
    )
      disabledReasons["open-all"] = "All available tabs are already open.";
    return {
      activePreset:
        compactArrangement || managedWindows.focusMode
          ? "single"
          : (managedWindows.layout?.preset ?? null),
      disabledReasons,
      onSelect: selectVisualArrangement,
      windows: windowInputs.map((input) => ({
        id: input.id,
        tab: (() => {
          const conversation = inspectorConversations.find(
            (candidate) => worldInspectorWindowId(candidate) === input.id,
          );
          return conversation?.tabId
            ? {
                connectionId: conversation.connectionId,
                runtimeGeneration: conversation.runtimeGeneration,
                tabId: conversation.tabId,
              }
            : undefined;
        })(),
        label: input.label,
        active: input.id === activeInspectorId,
        minimized: managedWindows.windows[input.id]?.minimized ?? false,
        onSelect: () => {
          intentRequestRef.current++;
          windowCommand({ type: "focus", id: input.id });
          const conversation = inspectorConversationsRef.current.find(
            (candidate) => worldInspectorWindowId(candidate) === input.id,
          );
          if (conversation) {
            const node = aggregateWorld.nodeById.get(conversation.nodeId);
            if (node) setSelection(node);
          }
        },
      })),
    };
  }, [
    compactArrangement,
    windowStage,
    windowInputs,
    managedWindows,
    activeInspectorId,
    intentRequestRef,
    selectVisualArrangement,
    windowCommand,
    aggregateWorld,
    availableWindowTabs,
    inspectorConversations,
    inspectorConversationsRef,
    setSelection,
  ]);
  const arrangementRef = useRef(visualArrangementControl);
  arrangementRef.current = visualArrangementControl;
  const arrangementSignature = JSON.stringify([
    visualArrangementControl.activePreset,
    visualArrangementControl.disabledReasons,
    visualArrangementControl.windows?.map(
      ({ id, label, active, minimized, tab }) => ({
        id,
        label,
        active,
        minimized,
        tab,
      }),
    ),
  ]);
  useLayoutEffect(() => {
    const current = arrangementRef.current;
    onVisualArrangementControlReady({
      ...current,
      onSelect: (command) => arrangementRef.current.onSelect(command),
      windows: current.windows?.map((entry) => ({
        ...entry,
        onSelect: () =>
          arrangementRef.current.windows
            ?.find((candidate) => candidate.id === entry.id)
            ?.onSelect(),
      })),
    });
  }, [onVisualArrangementControlReady, arrangementSignature]);
  useLayoutEffect(
    () => () => onVisualArrangementControlReady(undefined),
    [onVisualArrangementControlReady],
  );
  return {
    setWindowLayer,
    windowStage,
    compactArrangement,
    managedWindows,
    windowCommand,
    activeInspectorId,
    contextRailInspector,
    visibleFloatingInspectorIds,
    visibleFloatingInspectors,
    raiseInspector,
    revealInspector,
    conversationNodeIds,
  };
}

export type WorldInspectorWindows = ReturnType<typeof useWorldInspectorWindows>;
