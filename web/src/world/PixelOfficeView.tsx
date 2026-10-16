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
import { OfficeNavigator } from "./OfficeNavigator";
import { officeRoomScrollOffset } from "./officeRoomPacking";
import { useOfficeViewport } from "./useOfficeViewport";
import { resolveOfficeAnchors } from "./officeRendererAnchors";
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
  const viewport = useOfficeViewport(scrollRef);
  const [collapsedRoomKeys, setCollapsedRoomKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const previousLayout = useRef<PublishedOfficeLayout | null>(null);
  const restoredLayoutMode = useRef<boolean | null>(null);
  const pendingScrollRestore = useRef<{
    revision: number;
    top: number;
    left: number;
  } | null>(null);
  const revealPending = useRef<string | null>(
    selectedId &&
      floatingTerminals.some((terminal) => terminal.nodeId === selectedId)
      ? officePresentationKey(office, selectedId)
      : null,
  );
  const [revealRequest, setRevealRequest] = useState(0);
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
    const onScroll = () => {
      if (restoredLayoutMode.current === null) return;
      const mode = previousLayout.current?.compact
        ? "compactScroll"
        : "desktopScroll";
      const next = {
        ...preferencesRef.current,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop,
        [mode]: { left: scroll.scrollLeft, top: scroll.scrollTop },
      };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroll.removeEventListener("scroll", onScroll);
    };
  }, []);

  const selectedKey = officePresentationKey(office, selectedId);
  const previousSelection = useRef(selectedKey);
  useEffect(() => {
    if (previousSelection.current !== selectedKey)
      revealPending.current = selectedKey;
    previousSelection.current = selectedKey;
  }, [selectedKey]);
  useEffect(() => {
    if (!layout || !selectedKey || revealPending.current !== selectedKey)
      return;
    const agent = office.roster.find(
      (entry) => entry.agent.key === selectedKey,
    )?.agent;
    const desk = office.deskRoster.find(
      (entry) => entry.desk.key === selectedKey,
    )?.desk;
    const pane = office.paneRoster.find(
      (entry) => entry.device.key === selectedKey,
    )?.device;
    const roomKey = agent?.roomKey ?? desk?.roomKey ?? pane?.roomKey;
    if (roomKey && collapsedRoomKeys.has(roomKey)) {
      setCollapsedRoomKeys((current) => {
        const next = new Set(current);
        next.delete(roomKey);
        return next;
      });
      return;
    }
    const scroll = scrollRef.current;
    if (!scroll || renderedRevision !== layout.layoutRevision) return;
    const anchors = resolveOfficeAnchors(
      office,
      layout,
      selectedKey,
      selectedKey,
    );
    const roomIndex = office.rooms.findIndex(
      (room) => room.key === selectedKey,
    );
    const room = layout.rooms.find((room) => room.index === roomIndex);
    const anchor = anchors.agent ?? anchors.workbench ?? room;
    if (!anchor) return;
    if (
      anchor.y < scroll.scrollTop + 10 ||
      anchor.y > scroll.scrollTop + scroll.clientHeight - 40 ||
      anchor.x < scroll.scrollLeft ||
      anchor.x > scroll.scrollLeft + scroll.clientWidth
    ) {
      scroll.scrollTo({
        top: Math.max(0, anchor.y - scroll.clientHeight / 3),
        left: layout.compact
          ? 0
          : Math.max(0, anchor.x - scroll.clientWidth / 2),
      });
    }
    revealPending.current = null;
  }, [
    selectedKey,
    layout,
    renderedRevision,
    office,
    collapsedRoomKeys,
    revealRequest,
  ]);
  const publishLayout = (next: PublishedOfficeLayout | null) => {
    const previous = previousLayout.current;
    const scroll = scrollRef.current;
    if (
      previous &&
      next &&
      previous.inputDigest !== next.inputDigest &&
      scroll
    ) {
      // A tall packed room can overlap many later headers vertically. Anchor
      // the closest visible header instead of always choosing that first room.
      const visible = previous.rooms
        .filter(
          (room) =>
            room.y + room.height > scroll.scrollTop &&
            room.y < scroll.scrollTop + scroll.clientHeight &&
            room.x + room.width > scroll.scrollLeft &&
            room.x < scroll.scrollLeft + scroll.clientWidth,
        )
        .reduce<(typeof previous.rooms)[number] | undefined>(
          (best, room) =>
            !best ||
            Math.abs(room.y - scroll.scrollTop) <
              Math.abs(best.y - scroll.scrollTop)
              ? room
              : best,
          undefined,
        );
      const descriptor = previous.normalizedInput.rooms.find(
        (room) => room.sourceIndex === visible?.index,
      );
      const nextDescriptor = next.normalizedInput.rooms.find(
        (room) => room.id === descriptor?.id,
      );
      const replacement = next.rooms.find(
        (room) => room.index === nextDescriptor?.sourceIndex,
      );
      if (visible && replacement && scroll.scrollTop >= previous.roomStartY) {
        const offset = scroll.scrollTop - visible.y;
        const adjusted = officeRoomScrollOffset(visible, replacement, offset);
        pendingScrollRestore.current = {
          revision: next.layoutRevision,
          top:
            replacement.y +
            Math.max(0, Math.min(adjusted, replacement.height - 1)),
          left: next.compact ? 0 : scroll.scrollLeft,
        };
      } else if (previous.compact !== next.compact) {
        const position = next.compact
          ? preferencesRef.current.compactScroll
          : preferencesRef.current.desktopScroll;
        pendingScrollRestore.current = {
          revision: next.layoutRevision,
          top: position?.top ?? 0,
          left: next.compact ? 0 : (position?.left ?? 0),
        };
      }
    }
    if ((!previous || restoredLayoutMode.current === null) && next) {
      const saved = next.compact
        ? preferencesRef.current.compactScroll
        : preferencesRef.current.desktopScroll;
      pendingScrollRestore.current = {
        revision: next.layoutRevision,
        top:
          saved?.top ?? (next.compact ? 0 : preferencesRef.current.scrollTop),
        left: next.compact
          ? 0
          : (saved?.left ?? preferencesRef.current.scrollLeft),
      };
    }
    previousLayout.current = next;
    setLayout(next);
  };
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
  const selectAndReveal = (nodeId: string) => {
    revealPending.current = officePresentationKey(office, nodeId);
    setRevealRequest((value) => value + 1);
    void onSelect(nodeId);
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
      selectAndReveal(agent.nodeId);
      return;
    }
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    if (desk) {
      const occupant = desk.occupantAgentKey
        ? office.roster.find(
            ({ agent: candidate }) => candidate.key === desk.occupantAgentKey,
          )?.agent
        : null;
      selectAndReveal(
        occupant?.nodeId ?? desk.terminalSelectionKeys[0] ?? desk.roomKey,
      );
      return;
    }
    selectAndReveal(key);
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
        <OfficeCompletionNotices
          agents={unseenCompletions}
          onInspect={(agent) => openOfficeTerminal(agent.key)}
        />
        <OfficeNavigator
          office={office}
          onReceptions={() => scrollRef.current?.scrollTo({ top: 0, left: 0 })}
          onAgent={(key) => {
            revealPending.current = key;
            setRevealRequest((value) => value + 1);
            openOfficeTerminal(key);
          }}
          onRoom={(key) => {
            revealPending.current = null;
            const scroll = scrollRef.current;
            if (!scroll) return;
            setCollapsedRoomKeys((current) => {
              if (!current.has(key)) return current;
              const next = new Set(current);
              next.delete(key);
              return next;
            });
            const index = office.rooms.findIndex((room) => room.key === key);
            const rect = layout?.rooms.find((room) => room.index === index);
            if (rect)
              scroll.scrollTo({
                top: rect.y,
                left: layout?.compact ? 0 : rect.x,
              });
          }}
        />
        <div ref={scrollRef} className="world-stage-scroll">
          <PixelOfficeCanvas
            projection={office}
            collapsedRoomKeys={collapsedRoomKeys}
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
            onLayoutChange={publishLayout}
            onCanvasRendered={(revision) => {
              setRenderedRevision(revision);
              const pending = pendingScrollRestore.current;
              if (
                pending &&
                revision === pending.revision &&
                scrollRef.current
              ) {
                pendingScrollRestore.current = null;
                restoredLayoutMode.current =
                  previousLayout.current?.compact === true;
                scrollRef.current.scrollTo({
                  top: pending.top,
                  left: pending.left,
                });
              }
            }}
            roomAlignment={preferences.roomAlignment}
            longRoomTitleMode={preferences.longTitleMode}
          >
            {layout ? (
              <>
                <OfficeSemanticTargetsOverlay
                  layout={layout}
                  viewport={viewport}
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
                  viewport={viewport}
                  projection={office}
                  renderedRevision={renderedRevision}
                  onToggleRoom={(key) =>
                    setCollapsedRoomKeys((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
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
