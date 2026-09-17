import { useEffect, useMemo, useRef, useState } from "react";
import { worldLocalStorage } from "../browserStorage";
import { ConfirmDialog, TextInputDialog } from "../components/ModalDialogs";
import { endpointCreationReason, store } from "../store";
import { PixelOfficeCanvas } from "./PixelOfficeCanvas";
import type {
  OfficeCanvasAnchor,
  OfficeCanvasHover,
  OfficeConversationAnchors,
} from "./PixelOfficeCanvas";
import { OfficeCanvasCallout } from "./OfficeCanvasCallout";
import { OfficeCompactTargetChooser } from "./OfficeCompactTargetChooser";
import { OfficeCompletionNotices } from "./OfficeCompletionNotices";
import {
  OfficeRoomActionsOverlay,
  OfficeSemanticTargetsOverlay,
} from "./OfficeRoomActionsOverlay";
import {
  projectWorldOffice,
  type OfficeAgent,
  type HerdrOfficeProjection,
} from "./herdrOfficeProjection";
import { EMPTY_OFFICE_OBSERVABILITY } from "./officeObservability";
import { officeCalloutForKey, officePresentationKey } from "./officeSelection";
import type { PublishedOfficeLayout } from "./officeLayout";
import {
  readOfficePreferences,
  writeOfficePreferences,
  type OfficePreferences,
} from "./officePreferences";
import type { WorldObject } from "./worldObject";
import type { WorldFloatingTerminal } from "./worldTerminalPresentation";
import {
  createdRootPaneId,
  officeRoomActionCapabilities,
  officeRoomKeyForSelection,
} from "./officeRoomActions";
import {
  officeCompletionIdentity,
  readCompletionSeen,
  writeCompletionSeen,
} from "./completionSeenState";

type RoomDialog =
  | { mode: "create"; roomKey: string | null }
  | { mode: "rename" | "close"; roomKey: string; label: string };

type PendingCreatedPane = {
  connectionId: string;
  generation: number;
  paneId: string;
};

export default function PixelOfficeView({
  world,
  selectedId,
  onSelect,
  onOpenTerminal,
  onSelectedAnchorChange,
  floatingTerminals,
  onConversationAnchorsChange,
}: {
  world: WorldObject;
  selectedId: string | null;
  onSelect(id: string): void;
  onOpenTerminal(id: string): Promise<void>;
  onSelectedAnchorChange?: (anchor: OfficeCanvasAnchor | null) => void;
  floatingTerminals: readonly WorldFloatingTerminal[];
  onConversationAnchorsChange?(anchors: OfficeConversationAnchors | null): void;
}) {
  const office = useMemo(
    (): HerdrOfficeProjection => projectWorldOffice(world, Date.now()),
    [world],
  );
  const [preferences, setPreferences] = useState(() =>
    readOfficePreferences(worldLocalStorage),
  );
  const preferencesRef = useRef(preferences);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<PublishedOfficeLayout | null>(null);
  const [renderedRevision, setRenderedRevision] = useState(0);
  const [roomDialog, setRoomDialog] = useState<RoomDialog | null>(null);
  const [pendingCreatedPane, setPendingCreatedPane] =
    useState<PendingCreatedPane | null>(null);
  const [completionSeen, setCompletionSeen] = useState(() =>
    readCompletionSeen(worldLocalStorage),
  );
  const [selectedSceneAnchor, setSelectedSceneAnchor] =
    useState<OfficeCanvasAnchor | null>(null);
  const [sceneHover, setSceneHover] = useState<OfficeCanvasHover | null>(null);
  preferencesRef.current = preferences;

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

  function updatePreferences(patch: Partial<OfficePreferences>) {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      preferencesRef.current = next;
      writeOfficePreferences(worldLocalStorage, next);
      return next;
    });
  }

  const selectedKey = officePresentationKey(office, selectedId);
  const completionSeenKeys = useMemo(
    () =>
      new Set(
        office.roster.flatMap(({ agent }) =>
          completionSeen.has(officeCompletionIdentity(agent))
            ? [agent.key]
            : [],
        ),
      ),
    [completionSeen, office],
  );
  const unseenCompletions = useMemo(
    () =>
      office.roster
        .map(({ agent }) => agent)
        .filter(
          (agent) =>
            agent.semanticStatus === "done" &&
            agent.deskKey !== null &&
            !completionSeenKeys.has(agent.key),
        )
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

  useEffect(() => {
    if (!pendingCreatedPane) return;
    const host = world.hosts.find(
      ({ connectionId }) => connectionId === pendingCreatedPane.connectionId,
    );
    if (!host || host.generation !== pendingCreatedPane.generation) {
      setPendingCreatedPane(null);
      return;
    }
    const pane = world.leaves.find(
      (leaf) =>
        leaf.connectionId === pendingCreatedPane.connectionId &&
        leaf.nativeId === pendingCreatedPane.paneId &&
        leaf.generation === pendingCreatedPane.generation,
    );
    if (!pane) return;
    setPendingCreatedPane(null);
    onSelect(pane.id);
  }, [onSelect, pendingCreatedPane, world]);

  const roomForKey = (roomKey: string | null) =>
    roomKey ? (office.rooms.find(({ key }) => key === roomKey) ?? null) : null;
  const canCreateSeat = (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room) return false;
    return (
      officeRoomActionCapabilities(world, room).createSeat &&
      endpointCreationReason(
        store.get(),
        "tab.create",
        room.workspaceRef.nativeId,
      ) === null
    );
  };
  const canCreateRoom = (roomKey: string | null) => {
    const room = roomForKey(roomKey);
    const selectedHost = world.hosts.find(({ selectedHost }) => selectedHost);
    if (!selectedHost?.actionable || selectedHost.stale) return false;
    if (room && room.workspaceRef.connectionId !== selectedHost.connectionId) {
      return false;
    }
    return (
      endpointCreationReason(
        store.get(),
        "workspace.create",
        room?.workspaceRef.nativeId,
      ) === null
    );
  };
  const canManageRoom = (roomKey: string, action: "rename" | "close") => {
    const room = roomForKey(roomKey);
    if (!room) return false;
    return officeRoomActionCapabilities(world, room)[action];
  };
  const rememberCreatedPane = (
    connectionId: string,
    generation: number,
    result: unknown,
  ) => {
    const paneId = createdRootPaneId(result);
    if (paneId) setPendingCreatedPane({ connectionId, generation, paneId });
  };
  const createSeat = async (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room || !canCreateSeat(roomKey)) return;
    const result = await store.createTab(room.workspaceRef.nativeId, {
      numberedLabel: true,
    });
    rememberCreatedPane(
      room.workspaceRef.connectionId,
      room.observedGeneration,
      result,
    );
  };
  const submitCreateRoom = async (label: string) => {
    const selectedHost = world.hosts.find(({ selectedHost }) => selectedHost);
    if (!selectedHost || !canCreateRoom(roomDialog?.roomKey ?? null)) return;
    setRoomDialog(null);
    const result = await store.createWorkspace(label.trim() || undefined);
    rememberCreatedPane(
      selectedHost.connectionId,
      selectedHost.generation,
      result,
    );
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
      await store.renameWorkspace(room.workspaceRef.nativeId, value);
    }
  };
  const selectOfficeKey = (key: string) => {
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

  return (
    <div className="world-office-shell world-stage-shell">
      <div className="world-office-toolbar" aria-label="Office layout">
        <label>
          <span>Room alignment</span>
          <select
            value={preferences.roomAlignment}
            onChange={(event) =>
              updatePreferences({
                roomAlignment: event.target
                  .value as OfficePreferences["roomAlignment"],
              })
            }
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          <span>Long room titles</span>
          <select
            value={preferences.longTitleMode}
            onChange={(event) =>
              updatePreferences({
                longTitleMode: event.target
                  .value as OfficePreferences["longTitleMode"],
              })
            }
          >
            <option value="expand">Expand room</option>
            <option value="compact">Ellipsis</option>
          </select>
        </label>
      </div>
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
          observability={EMPTY_OFFICE_OBSERVABILITY}
          conversationTargets={conversationTargets}
          onSelect={selectOfficeKey}
          onActivateAgent={openOfficeTerminal}
          onActivateRoom={selectOfficeKey}
          canCreateSeat={canCreateSeat}
          onNewSeat={(roomKey) => void createSeat(roomKey)}
          onHover={setSceneHover}
          onSelectedAnchorChange={(anchor) => {
            setSelectedSceneAnchor(anchor);
            onSelectedAnchorChange?.(anchor);
          }}
          onAnchorChange={onConversationAnchorsChange}
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
                canCreateSeat={canCreateSeat}
                onCreateSeat={(roomKey) => void createSeat(roomKey)}
                canCreateRoom={canCreateRoom}
                onCreateRoom={(roomKey) =>
                  setRoomDialog({ mode: "create", roomKey })
                }
                canRenameRoom={(roomKey) => canManageRoom(roomKey, "rename")}
                onRenameRoom={(roomKey) => {
                  const room = roomForKey(roomKey);
                  if (room) {
                    setRoomDialog({
                      mode: "rename",
                      roomKey,
                      label: room.displayLabel,
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
                    });
                  }
                }}
              />
            </>
          ) : null}
        </PixelOfficeCanvas>
      </div>
      {selectedKey && selectedSceneAnchor ? (
        <OfficeCanvasCallout
          callout={officeCalloutForKey(office, selectedKey)}
          left={selectedSceneAnchor.x}
          top={selectedSceneAnchor.y}
          persistent
        />
      ) : null}
      {sceneHover && sceneHover.key !== selectedKey ? (
        <OfficeCanvasCallout
          callout={officeCalloutForKey(office, sceneHover.key)}
          left={sceneHover.clientX}
          top={sceneHover.clientY}
        />
      ) : null}
      <TextInputDialog
        open={roomDialog?.mode === "create"}
        title="Create room"
        label="Room name"
        submitLabel="Create"
        onClose={() => setRoomDialog(null)}
        onSubmit={(label) => void submitCreateRoom(label)}
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
          if (
            roomDialog?.mode === "close" &&
            canManageRoom(roomDialog.roomKey, "close")
          ) {
            const room = roomForKey(roomDialog.roomKey);
            if (room) void store.closeWorkspace(room.workspaceRef.nativeId);
          }
        }}
      />
    </div>
  );
}
