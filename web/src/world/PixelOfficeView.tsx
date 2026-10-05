import {
  useCreationProgress,
  creationPendingReason,
  creationFailureMessage,
} from "../creationRequests";
import { WorldSearchResults } from "./WorldSearchResults";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { worldLocalStorage } from "../browserStorage";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { ConfirmDialog, TextInputDialog } from "../components/ModalDialogs";
import {
  endpointCreationReason,
  connectionSnapshot,
  store,
  useStoreSelector,
} from "../store";
import { WORLD_OBSERVABILITY_UPDATED_EVENT } from "../workspaceResource";
import { PixelOfficeCanvas } from "./PixelOfficeCanvas";
import type {
  OfficeCanvasAnchor,
  OfficeCanvasHover,
  OfficeConversationAnchors,
} from "./PixelOfficeCanvas";
import { OfficeCanvasCallout } from "./OfficeCanvasCallout";
import { OfficeCompactTargetChooser } from "./OfficeCompactTargetChooser";
import { OfficeCompletionNotices } from "./OfficeCompletionNotices";
export { OfficeObservabilityDialog } from "./OfficeObservabilityDialog";
import {
  OfficeRoomActionsOverlay,
  OfficeSemanticTargetsOverlay,
} from "./OfficeRoomActionsOverlay";
import {
  createOfficeProjector,
  type OfficeAgent,
  type HerdrOfficeProjection,
} from "./herdrOfficeProjection";
import {
  EMPTY_OFFICE_OBSERVABILITY,
  fetchOfficeObservability,
  type OfficeObservability,
} from "./officeObservability";
import { officeCalloutForKey, officePresentationKey } from "./officeSelection";
import type { PublishedOfficeLayout } from "./officeLayout";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
  type OfficePreferences,
} from "./officePreferences";
import type { WorldObject } from "./worldObject";
import { WorldViewToolbar, worldSearchMatches } from "./WorldViewToolbar";
import {
  officeCreationActionState,
  officeRoomActionCapabilities,
  officeRoomKeyForSelection,
  type OfficeCreationActionState,
} from "./officeRoomActions";
import {
  officeCompletionIdentity,
  readCompletionSeen,
  writeCompletionSeen,
} from "./completionSeenState";
import { preferredOfficeConnectorAnchor } from "./worldConnectorGeometry";
import { officeCreationInputsEqual } from "./officeCreationInputs";

type RoomDialog =
  | {
      mode: "create";
      roomKey: string | null;
      owner?: { connectionId: string; runtimeGeneration: number };
    }
  | {
      mode: "rename" | "close";
      roomKey: string;
      label: string;
      owner: { connectionId: string; runtimeGeneration: number };
    };

export default function PixelOfficeView({
  world,
  toolbarPortal = null,
  selectedId,
  onSelect,
  onOpenTerminal,
  onSelectedAnchorChange,
  floatingTerminals,
  onConversationNodeAnchorsChange,
}: {
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  onSelect(id: string, signal?: AbortSignal): void | Promise<boolean>;
  onOpenTerminal(id: string, signal?: AbortSignal): Promise<void>;
  onSelectedAnchorChange?: (anchor: OfficeCanvasAnchor | null) => void;
  floatingTerminals: readonly { nodeId: string }[];
  onConversationNodeAnchorsChange?(
    anchors: Record<string, OfficeCanvasAnchor> | null,
  ): void;
}) {
  const projectOffice = useMemo(createOfficeProjector, []);
  const office = useMemo(
    (): HerdrOfficeProjection => projectOffice(world, Date.now(), selectedId),
    [world, selectedId, projectOffice],
  );
  // Terminal frames and unrelated store updates must not reconcile the scene.
  // These are exactly the inputs read by endpointCreationReason below.
  const creationProgress = useCreationProgress();
  const creationSnapshot = useStoreSelector(
    (snapshot) => snapshot,
    (previous, next) => officeCreationInputsEqual(previous, next, world.hosts),
  );
  const [preferences, setPreferences] = useState(() =>
    readOfficePreferences(worldLocalStorage),
  );
  const preferencesRef = useRef(preferences);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<PublishedOfficeLayout | null>(null);
  const [renderedRevision, setRenderedRevision] = useState(0);
  const [roomDialog, setRoomDialog] = useState<RoomDialog | null>(null);
  const [completionSeen, setCompletionSeen] = useState(() =>
    readCompletionSeen(worldLocalStorage),
  );
  const [sceneHover, setSceneHover] = useState<OfficeCanvasHover | null>(null);
  const [observability, setObservability] = useState<OfficeObservability>(
    EMPTY_OFFICE_OBSERVABILITY,
  );
  const [observabilityRevision, setObservabilityRevision] = useState(0);
  const [query, setQuery] = useState("");
  const searchMatches = useMemo(
    () => worldSearchMatches(world, query),
    [query, world],
  );
  preferencesRef.current = preferences;

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const next = await fetchOfficeObservability().catch(() => ({
        ...EMPTY_OFFICE_OBSERVABILITY,
        health: "degraded" as const,
        observedAt: Date.now(),
      }));
      if (!disposed) setObservability(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [observabilityRevision]);

  useEffect(() => {
    const refresh = () => setObservabilityRevision((value) => value + 1);
    window.addEventListener(WORLD_OBSERVABILITY_UPDATED_EVENT, refresh);
    return () =>
      window.removeEventListener(WORLD_OBSERVABILITY_UPDATED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const refresh = (event: Event) => {
      const next =
        event instanceof CustomEvent && event.detail
          ? (event.detail as OfficePreferences)
          : readOfficePreferences(worldLocalStorage);
      preferencesRef.current = next;
      setPreferences(next);
    };
    window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(
        WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
        refresh,
      );
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const frame = requestAnimationFrame(() => {
      scroll.scrollLeft = preferencesRef.current.scrollLeft;
      scroll.scrollTop = preferencesRef.current.scrollTop;
    });
    const onScroll = () => {
      const next = {
        ...preferencesRef.current,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
      };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", onScroll);
    };
  }, []);

  const selectedKey = officePresentationKey(office, selectedId);
  const completionSeenKeys = useMemo(
    () =>
      new Set(
        completionSeen.size === 0
          ? []
          : office.roster
              .filter(({ agent }) =>
                completionSeen.has(officeCompletionIdentity(agent)),
              )
              .map(({ agent }) => agent.key),
      ),
    [completionSeen, office],
  );
  const unseenCompletions = useMemo(
    () =>
      office.roster
        .filter(
          ({ agent }) =>
            agent.semanticStatus === "done" &&
            agent.deskKey !== null &&
            !completionSeenKeys.has(agent.key),
        )
        .map(({ agent }) => agent)
        .sort(
          (left, right) =>
            Number(right.canOpenInSpaces) - Number(left.canOpenInSpaces) ||
            left.displayLabel.localeCompare(right.displayLabel) ||
            left.key.localeCompare(right.key),
        ),
    [completionSeenKeys, office],
  );
  const selectedRoomKey = officeRoomKeyForSelection(world, selectedId);
  const conversationTargets = floatingTerminals.flatMap((terminal) => {
    const targetKey = officePresentationKey(office, terminal.nodeId);
    return targetKey
      ? [
          {
            id: terminal.nodeId,
            selectedKey: targetKey,
            targetKey,
          },
        ]
      : [];
  });

  const roomForKey = (roomKey: string | null) =>
    roomKey
      ? (office.rooms.find(
          (room) =>
            room.key === roomKey &&
            (!roomDialog?.owner ||
              roomDialog.roomKey !== roomKey ||
              (room.workspaceRef.connectionId ===
                roomDialog.owner.connectionId &&
                room.workspaceRef.generation ===
                  roomDialog.owner.runtimeGeneration)),
        ) ?? null)
      : null;
  const seatCreationStates = useMemo(
    () =>
      Object.fromEntries(
        office.rooms.map((room) => {
          const admitted = officeRoomActionCapabilities(world, room).createSeat;
          return [
            room.key,
            officeCreationActionState(
              admitted,
              admitted
                ? (creationPendingReason(
                    {
                      connectionId: room.workspaceRef.connectionId,
                      runtimeGeneration: room.workspaceRef.generation,
                    },
                    "tab",
                    room.workspaceRef.nativeId,
                    creationProgress,
                  ) ??
                    endpointCreationReason(
                      connectionSnapshot(
                        creationSnapshot,
                        room.workspaceRef.connectionId,
                      ),
                      "tab.create",
                      room.workspaceRef.nativeId,
                    ))
                : null,
            ),
          ];
        }),
      ) as Record<string, OfficeCreationActionState>,
    [creationSnapshot, creationProgress, office.rooms, world],
  );
  const seatCreationState = (roomKey: string) =>
    seatCreationStates[roomKey] ?? officeCreationActionState(false, null);
  const showCreateSeat = (roomKey: string) =>
    seatCreationState(roomKey).visible;
  const canCreateSeat = (roomKey: string) => seatCreationState(roomKey).enabled;
  const createSeatReason = (roomKey: string) =>
    seatCreationState(roomKey).reason;
  const roomCreationState = (roomKey: string | null) => {
    const room = roomForKey(roomKey);
    const destination = room
      ? world.hosts.find(
          (host) =>
            host.connectionId === room.workspaceRef.connectionId &&
            host.generation === room.workspaceRef.generation,
        )
      : world.hosts.find((host) => host.actionable && !host.stale);
    const admitted = Boolean(destination?.actionable && !destination.stale);
    return officeCreationActionState(
      admitted,
      admitted
        ? endpointCreationReason(
            connectionSnapshot(creationSnapshot, destination!.connectionId),
            "workspace.create",
            room?.workspaceRef.nativeId,
          )
        : null,
    );
  };
  const showCreateRoom = (roomKey: string | null) =>
    roomCreationState(roomKey).visible;
  const canCreateRoom = (roomKey: string | null) =>
    roomCreationState(roomKey).enabled;
  const createRoomReason = (roomKey: string | null) =>
    roomCreationState(roomKey).reason;
  const canManageRoom = (roomKey: string, action: "rename" | "close") => {
    const room = roomForKey(roomKey);
    if (!room) return false;
    return officeRoomActionCapabilities(world, room)[action];
  };
  const reportRoomActionFailure = (action: string, cause: unknown) => {
    store.notify({
      kind: "error",
      message: `${action} failed`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  };
  const createSeat = async (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room || !canCreateSeat(roomKey)) return;
    try {
      await store.createQualifiedTab(
        {
          connectionId: room.workspaceRef.connectionId,
          runtimeGeneration: room.observedGeneration,
        },
        room.workspaceRef.nativeId,
        { numberedLabel: true },
      );
    } catch (cause) {
      store.notify({
        kind: "error",
        message: creationFailureMessage(cause, "Tab"),
        detail: String(cause),
      });
    }
  };
  const submitRenameRoom = async (label: string) => {
    if (
      roomDialog?.mode !== "rename" ||
      !canManageRoom(roomDialog.roomKey, "rename")
    ) {
      return;
    }
    const room = roomForKey(roomDialog.roomKey);
    if (!room) return;
    setRoomDialog(null);
    const value = label.trim();
    if (value && value !== roomDialog.label) {
      try {
        await store.renameQualifiedWorkspace(
          {
            connectionId: room.workspaceRef.connectionId,
            runtimeGeneration: room.observedGeneration,
          },
          room.workspaceRef.nativeId,
          value,
        );
      } catch (cause) {
        reportRoomActionFailure("Room rename", cause);
      }
    }
  };
  const closeRoom = async (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room || !canManageRoom(roomKey, "close")) return;
    setRoomDialog(null);
    try {
      await store.closeQualifiedWorkspace(
        {
          connectionId: room.workspaceRef.connectionId,
          runtimeGeneration: room.observedGeneration,
        },
        room.workspaceRef.nativeId,
      );
    } catch (cause) {
      reportRoomActionFailure("Room close", cause);
    }
  };
  const selectOfficeKey = (key: string) => {
    const device = office.paneRoster.find(
      ({ device }) => device.key === key,
    )?.device;
    if (device) {
      openOfficeTerminal(device.key);
      return;
    }
    const agent = office.roster.find(({ agent }) => agent.key === key)?.agent;
    if (agent) {
      onSelect(agent.nodeId);
      return;
    }
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    if (desk) {
      const occupant = desk.occupantAgentKey
        ? office.roster.find(
            ({ agent: candidate }) => candidate.key === desk.occupantAgentKey,
          )?.agent
        : null;
      onSelect(
        occupant?.nodeId ?? desk.terminalSelectionKeys[0] ?? desk.roomKey,
      );
      return;
    }
    onSelect(key);
  };
  const markCompletionSeen = (agent: OfficeAgent) => {
    setCompletionSeen((current) => {
      const next = new Set(current);
      next.add(officeCompletionIdentity(agent));
      writeCompletionSeen(worldLocalStorage, next);
      return next;
    });
  };
  const inspectOfficeTerminal = async (key: string) => {
    const device = office.paneRoster.find(
      ({ device }) => device.key === key,
    )?.device;
    if (device) {
      await onOpenTerminal(device.nodeId);
      return;
    }
    const agent = office.roster.find(({ agent }) => agent.key === key)?.agent;
    if (agent) {
      await onOpenTerminal(agent.nodeId);
      if (agent.semanticStatus === "done") markCompletionSeen(agent);
      return;
    }
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    if (!desk) return;
    const occupant = desk.occupantAgentKey
      ? office.roster.find(
          ({ agent: candidate }) => candidate.key === desk.occupantAgentKey,
        )?.agent
      : null;
    const nodeId = occupant?.nodeId ?? desk.terminalSelectionKeys[0];
    if (nodeId) await onOpenTerminal(nodeId);
  };
  const openOfficeTerminal = (key: string) => {
    void inspectOfficeTerminal(key).catch(() => undefined);
  };

  if (!world.hosts.length) {
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );
  }

  const toolbar = (
    <WorldViewToolbar
      viewLabel="Office"
      query={query}
      onQueryChange={setQuery}
      resultLabel={
        query.trim()
          ? searchMatches.length
            ? `${searchMatches.length} matches · Enter to select`
            : "No matches"
          : undefined
      }
      onSubmit={() => {
        const match = searchMatches[0];
        if (match) void onSelect(match.id);
      }}
    />
  );

  return (
    <>
      {toolbarPortal ? createPortal(toolbar, toolbarPortal) : toolbar}
      <WorldSearchResults world={world} query={query} onSelect={onSelect} />
      <div className="world-office-shell world-stage-shell">
        <OfficeCompactTargetChooser
          projection={office}
          selectedKey={selectedKey}
          onSelect={selectOfficeKey}
          onActivateAgent={openOfficeTerminal}
          onActivateDesk={openOfficeTerminal}
        />
        <OfficeCompletionNotices
          agents={unseenCompletions}
          onInspect={(agent) => openOfficeTerminal(agent.key)}
        />
        <div ref={scrollRef} className="world-stage-scroll">
          <PixelOfficeCanvas
            projection={office}
            selectedKey={selectedKey}
            completionSeenKeys={completionSeenKeys}
            observability={observability}
            conversationTargets={conversationTargets}
            onSelect={selectOfficeKey}
            onActivateAgent={openOfficeTerminal}
            onActivateRoom={selectOfficeKey}
            seatCreationStates={seatCreationStates}
            onNewSeat={(roomKey) => void createSeat(roomKey)}
            onHover={setSceneHover}
            onSelectedAnchorChange={onSelectedAnchorChange}
            onAnchorChange={(anchors: OfficeConversationAnchors | null) => {
              onConversationNodeAnchorsChange?.(
                anchors
                  ? Object.fromEntries(
                      Object.entries(anchors).flatMap(([id, value]) => {
                        const anchor = preferredOfficeConnectorAnchor(value);
                        return anchor ? [[id, anchor]] : [];
                      }),
                    )
                  : null,
              );
            }}
            onLayoutChange={setLayout}
            onCanvasRendered={setRenderedRevision}
            roomAlignment={preferences.roomAlignment}
            longRoomTitleMode={preferences.longTitleMode}
          >
            {layout ? (
              <>
                <OfficeSemanticTargetsOverlay
                  layout={layout}
                  projection={office}
                  renderedRevision={renderedRevision}
                  selectedKey={selectedKey}
                  onSelect={selectOfficeKey}
                  onActivateAgent={openOfficeTerminal}
                  onActivateDesk={openOfficeTerminal}
                  onActivateRoom={selectOfficeKey}
                />
                <OfficeRoomActionsOverlay
                  layout={layout}
                  projection={office}
                  renderedRevision={renderedRevision}
                  selectedRoomKey={selectedRoomKey}
                  showCreateSeat={showCreateSeat}
                  canCreateSeat={canCreateSeat}
                  createSeatReason={createSeatReason}
                  onCreateSeat={(roomKey) => void createSeat(roomKey)}
                  showCreateRoom={showCreateRoom}
                  canCreateRoom={canCreateRoom}
                  createRoomReason={createRoomReason}
                  onCreateRoom={(roomKey) =>
                    setRoomDialog({
                      mode: "create",
                      roomKey,
                      ...(roomForKey(roomKey)
                        ? {
                            owner: {
                              connectionId:
                                roomForKey(roomKey)!.workspaceRef.connectionId,
                              runtimeGeneration:
                                roomForKey(roomKey)!.workspaceRef.generation,
                            },
                          }
                        : {}),
                    })
                  }
                  canRenameRoom={(roomKey) => canManageRoom(roomKey, "rename")}
                  onRenameRoom={(roomKey) => {
                    const room = roomForKey(roomKey);
                    if (room) {
                      setRoomDialog({
                        mode: "rename",
                        roomKey,
                        label: room.displayLabel,
                        owner: {
                          connectionId: room.workspaceRef.connectionId,
                          runtimeGeneration: room.workspaceRef.generation,
                        },
                      });
                    }
                  }}
                  canCloseRoom={(roomKey) => canManageRoom(roomKey, "close")}
                  onCloseRoom={(roomKey) => {
                    const room = roomForKey(roomKey);
                    if (room) {
                      setRoomDialog({
                        mode: "close",
                        roomKey,
                        label: room.displayLabel,
                        owner: {
                          connectionId: room.workspaceRef.connectionId,
                          runtimeGeneration: room.workspaceRef.generation,
                        },
                      });
                    }
                  }}
                />
              </>
            ) : null}
          </PixelOfficeCanvas>
        </div>
        {sceneHover && sceneHover.key !== selectedKey ? (
          <OfficeCanvasCallout
            callout={officeCalloutForKey(office, sceneHover.key)}
            left={sceneHover.clientX}
            top={sceneHover.clientY}
          />
        ) : null}
        <CreateWorkspaceDialog
          open={roomDialog?.mode === "create"}
          initialDestination={
            roomDialog?.owner
              ? {
                  ...roomDialog.owner,
                  sourceWorkspaceId: roomForKey(roomDialog.roomKey)
                    ?.workspaceRef.nativeId,
                }
              : undefined
          }
          onClose={() => setRoomDialog(null)}
        />
        <TextInputDialog
          open={roomDialog?.mode === "rename"}
          title="Rename room"
          label="Room name"
          initialValue={roomDialog?.mode === "rename" ? roomDialog.label : ""}
          submitLabel="Rename"
          onClose={() => setRoomDialog(null)}
          onSubmit={(label) => void submitRenameRoom(label)}
        />
        <ConfirmDialog
          open={roomDialog?.mode === "close"}
          title="Close room"
          message={
            roomDialog?.mode === "close"
              ? `Close room “${roomDialog.label}”? Its running terminal sessions will end.`
              : ""
          }
          confirmLabel="Close room"
          danger
          onClose={() => setRoomDialog(null)}
          onConfirm={() => {
            if (roomDialog?.mode === "close") {
              void closeRoom(roomDialog.roomKey);
            }
          }}
        />
      </div>
    </>
  );
}
