import {
  useCreationProgress,
  creationPendingReason,
  creationFailureMessage,
} from "../creationRequests";
import { WorldSearchResults } from "./WorldSearchResults";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TownCanvas } from "./town/TownCanvas";
import {
  sendTownReply,
  uploadTownFiles,
  townChoices,
  townLeaf,
  townScreenLines,
  useTownScreen,
} from "./town/townChat";
import { TownDock, type TownDockPane } from "./town/TownDock";
import { TownPeek } from "./town/TownPeek";
import {
  readTownRailCollapsed,
  TownRail,
  type TownCall,
} from "./town/TownRail";
import { useNow } from "./handoffs";
import type {
  OfficeCanvasAnchor,
  OfficeCanvasHover,
  OfficeConversationAnchors,
} from "./PixelOfficeCanvas";
import { OfficeCanvasCallout } from "./OfficeCanvasCallout";
export { OfficeObservabilityDialog } from "./OfficeObservabilityDialog";
import {
  createOfficeProjector,
  TOWN_PRESENTATION_BOUNDS,
  type OfficeAgent,
  type HerdrOfficeProjection,
} from "./herdrOfficeProjection";
import {
  EMPTY_OFFICE_OBSERVABILITY,
  fetchOfficeObservability,
  type OfficeObservability,
} from "./officeObservability";
import { officeCalloutForKey, officePresentationKey } from "./officeSelection";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
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

export default function TownView({
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
  const projectOffice = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
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

  /* ---------- Town attention, peek, chat dock and toasts ---------- */
  const now = useNow(5_000);
  const [railCollapsed, setRailCollapsed] = useState(readTownRailCollapsed);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const blockedSince = useRef(new Map<string, number>());
  const calls = useMemo((): TownCall[] => {
    const since = blockedSince.current;
    const live = new Set<string>();
    const blocked: TownCall[] = [];
    for (const entry of office.roster) {
      const { agent } = entry;
      if (agent.semanticStatus !== "blocked" || agent.stale) continue;
      live.add(agent.key);
      if (!since.has(agent.key)) since.set(agent.key, Date.now());
      blocked.push({
        agent,
        kind: "blocked",
        since: since.get(agent.key)!,
        hostKey: entry.hostKey,
        hostLabel: entry.hostLabel,
        roomKey: entry.roomKey,
        roomLabel: entry.roomLabel,
      });
    }
    for (const key of [...since.keys()]) if (!live.has(key)) since.delete(key);
    blocked.sort(
      (a, b) => a.since - b.since || a.agent.key.localeCompare(b.agent.key),
    );
    const finished = unseenCompletions.flatMap((agent): TownCall[] => {
      const entry = office.roster.find(
        ({ agent: candidate }) => candidate.key === agent.key,
      );
      return entry
        ? [
            {
              agent,
              kind: "done",
              since: Date.now(),
              hostKey: entry.hostKey,
              hostLabel: entry.hostLabel,
              roomKey: entry.roomKey,
              roomLabel: entry.roomLabel,
            },
          ]
        : [];
    });
    return [...blocked, ...finished];
  }, [office.roster, unseenCompletions]);
  const agentByKey = useMemo(
    () => new Map(office.roster.map((entry) => [entry.agent.key, entry])),
    [office.roster],
  );
  const whereOfAgent = (agentKey: string) => {
    const entry = agentByKey.get(agentKey);
    return entry ? `${entry.roomLabel} · ${entry.hostLabel}` : "";
  };
  const deviceByKey = useMemo(
    () => new Map(office.paneRoster.map((entry) => [entry.device.key, entry])),
    [office.paneRoster],
  );

  type Toast = { id: number; kind: "ok" | "error"; text: string };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, kind, text }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      kind === "error" ? 6_000 : 2_600,
    );
  }, []);

  // A finished agent announces itself once; the rail keeps it until inspected.
  const announced = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = new Set(unseenCompletions.map((agent) => agent.key));
    const previous = announced.current;
    announced.current = done;
    if (!previous) return;
    const fresh = unseenCompletions.filter((agent) => !previous.has(agent.key));
    for (const agent of fresh.slice(0, 2))
      toast(
        "ok",
        `${agent.displayLabel} finished · ${whereOfAgent(agent.key)}`,
      );
    if (fresh.length > 2)
      toast("ok", `${fresh.length - 2} more agents finished`);
    // whereOfAgent reads the same roster as unseenCompletions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenCompletions, toast]);

  const [peek, setPeek] = useState<{
    key: string;
    anchor: { x: number; y: number } | null;
    pinned: boolean;
  } | null>(null);
  const holdPeek = useRef(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const sheetMode = () =>
    window.innerWidth < 640 || window.matchMedia("(hover: none)").matches;
  const schedulePeek = (next: typeof peek, delay: number) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(next), delay);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  const hoverAgent = (
    key: string | null,
    anchor?: { x: number; y: number },
  ) => {
    if (peek?.pinned) return;
    if (key && agentByKey.has(key) && anchor)
      schedulePeek({ key, anchor, pinned: false }, peek ? 60 : 280);
    else if (!holdPeek.current) schedulePeek(null, 320);
  };

  const [dock, setDock] = useState<{ paneKey: string } | null>(null);
  const devicesForAgent = (agentKey: string) =>
    office.paneRoster.find(({ device }) => device.agentKey === agentKey)
      ?.device;
  const openDock = (key: string) => {
    const device =
      deviceByKey.get(key)?.device ??
      devicesForAgent(key) ??
      (() => {
        const desk = office.deskRoster.find(
          ({ desk }) => desk.key === key,
        )?.desk;
        return desk?.paneDevices[0];
      })();
    if (!device) {
      openOfficeTerminal(key);
      return;
    }
    window.clearTimeout(peekTimer.current);
    setPeek(null);
    setDock({ paneKey: device.key });
    const agent = device.agentKey
      ? agentByKey.get(device.agentKey)?.agent
      : undefined;
    if (agent?.semanticStatus === "done") markCompletionSeen(agent);
  };
  const dockDevice = dock ? deviceByKey.get(dock.paneKey)?.device : undefined;
  useEffect(() => {
    if (dock && !dockDevice) setDock(null);
  }, [dock, dockDevice]);
  const dockAgent = dockDevice?.agentKey
    ? agentByKey.get(dockDevice.agentKey)?.agent
    : undefined;
  const dockDesk = dockDevice
    ? office.deskRoster.find(({ desk }) => desk.key === dockDevice.deskKey)
    : undefined;
  const dockLeaf = townLeaf(world, dockDevice?.nodeId);
  const dockScreen = useTownScreen(dockLeaf, Boolean(dockDevice), 1_500);
  const dockPanes: TownDockPane[] = (dockDesk?.desk.paneDevices ?? []).map(
    (device) => {
      const agent = device.agentKey
        ? agentByKey.get(device.agentKey)?.agent
        : undefined;
      return {
        key: device.key,
        label: agent?.displayLabel ?? device.displayLabel,
        status: agent?.semanticStatus ?? "shell",
      };
    },
  );

  const peekEntry = peek ? agentByKey.get(peek.key) : undefined;
  useEffect(() => {
    if (peek && !peekEntry) setPeek(null);
  }, [peek, peekEntry]);
  const peekAgent = peekEntry?.agent;
  const peekLeaf = townLeaf(world, peekAgent?.nodeId);
  const peekScreen = useTownScreen(peekLeaf, Boolean(peekAgent), 2_000);
  const peekLines = townScreenLines(
    peekScreen,
    peekAgent?.semanticStatus === "blocked",
    peekAgent?.semanticStatus === "blocked" ? 12 : 8,
  );
  const peekChoices =
    peekAgent?.semanticStatus === "blocked" ? townChoices(peekLines) : [];
  const dockChoices =
    dockAgent?.semanticStatus === "blocked"
      ? townChoices(townScreenLines(dockScreen, true, 14))
      : [];

  const reply = async (
    leaf: ReturnType<typeof townLeaf>,
    label: string,
    text: string,
    submit: boolean,
  ) => {
    if (!leaf) return false;
    try {
      await sendTownReply(leaf, text, submit);
      toast("ok", text ? `Sent to ${label}` : `Pressed Enter for ${label}`);
      return true;
    } catch (cause) {
      toast(
        "error",
        `Not sent to ${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return false;
    }
  };
  const nextCall = (currentKey: string | null) =>
    calls.find(
      (call) => call.agent.key !== currentKey && call.kind === "blocked",
    ) ?? calls.find((call) => call.agent.key !== currentKey);
  const openPeek = (key: string, anchor: { x: number; y: number } | null) => {
    window.clearTimeout(peekTimer.current);
    setPeek({ key, anchor: sheetMode() ? null : anchor, pinned: true });
  };
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const tapTown = (key: string) => {
    if (agentByKey.has(key)) {
      openPeek(key, lastPointer.current);
      return;
    }
    if (deviceByKey.has(key)) {
      openDock(key);
      return;
    }
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    if (desk) {
      if (desk.occupantAgentKey)
        openPeek(desk.occupantAgentKey, lastPointer.current);
      else openDock(key);
      return;
    }
    selectOfficeKey(key);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
            target.closest(".xterm")))
      )
        return;
      if (event.key === "Escape" && dock) {
        setDock(null);
        return;
      }
      if ((event.key === "n" || event.key === "N") && !peek?.pinned) {
        const next = nextCall(dock ? (dockAgent?.key ?? null) : null);
        if (!next) return;
        event.preventDefault();
        if (dock) openDock(next.agent.key);
        else openPeek(next.agent.key, null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const whereOf = whereOfAgent;
  const townSelectedKey =
    peek?.key ?? dockAgent?.key ?? dockDevice?.key ?? selectedKey;

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
      viewLabel="Town"
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
      <div
        className={`world-office-shell world-stage-shell town-view-shell${dock ? " town-dock-open" : ""}`}
        onPointerDownCapture={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY };
        }}
      >
        <TownRail
          collapsed={railCollapsed}
          onCollapsedChange={setRailCollapsed}
          calls={calls}
          activeKey={peek?.key ?? dockAgent?.key ?? null}
          now={now}
          onPeek={(key, rect) =>
            key && rect
              ? hoverAgent(key, {
                  x: rect.right,
                  y: rect.top + rect.height / 2,
                })
              : hoverAgent(null)
          }
          onOpen={openDock}
        />
        {peekAgent ? (
          <TownPeek
            agent={peekAgent}
            where={whereOf(peekAgent.key)}
            lines={peekLines}
            loading={peekScreen === null && Boolean(peekLeaf)}
            choices={peekChoices}
            canReply={
              Boolean(peekLeaf) && peekAgent.canOpenInSpaces && !peekAgent.stale
            }
            anchor={peek!.anchor}
            pinned={peek!.pinned}
            onReply={(text, submit) =>
              reply(peekLeaf, peekAgent.displayLabel, text, submit)
            }
            onChat={() => openDock(peekAgent.key)}
            onTerminal={() => {
              setPeek(null);
              openOfficeTerminal(peekAgent.key);
            }}
            onInspector={() => {
              setPeek(null);
              void onSelect(peekAgent.nodeId);
            }}
            onNext={
              nextCall(peekAgent.key)
                ? () => openPeek(nextCall(peekAgent.key)!.agent.key, null)
                : null
            }
            onClose={() => {
              holdPeek.current = false;
              setPeek(null);
            }}
            onHold={(hold) => {
              holdPeek.current = hold;
              if (hold) window.clearTimeout(peekTimer.current);
              else if (!peek?.pinned) schedulePeek(null, 320);
            }}
          />
        ) : null}
        {dockDevice ? (
          <TownDock
            title={dockAgent?.displayLabel ?? dockDevice.displayLabel}
            where={`${dockDesk?.desk.displayLabel ?? ""} · ${dockDesk?.roomLabel ?? ""} · ${dockDesk?.hostLabel ?? ""}`}
            agent={dockAgent ?? null}
            panes={dockPanes}
            activePane={dockDevice.key}
            screen={dockScreen}
            choices={dockChoices}
            canReply={
              Boolean(dockLeaf) &&
              dockDevice.canOpenInSpaces &&
              !dockDevice.stale
            }
            onPane={(key) => setDock({ paneKey: key })}
            onReply={(text, submit) =>
              reply(
                dockLeaf,
                dockAgent?.displayLabel ?? dockDevice.displayLabel,
                text,
                submit,
              )
            }
            onBack={() => setDock(null)}
            onNext={
              nextCall(dockAgent?.key ?? null)
                ? () => openDock(nextCall(dockAgent?.key ?? null)!.agent.key)
                : null
            }
            onTerminal={() => openOfficeTerminal(dockDevice.key)}
            onInspector={() => {
              setDock(null);
              void onSelect(dockAgent?.nodeId ?? dockDevice.nodeId);
            }}
            onAttach={async (files) => {
              if (!dockLeaf) return null;
              try {
                const text = await uploadTownFiles(dockLeaf, files);
                toast(
                  "ok",
                  files.length === 1
                    ? `Uploaded ${files[0]!.name}`
                    : `Uploaded ${files.length} files`,
                );
                return text;
              } catch (cause) {
                toast(
                  "error",
                  `Upload failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                );
                return null;
              }
            }}
          />
        ) : null}
        <div className="town-toasts" role="status" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={`town-toast town-toast-${item.kind}`}>
              <i aria-hidden="true">{item.kind === "ok" ? "✓" : "!"}</i>
              {item.text}
            </div>
          ))}
        </div>
        <div className="town-stage">
          <TownCanvas
            projection={office}
            selectedKey={townSelectedKey}
            completionSeenKeys={completionSeenKeys}
            conversationTargets={conversationTargets}
            onSelect={tapTown}
            onActivateAgent={openDock}
            onActivateRoom={() => {
              // In the town a room tap only zooms; it never opens an Inspector.
            }}
            onHover={(hover) => {
              if (hover)
                lastPointer.current = { x: hover.clientX, y: hover.clientY };
              if (hover && agentByKey.has(hover.key)) {
                setSceneHover(null);
                hoverAgent(hover.key, { x: hover.clientX, y: hover.clientY });
              } else {
                setSceneHover(hover);
                hoverAgent(null);
              }
            }}
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
            selectedRoomKey={selectedRoomKey}
            observability={observability}
            calm={preferences.townCalm}
            chrome={{
              left:
                width >= 640 &&
                !railCollapsed &&
                calls.some((call) => call.kind === "blocked")
                  ? 252
                  : 0,
              right:
                dock && width >= 900 ? Math.min(500, width * 0.42) + 24 : 0,
            }}
            roomActions={{
              showCreateSeat,
              canCreateSeat,
              createSeatReason,
              onCreateSeat: (roomKey) => void createSeat(roomKey),
              showCreateRoom,
              canCreateRoom,
              createRoomReason,
              onCreateRoom: (roomKey) =>
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
                }),
              canRenameRoom: (roomKey) => canManageRoom(roomKey, "rename"),
              onRenameRoom: (roomKey) => {
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
              },
              canCloseRoom: (roomKey) => canManageRoom(roomKey, "close"),
              onCloseRoom: (roomKey) => {
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
              },
            }}
          />
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
