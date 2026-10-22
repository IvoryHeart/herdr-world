import {
  useCreationProgress,
  creationPendingReason,
  creationFailureMessage,
} from "../creationRequests";
import {
  requestAgentMove,
  requestDeskMove,
  requestDeskReorder,
  townMoveNotice,
  townMoveResult,
  type TownMoveOutcome,
  type TownMoveResult,
} from "./town/townMoves";
import { isMobileLayout, useLayoutPreferences } from "../layoutPreferences";
import { useSystemBack } from "../systemBack";
import { useTownFinished, withTownFinished } from "./town/townFinished";
import {
  insertIntoTerminalComposerDraft,
  terminalComposerDraftKey,
} from "../terminalComposer";
import { terminalUploadedPathsText } from "../terminalFileDrop";
import {
  uploadTerminalFile,
  uploadTerminalImage,
} from "../terminalImageUpload";
import { startAttachmentUploads } from "../attachmentUploads";
import { WorldSearchResults } from "./WorldSearchResults";
import { DEVTOOLS, NO_TRACE } from "./devtools/flag";
import { openTrace, rememberTrace, TRACE_TOGGLE_EVENT } from "./devtools/trace";
import { TraceOverlay } from "./devtools/TraceOverlay";
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
import { townDeskColorTarget } from "./town/townModel";
import { resolveTerminal, type TerminalColor } from "./terminalColor";
import { setTerminalColor, useTerminalColors } from "./useTerminalColors";
import {
  sendTownReply,
  townChoices,
  townLeaf,
  townOwner,
  townPaneIdentity,
  townQuestion,
  townScreenLines,
  useTownConversation,
  useTownScreen,
} from "./town/townChat";
import { requestTerminalComposer } from "./terminalComposerRequest";
import { TownComposer } from "./town/TownComposer";
import { TownChooser } from "./town/TownChooser";
import { TownPeek, townStatusText } from "./town/TownPeek";
import {
  nextTownCall,
  readTownRailCollapsed,
  TownRail,
  type TownCall,
} from "./town/TownRail";
import { useNow } from "./handoffs";
import type {
  WorldCanvasAnchor,
  WorldCanvasHover,
  WorldConversationAnchors,
} from "./worldConnectorGeometry";
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
import {
  readFloatingTerminalGeometry,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";
import {
  useWindowManager,
  useWindowWorkArea,
} from "./windows/useWindowManager";
import {
  fitWindow,
  type SnapTarget,
  type WindowInput,
} from "./windows/windowManager";
import type { ManagedWindowControls } from "./windows/WindowControls";
import type { FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import { WindowSurface } from "./windows/WindowSurface";
import { WindowFrame } from "./windows/WindowFrame";

/** A keyed index of a list, built the first time it is read. */
/** The one chat window Town shows its pinned peek in. */
const TOWN_CHAT_WINDOW_ID = "town-chat";
/** The Town master's chat window, docked from the start. */
const TOWN_MASTER_WINDOW_ID = "town-master";
const ignoreLayer = () => {};

/** Where each chat window was left: docked, full or floating. */
type TownChatDock = SnapTarget | "full" | "float";
const TOWN_CHAT_DOCK_KEY = "townChatDock:v1";
const CHAT_DOCKS = new Set([
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "full",
  "float",
]);

function readTownChatDock(): Readonly<Record<string, TownChatDock>> {
  try {
    const value: unknown = JSON.parse(
      worldLocalStorage.getItem(TOWN_CHAT_DOCK_KEY) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, TownChatDock] =>
          typeof entry[1] === "string" && CHAT_DOCKS.has(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function writeTownChatDock(docks: Readonly<Record<string, TownChatDock>>) {
  try {
    worldLocalStorage.setItem(TOWN_CHAT_DOCK_KEY, JSON.stringify(docks));
  } catch {
    // A presentation preference must never prevent chatting.
  }
}

function lazyIndex<T>(items: readonly T[], keyOf: (item: T) => string) {
  let index: Map<string, T> | null = null;
  const read = () =>
    (index ??= new Map(items.map((item) => [keyOf(item), item])));
  return {
    get: (key: string) => read().get(key),
    has: (key: string) => read().has(key),
  };
}

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
  onOpenInspectorView,
}: {
  /** Open World's Inspector on a view (files, changes, history) for a node. */
  onOpenInspectorView?: (
    id: string,
    view: "files" | "changes" | "history",
  ) => void;
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  onSelect(id: string, signal?: AbortSignal): void | Promise<boolean>;
  onOpenTerminal(id: string, signal?: AbortSignal): Promise<void>;
  onSelectedAnchorChange?: (anchor: WorldCanvasAnchor | null) => void;
  floatingTerminals: readonly { nodeId: string }[];
  onConversationNodeAnchorsChange?(
    anchors: Record<string, WorldCanvasAnchor> | null,
  ): void;
}) {
  const projectOffice = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
  const layoutPreferences = useLayoutPreferences();
  const observedOffice = useMemo(
    (): HerdrOfficeProjection => projectOffice(world, Date.now(), selectedId),
    [world, selectedId, projectOffice],
  );
  const townFinished = useTownFinished(observedOffice);
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
  const [sceneHover, setSceneHover] = useState<WorldCanvasHover | null>(null);
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

  // Seen marks name their agent last; only those agents need their full
  // identity checked, not the whole roster.
  const seenAgentKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const identity of completionSeen)
      try {
        const parts: unknown = JSON.parse(identity);
        if (Array.isArray(parts) && typeof parts[3] === "string")
          keys.add(parts[3]);
      } catch {
        // A malformed mark names no agent.
      }
    return keys;
  }, [completionSeen]);
  const completionSeenKeys = useMemo(() => {
    const keys = new Set<string>();
    if (seenAgentKeys.size)
      for (const { agent } of observedOffice.roster)
        if (
          seenAgentKeys.has(agent.key) &&
          completionSeen.has(officeCompletionIdentity(agent))
        )
          keys.add(agent.key);
    return keys;
  }, [completionSeen, seenAgentKeys, observedOffice]);
  // Seen marks belong to one completion: an agent that works again, or
  // finishes again, has new work to check.
  useEffect(() => {
    if (!townFinished.fresh.length) return;
    setCompletionSeen((current) => {
      const next = new Set(current);
      for (const agent of townFinished.fresh)
        next.delete(officeCompletionIdentity(agent));
      if (next.size === current.size) return current;
      writeCompletionSeen(worldLocalStorage, next);
      return next;
    });
  }, [townFinished.fresh]);
  const office = useMemo(
    () =>
      withTownFinished(
        observedOffice,
        townFinished.finished,
        completionSeenKeys,
      ),
    [observedOffice, townFinished.finished, completionSeenKeys],
  );
  const selectedKey = officePresentationKey(office, selectedId);
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
    if (DEVTOOLS) trace.record("select", { key });
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
    townFinished.dismiss(agent.key);
    setCompletionSeen((current) => {
      const next = new Set(current);
      next.add(officeCompletionIdentity(agent));
      writeCompletionSeen(worldLocalStorage, next);
      return next;
    });
  };
  /**
   * Open the terminal for a pane, agent or desk. Opening a finished agent's
   * terminal marks its work reviewed, unless `markSeen` is false: a Town tap
   * opens without reviewing, whichever view Town opens.
   */
  const inspectOfficeTerminal = async (key: string, markSeen = true) => {
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
      if (markSeen && agent.semanticStatus === "done")
        markCompletionSeen(agent);
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
  const openOfficeTerminal = (key: string, markSeen = true) => {
    void inspectOfficeTerminal(key, markSeen).catch(() => undefined);
  };

  /* ---------- Town attention, peek, replies and toasts ---------- */
  const now = useNow(5_000);
  const [railCollapsed, setRailCollapsed] = useState(readTownRailCollapsed);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [shell, setShell] = useState<HTMLDivElement | null>(null);
  // The chat window's layer sits 8px inside the Town, as World's windows do.
  const shellArea = useWindowWorkArea(shell);
  const chatStage = useMemo(
    () => ({
      width: Math.max(0, shellArea.width - 16),
      height: Math.max(0, shellArea.height - 16),
    }),
    [shellArea.width, shellArea.height],
  );
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const blockedSince = useRef(new Map<string, number>());
  // Built on first use: a dense town's roster is large, and these lookups are
  // only needed by taps, hovers and an open peek.
  const agentByKey = useMemo(
    () => lazyIndex(office.roster, (entry) => entry.agent.key),
    [office.roster],
  );
  // An agent the user opens walks back to its desk and stays there until its
  // status changes; then Town places it by status again. Opening it does not
  // mark its work as seen: Mark reviewed still does that.
  const [summoned, setSummoned] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    setSummoned((current) => {
      let next: Map<string, string> | null = null;
      for (const [key, status] of current)
        if (agentByKey.get(key)?.agent.semanticStatus !== status)
          (next ??= new Map(current)).delete(key);
      return next ?? current;
    });
  }, [agentByKey]);
  const summonedKeys = useMemo(() => new Set(summoned.keys()), [summoned]);
  const summon = (key: string) => {
    const status = agentByKey.get(key)?.agent.semanticStatus;
    if (status)
      setSummoned((current) =>
        current.get(key) === status
          ? current
          : new Map(current).set(key, status),
      );
  };
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
      const entry = agentByKey.get(agent.key);
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
  }, [office.roster, unseenCompletions, agentByKey]);
  const whereOfAgent = (agentKey: string) => {
    const entry = agentByKey.get(agentKey);
    return entry ? `${entry.roomLabel} · ${entry.hostLabel}` : "";
  };
  const terminalColors = useTerminalColors();
  const deviceByKey = useMemo(
    () => lazyIndex(office.paneRoster, (entry) => entry.device.key),
    [office.paneRoster],
  );

  type Toast = { id: number; kind: "ok" | "error"; text: string };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  // The event trace exists only in development builds (devtools/flag.ts).
  const trace = useMemo(() => (DEVTOOLS ? openTrace("town") : NO_TRACE), []);
  const [tracing, setTracing] = useState(trace.enabled);
  const setTrace = (on: boolean) => {
    if (!DEVTOOLS) return;
    rememberTrace("town", trace, on);
    setTracing(on);
  };
  // Town's settings live in the common menu, which asks for the trace.
  useEffect(() => {
    if (!DEVTOOLS) return;
    const toggle = (event: Event) => {
      const detail = (event as CustomEvent<{ view: string; on: boolean }>)
        .detail;
      if (detail?.view !== "town") return;
      rememberTrace("town", trace, detail.on);
      setTracing(detail.on);
    };
    window.addEventListener(TRACE_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(TRACE_TOGGLE_EVENT, toggle);
  }, [trace]);
  const toast = useCallback(
    (kind: Toast["kind"], text: string) => {
      if (DEVTOOLS) trace.record("toast", { kind, text });
      const id = ++toastId.current;
      setToasts((current) => [...current.slice(-2), { id, kind, text }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((item) => item.id !== id)),
        kind === "error" ? 6_000 : 2_600,
      );
    },
    [trace],
  );

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

  /** The desk whose panes are listed, for a desk with more panes than seats. */
  const [chooser, setChooser] = useState<string | null>(null);
  /** A desk or agent move being chosen: what to move, then where. */
  const [moveFlow, setMoveFlow] = useState<
    | { step: "room"; deskKey: string }
    | { step: "desk"; agentKey: string }
    | null
  >(null);
  /** The desk or agent being moved; further moves wait for it. */
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    message: string;
    run(): void;
  } | null>(null);
  const [peek, setPeek] = useState<{
    key: string;
    anchor: { x: number; y: number } | null;
    pinned: boolean;
    /** Showing World's composer for this agent. */
    chat?: boolean;
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

  /**
   * Replying opens the pane in World's terminal window with its composer
   * open, the same composer (with uploads) used everywhere else.
   */
  const crowdedDesk = (key: string) => {
    const desk = office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    return desk && desk.observedPaneCount > desk.paneDevices.length
      ? desk
      : null;
  };
  const deskForKey = (key: string) =>
    office.deskRoster.find(({ desk }) => desk.key === key)?.desk ?? null;
  const reportMove = (
    label: string,
    outcome: TownMoveOutcome,
    sourceTab: string,
  ) => {
    if (DEVTOOLS) trace.record("move", { label, status: outcome.status });
    toast(
      outcome.status === "moved" ? "ok" : "error",
      townMoveNotice(label, outcome, sourceTab),
    );
    return townMoveResult(outcome);
  };
  const runDeskMove = async (
    deskKey: string,
    roomKey: string,
    allowCloseRoom = false,
  ): Promise<TownMoveResult> => {
    const desk = deskForKey(deskKey);
    const room = roomForKey(roomKey);
    const source = desk ? roomForKey(desk.roomKey) : null;
    if (!desk || !room || movingKey) return "returned";
    // Herdr closes a room when its last desk leaves; ask first.
    if (!allowCloseRoom && (source?.observedDeskCount ?? 2) <= 1) {
      setMoveConfirm({
        message: `“${desk.displayLabel}” is the last desk in “${source?.displayLabel}”. Moving it to “${room.displayLabel}” closes that room.`,
        run: () => void runDeskMove(deskKey, roomKey, true),
      });
      return "returned";
    }
    setMovingKey(desk.key);
    toast("ok", `Moving ${desk.displayLabel} to ${room.displayLabel}…`);
    try {
      const outcome = await requestDeskMove(desk, room, allowCloseRoom);
      return reportMove(desk.displayLabel, outcome, desk.tabRef.nativeId);
    } catch (cause) {
      toast(
        "error",
        `${desk.displayLabel} may not have moved: ${String(cause)}`,
      );
      return "uncertain";
    } finally {
      setMovingKey(null);
    }
  };
  /** Reorder a desk in its room: into `ontoKey`'s slot, or last when null. */
  const runDeskReorder = async (
    deskKey: string,
    ontoKey: string | null,
  ): Promise<TownMoveResult> => {
    const desk = deskForKey(deskKey);
    const room = desk ? roomForKey(desk.roomKey) : null;
    const onto = ontoKey ? deskForKey(ontoKey) : null;
    if (!desk || !room || (ontoKey && !onto) || movingKey) return "returned";
    setMovingKey(desk.key);
    try {
      const outcome = await requestDeskReorder(desk, onto);
      if (outcome.status === "moved") {
        if (DEVTOOLS)
          trace.record("move", {
            label: desk.displayLabel,
            status: outcome.status,
          });
        return "moved";
      }
      return reportMove(desk.displayLabel, outcome, desk.tabRef.nativeId);
    } catch (cause) {
      toast(
        "error",
        `${desk.displayLabel} may not have moved: ${String(cause)}`,
      );
      return "uncertain";
    } finally {
      setMovingKey(null);
    }
  };
  const runAgentMove = async (
    agentKey: string,
    deskKey: string,
    allowCloseRoom = false,
  ): Promise<TownMoveResult> => {
    const agent = agentByKey.get(agentKey)?.agent;
    const device = office.paneRoster.find(
      ({ device }) => device.agentKey === agentKey,
    )?.device;
    const target = deskForKey(deskKey);
    const sourceDesk = device ? deskForKey(device.deskKey) : null;
    const sourceRoom = sourceDesk ? roomForKey(sourceDesk.roomKey) : null;
    if (!agent || !device || !target || movingKey) return "returned";
    if (
      !allowCloseRoom &&
      (sourceDesk?.observedPaneCount ?? 2) <= 1 &&
      (sourceRoom?.observedDeskCount ?? 2) <= 1
    ) {
      setMoveConfirm({
        message: `${agent.displayLabel} is alone at the last desk in “${sourceRoom?.displayLabel}”. Moving it closes that room.`,
        run: () => void runAgentMove(agentKey, deskKey, true),
      });
      return "returned";
    }
    setMovingKey(agentKey);
    toast("ok", `Moving ${agent.displayLabel} to ${target.displayLabel}…`);
    try {
      const outcome = await requestAgentMove(device, target, allowCloseRoom);
      return reportMove(
        agent.displayLabel,
        outcome,
        sourceDesk?.tabRef.nativeId ?? "",
      );
    } catch (cause) {
      toast(
        "error",
        `${agent.displayLabel} may not have moved: ${String(cause)}`,
      );
      return "uncertain";
    } finally {
      setMovingKey(null);
    }
  };
  /** The choices for each step of a move. */
  const moveChooser = (flow: NonNullable<typeof moveFlow>) => {
    if (flow.step === "room") {
      const desk = deskForKey(flow.deskKey);
      const rooms = desk
        ? office.rooms.filter(
            (room) =>
              room.hostKey === desk.hostKey &&
              room.key !== desk.roomKey &&
              room.workspaceRef.connectionId === desk.tabRef.connectionId,
          )
        : [];
      // Within its room a desk takes another desk's slot, as in a drag.
      const home = desk ? roomForKey(desk.roomKey) : null;
      const slots = home?.desks ?? [];
      const lastDrawn = slots[slots.length - 1];
      const reorder = (ontoKey: string | null) => () => {
        setMoveFlow(null);
        void runDeskReorder(flow.deskKey, ontoKey);
      };
      const places = [
        ...slots
          .filter((other) => other.key !== desk?.key)
          .map((other) => ({
            key: other.key,
            label: `${other.displayLabel}’s place`,
            detail: `Desk ${slots.indexOf(other) + 1} in ${home?.displayLabel}`,
            onChoose: reorder(other.key),
          })),
        // Last means last of the drawn desks: in a room with hidden desks
        // that is the last drawn desk's place, so the desk stays in view.
        ...(lastDrawn && lastDrawn.key !== desk?.key
          ? [
              {
                key: `${flow.deskKey}:last`,
                label: "Last",
                detail: home?.omittedDeskCount
                  ? `Last of the desks shown in ${home.displayLabel}`
                  : `After every desk in ${home?.displayLabel}`,
                onChoose: reorder(
                  home?.omittedDeskCount ? lastDrawn.key : null,
                ),
              },
            ]
          : []),
      ];
      return {
        title: `Move ${desk?.displayLabel ?? "desk"}`,
        detail:
          places.length || rooms.length
            ? "Choose a place in this room or a room on this host"
            : "No other desk or room on this host",
        entries: [
          ...places,
          ...rooms.map((room) => ({
            key: room.key,
            label: room.displayLabel,
            detail: `${room.observedDeskCount} desks`,
            onChoose: () => {
              setMoveFlow(null);
              void runDeskMove(flow.deskKey, room.key);
            },
          })),
        ],
      };
    }
    const agent = agentByKey.get(flow.agentKey)?.agent;
    const desks = agent
      ? office.deskRoster
          .map(({ desk }) => desk)
          .filter(
            (desk) =>
              desk.hostKey === agent.hostKey &&
              desk.key !== agent.deskKey &&
              desk.paneDevices.length > 0,
          )
      : [];
    return {
      title: `Move ${agent?.displayLabel ?? "agent"}`,
      detail: desks.length
        ? "Choose a desk on this host"
        : "No other desk on this host",
      entries: desks.map((desk) => ({
        key: desk.key,
        label: desk.displayLabel,
        detail: roomForKey(desk.roomKey)?.displayLabel ?? "",
        onChoose: () => {
          setMoveFlow(null);
          void runAgentMove(flow.agentKey, desk.key);
        },
      })),
    };
  };
  const openReply = (key: string) => {
    // A desk with more panes than seats lists them all rather than guessing.
    if (crowdedDesk(key)) {
      window.clearTimeout(peekTimer.current);
      setPeek(null);
      setChooser(key);
      return;
    }
    // An agent's chat is its default: on the phone the peek grows World's
    // composer, and on a wide screen the agent's chat window opens. A pane
    // without an agent opens its terminal.
    const mobile = isMobileLayout();
    const agentKey = agentByKey.has(key)
      ? key
      : (deviceByKey.get(key)?.device.agentKey ?? deskAgentKey(key));
    if (!mobile && agentKey && agentByKey.has(agentKey)) {
      openChat(agentKey);
      return;
    }
    if (mobile && agentKey && agentByKey.has(agentKey)) {
      window.clearTimeout(peekTimer.current);
      summon(agentKey);
      setPeek((current) => ({
        key: agentKey,
        anchor: sheetMode()
          ? null
          : current?.key === agentKey
            ? current.anchor
            : lastPointer.current,
        pinned: true,
        chat: true,
      }));
      return;
    }
    // Otherwise open the pane's terminal, with its composer on the phone layout.
    const nodeId =
      deviceByKey.get(key)?.device.nodeId ??
      agentByKey.get(key)?.agent.nodeId ??
      office.deskRoster.find(({ desk }) => desk.key === key)?.desk
        .paneDevices[0]?.nodeId;
    const leaf = townLeaf(world, nodeId);
    window.clearTimeout(peekTimer.current);
    setPeek(null);
    // Desktop World has no visible composer; an open one would take the
    // terminal's keystrokes, so it is requested only on the phone layout.
    if (leaf && mobile)
      requestTerminalComposer({
        connectionId: leaf.connectionId,
        generation: leaf.generation,
        paneId: leaf.pane.pane_id,
      });
    openOfficeTerminal(key);
  };
  // The phone's Back closes the composer, then the peek or chooser, before
  // it leaves Town.
  useSystemBack(
    peek !== null,
    () => {
      holdPeek.current = false;
      setPeek(null);
    },
    "panel",
  );
  useSystemBack(
    Boolean(peek?.chat),
    () => setPeek((current) => (current ? { ...current, chat: false } : null)),
    "popup",
  );
  useSystemBack(chooser !== null, () => setChooser(null), "popup");
  useSystemBack(moveFlow !== null, () => setMoveFlow(null), "popup");
  const peekEntry = peek ? agentByKey.get(peek.key) : undefined;
  useEffect(() => {
    if (peek && !peekEntry) setPeek(null);
  }, [peek, peekEntry]);
  const peekAgent = peekEntry?.agent;
  const chooserDesk = chooser ? crowdedDesk(chooser) : null;
  const chooserPanes = chooserDesk
    ? office.paneRoster
        .filter(({ device }) => device.deskKey === chooserDesk.key)
        .sort((a, b) => a.device.order - b.device.order)
    : [];
  const peekLeaf = townLeaf(world, peekAgent?.nodeId);
  // The screen is read only for a waiting agent's question and answers; the
  // peek's message comes from Chat's conversation read model.
  const peekBlocked = peekAgent?.semanticStatus === "blocked";
  const peekScreen = useTownScreen(
    peekLeaf,
    Boolean(peekAgent) && peekBlocked,
    peek?.chat ? 1_200 : 2_000,
  );
  const peekConversation = useTownConversation(peekLeaf, Boolean(peekAgent));
  const peekCanReply =
    Boolean(peekLeaf) && !!peekAgent?.canOpenInSpaces && !peekAgent.stale;
  // Answers come only from the question at the bottom of a waiting screen.
  const peekChoices = peekBlocked
    ? townChoices(townScreenLines(peekScreen, 12))
    : [];
  const peekQuestion = peekBlocked
    ? townQuestion(
        townScreenLines(peekScreen),
        peekChoices.length > 0 && peekCanReply,
      ).question
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
  /**
   * Where a pane's attachments are kept. On the phone layout they belong to
   * the pane's composer draft, which opens in the peek, so the composer shows
   * their chips. On desktop they belong to the peek's own reply line: the
   * hidden terminal composer must not take their paths.
   */
  const uploadScopeOf = (leaf: NonNullable<ReturnType<typeof townLeaf>>) => {
    const draftKey = terminalComposerDraftKey(
      leaf.connectionId,
      leaf.generation,
      leaf.pane.pane_id,
    );
    return isMobileLayout() ? draftKey : `town-peek\u0000${draftKey}`;
  };
  /**
   * Upload files for a pane as World's composer does, one chip per file. On
   * the phone layout each path goes into the composer's shared draft, which
   * outlives any one composer. On desktop it is kept for the pane's peek,
   * which takes it into its reply line whenever it is open.
   */
  const attach = (
    leaf: ReturnType<typeof townLeaf>,
    agentKey: string,
    files: File[],
    image: boolean,
  ) => {
    const client = leaf && townOwner(leaf);
    if (!leaf || !client) {
      toast("error", "This agent's host changed; refresh before attaching.");
      return;
    }
    const mobile = isMobileLayout();
    if (mobile) openReply(agentKey);
    const draftKey = terminalComposerDraftKey(
      leaf.connectionId,
      leaf.generation,
      leaf.pane.pane_id,
    );
    void startAttachmentUploads(
      uploadScopeOf(leaf),
      files,
      async (file, onProgress) => {
        const text = terminalUploadedPathsText([
          await (image ? uploadTerminalImage : uploadTerminalFile)(
            client,
            file,
            onProgress,
          ),
        ]);
        if (!mobile) return text;
        insertIntoTerminalComposerDraft(draftKey, text);
      },
    );
  };
  const nextCall = (currentKey: string | null) =>
    nextTownCall(calls, currentKey);
  const openPeek = (key: string, anchor: { x: number; y: number } | null) => {
    if (DEVTOOLS) trace.record("peek", { key });
    window.clearTimeout(peekTimer.current);
    // The Town master's chat has its own docked window.
    if (key === masterAgent?.key) {
      openChat(key);
      return;
    }
    summon(key);
    // Opening an agent shows the chat window again if it was minimised.
    revealChat.current();
    setPeek({ key, anchor: sheetMode() ? null : anchor, pinned: true });
  };
  /**
   * Open an agent's chat: its window, docked right by default (the master's
   * own docked window for the Town master), or on the phone the chat with
   * its composer. The agent walks back to its desk and a minimised window
   * shows again. Every way into an agent's chat comes through here.
   */
  const openChat = (agentKey: string) => {
    if (!agentByKey.has(agentKey)) return;
    if (agentKey === masterAgent?.key) {
      window.clearTimeout(peekTimer.current);
      summon(agentKey);
      setMasterClosed(false);
      revealChat.current(TOWN_MASTER_WINDOW_ID);
      return;
    }
    if (isMobileLayout()) {
      openReply(agentKey);
      return;
    }
    openPeek(agentKey, null);
  };
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const revealChat = useRef<(id?: string) => void>(() => {});
  /**
   * The agent a table stands for: one that needs you (waiting, then
   * finished) even while it is away at reception, else the one seated there.
   */
  const deskAgentKey = (deskKey: string) => {
    const rank = (agent: OfficeAgent) =>
      agent.semanticStatus === "blocked"
        ? 0
        : agent.semanticStatus === "done"
          ? 1
          : 2;
    const occupant = office.deskRoster.find(({ desk }) => desk.key === deskKey)
      ?.desk.occupantAgentKey;
    let best: OfficeAgent | null = null;
    for (const { agent } of office.roster)
      if (
        agent.deskKey === deskKey &&
        (!best ||
          rank(agent) < rank(best) ||
          (rank(agent) === rank(best) && agent.key === occupant))
      )
        best = agent;
    return best?.key ?? occupant ?? null;
  };
  /**
   * Tapping an agent, or its desk even while the agent is away at reception
   * or in the lounge, opens what the Town opens setting chooses: the agent's
   * chat (the peek) or its terminal. A desk without an agent opens its pane.
   */
  const tapTown = (key: string) => {
    const desk = agentByKey.has(key)
      ? undefined
      : office.deskRoster.find(({ desk }) => desk.key === key)?.desk;
    const agentKey = agentByKey.has(key) ? key : desk && deskAgentKey(desk.key);
    if (agentKey) {
      // Either way the agent comes back to its desk and nothing is reviewed.
      if (preferences.townOpens === "terminal") {
        window.clearTimeout(peekTimer.current);
        setPeek(null);
        summon(agentKey);
        openOfficeTerminal(agentKey, false);
      } else openPeek(agentKey, lastPointer.current);
      return;
    }
    if (deviceByKey.has(key) || desk) {
      openReply(key);
      return;
    }
    selectOfficeKey(key);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // A key sent to the document or window has no element target.
      const target = event.target instanceof HTMLElement ? event.target : null;
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
      if ((event.key === "n" || event.key === "N") && !peek?.pinned) {
        const next = nextCall(null);
        if (!next) return;
        event.preventDefault();
        openPeek(next.agent.key, null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const whereOf = whereOfAgent;
  /** The peeked agent's desk colour: its terminal's, shared across World. */
  const peekDeskColor = (agentKey: string) => {
    const deskKey = office.paneRoster.find(
      ({ device }) => device.agentKey === agentKey,
    )?.device.deskKey;
    const desk = deskKey ? deskForKey(deskKey) : null;
    const target = desk ? townDeskColorTarget(office, desk) : null;
    if (!target) return null;
    const { color, own } = resolveTerminal(terminalColors, target);
    return {
      current: color,
      // Only the tab's own colour can be reset; a workspace's is not its.
      custom: own,
      onColor: (color: TerminalColor | null) =>
        void setTerminalColor(target, color),
    };
  };
  const townSelectedKey = peek?.key ?? selectedKey;
  /* ---------- Chat windows ---------- */
  // Town's chats are windows in World's shared frame, as the Inspector is:
  // moved, resized, snapped, minimised and maximised the same way. A pinned
  // peek opens the agent's chat window; the Town master's (FirstMate's) chat
  // is docked from the start on wide screens. They dock right by default and
  // can be undocked; a phone docks the chat at the bottom, with a grip for its
  // height. Where each one was left is kept per device. Hover peeks stay
  // cards beside their agent.
  const phoneChat = layoutPreferences.mobile || width < 640;
  const masterName = preferences.townMaster.trim().toLowerCase();
  const masterAgent =
    phoneChat || !masterName
      ? undefined
      : office.roster.find(
          ({ agent }) => agent.displayLabel.toLowerCase() === masterName,
        )?.agent;
  const [masterClosed, setMasterClosed] = useState(false);
  const masterOpen = Boolean(masterAgent) && !masterClosed;
  const masterLeaf = townLeaf(world, masterAgent?.nodeId);
  const masterBlocked = masterAgent?.semanticStatus === "blocked";
  const masterScreen = useTownScreen(masterLeaf, masterOpen && masterBlocked);
  const masterConversation = useTownConversation(masterLeaf, masterOpen);
  const masterCanReply =
    Boolean(masterLeaf) && !!masterAgent?.canOpenInSpaces && !masterAgent.stale;
  const masterChoices = masterBlocked
    ? townChoices(townScreenLines(masterScreen, 12))
    : [];
  const masterQuestion = masterBlocked
    ? townQuestion(
        townScreenLines(masterScreen),
        masterChoices.length > 0 && masterCanReply,
      ).question
    : [];
  const chatWindow =
    Boolean(peek?.pinned && peekAgent) && peekAgent?.key !== masterAgent?.key;
  const bothDocked = masterOpen && chatWindow;
  const [chatDock, setChatDock] = useState(readTownChatDock);
  /** Saved per device: a phone keeps its own place for each window. */
  const chatPlaceId = (id: string) => (phoneChat ? `${id}:phone` : id);
  const dockOf = (id: string): TownChatDock =>
    chatDock[chatPlaceId(id)] ?? (phoneChat ? "bottom" : "right");
  const saveDock = (id: string, dock: TownChatDock) =>
    setChatDock((current) => {
      if (current[chatPlaceId(id)] === dock) return current;
      const next = { ...current, [chatPlaceId(id)]: dock };
      writeTownChatDock(next);
      return next;
    });
  /** Docked right with the master's window, the two share the right edge. */
  const dockedSnap = (id: string, dock: TownChatDock): SnapTarget | null =>
    dock === "float" || dock === "full"
      ? null
      : dock === "right" && bothDocked
        ? id === TOWN_MASTER_WINDOW_ID
          ? "top-right"
          : "bottom-right"
        : dock;
  const chatWindowInputs = useMemo(() => {
    const input = (id: string, label: string): WindowInput => {
      const snap = dockedSnap(id, dockOf(id));
      return {
        id,
        label,
        initialSnap: snap ?? undefined,
        initialGeometry: readFloatingTerminalGeometry(
          worldLocalStorage,
          chatPlaceId(id),
          phoneChat
            ? {
                left: 0,
                top: Math.round(chatStage.height / 2),
                width: chatStage.width,
                height: Math.round(chatStage.height / 2),
              }
            : {
                left: Math.max(0, chatStage.width - 436),
                top: 0,
                width: Math.min(420, chatStage.width),
                height: Math.min(560, chatStage.height),
              },
          chatStage,
          undefined,
          fitWindow,
        ),
      };
    };
    return [
      ...(masterOpen ? [input(TOWN_MASTER_WINDOW_ID, "FirstMate chat")] : []),
      ...(chatWindow ? [input(TOWN_CHAT_WINDOW_ID, "Chat")] : []),
    ];
    // The inputs only matter when a window is created; its dock is read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterOpen, chatWindow, chatStage, phoneChat]);
  const chatWindows = useWindowManager(
    chatWindowInputs,
    chatStage,
    phoneChat ? "town-chat:phone" : "town-chat",
  );
  revealChat.current = (id = TOWN_CHAT_WINDOW_ID) =>
    chatWindows.dispatch({ type: "focus", id });
  // A window left full is full again when it opens; two windows docked right
  // share the edge, and one alone takes all of it.
  const shownChats = useRef(new Set<string>());
  useEffect(() => {
    const { windows } = chatWindows.state;
    for (const id of Object.keys(windows)) {
      const entry = windows[id]!;
      if (!shownChats.current.has(id)) {
        shownChats.current.add(id);
        if (dockOf(id) === "full" && !entry.maximized)
          chatWindows.dispatch({ type: "maximize", id });
      }
      const snap = dockOf(id) === "right" ? dockedSnap(id, "right") : null;
      if (
        snap &&
        entry.placement.kind === "snap" &&
        entry.placement.target !== snap
      )
        chatWindows.dispatch({ type: "snap", id, target: snap });
    }
    for (const id of shownChats.current)
      if (!windows[id]) shownChats.current.delete(id);
    // dockOf and dockedSnap read the saved docks and bothDocked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindows.state, bothDocked]);
  /** A phone's chat docked at the bottom settles at ⅓, ½ or full height. */
  const settleChatHeight = (rect: FloatingTerminalGeometry) => {
    if (!phoneChat) return rect;
    const bottom = chatStage.height;
    if (Math.abs(rect.top + rect.height - bottom) > 8) return rect;
    const stop = [bottom / 3, bottom / 2, bottom].find(
      (height) => Math.abs(rect.height - height) < 32,
    );
    return stop === undefined
      ? rect
      : { ...rect, top: Math.round(bottom - stop), height: Math.round(stop) };
  };
  const chatHandlers = (id: string) => {
    const entry = chatWindows.state.windows[id];
    const toggleFull = () => {
      if (!entry) return;
      saveDock(
        id,
        entry.maximized
          ? entry.placement.kind === "snap"
            ? wideDock(entry.placement.target)
            : "float"
          : "full",
      );
      chatWindows.dispatch({ type: "maximize", id });
    };
    const wideDock = (target: SnapTarget): TownChatDock =>
      !phoneChat &&
      (target === "right" ||
        target === "top-right" ||
        target === "bottom-right")
        ? "right"
        : target;
    return {
      entry,
      toggleFull,
      place: (rect: FloatingTerminalGeometry) => {
        const settled = settleChatHeight(rect);
        writeFloatingTerminalGeometry(
          worldLocalStorage,
          chatPlaceId(id),
          settled,
        );
        saveDock(id, "float");
        chatWindows.dispatch({ type: "place", id, rect: settled });
      },
      snap: (target: SnapTarget) => {
        saveDock(id, wideDock(target));
        chatWindows.dispatch({ type: "snap", id, target });
      },
      controls: (onClose: () => void): ManagedWindowControls | null =>
        entry
          ? {
              maximized: entry.maximized,
              // A phone's header keeps minimise and close; dragging docks it
              // and a double tap fills the screen.
              compact: phoneChat,
              onMinimize: () => chatWindows.dispatch({ type: "minimize", id }),
              onMaximize: toggleFull,
              onClose,
              onSnap: (target) => {
                saveDock(id, wideDock(target));
                chatWindows.dispatch({ type: "snap", id, target });
              },
              onFloat: () => {
                saveDock(id, "float");
                chatWindows.dispatch({ type: "float", id });
              },
            }
          : null,
    };
  };
  const closePeekChat = () => {
    holdPeek.current = false;
    setPeek(null);
  };

  /** The pinned or hovered peek's card, inside its window when given one. */
  const peekCard = (handlers: ReturnType<typeof chatHandlers> | null) =>
    peekAgent ? (
      <TownPeek
        // One card per agent session: late upload or reply results of
        // another agent never land in this one.
        key={peekLeaf ? townPaneIdentity(peekLeaf) : peekAgent.key}
        agent={peekAgent}
        where={whereOf(peekAgent.key)}
        conversation={peekConversation}
        question={peekQuestion}
        choices={peekChoices}
        canReply={peekCanReply}
        // In its window the peek fills the frame; only a hover card sits
        // beside its agent.
        anchor={handlers ? null : peek!.anchor}
        pinned={peek!.pinned}
        onReply={(text, submit) =>
          reply(peekLeaf, peekAgent.displayLabel, text, submit)
        }
        inlineReply={!layoutPreferences.mobile}
        deskColor={peekDeskColor(peekAgent.key)}
        onReviewed={() => {
          markCompletionSeen(peekAgent);
          toast("ok", `${peekAgent.displayLabel}'s work reviewed`);
        }}
        onAttach={(files, image) =>
          attach(peekLeaf, peekAgent.key, files, image)
        }
        uploadScope={peekLeaf ? uploadScopeOf(peekLeaf) : null}
        onChat={() => openChat(peekAgent.key)}
        onTerminal={() => {
          setPeek(null);
          openOfficeTerminal(peekAgent.key);
        }}
        onInspector={() => {
          setPeek(null);
          if (onOpenInspectorView)
            onOpenInspectorView(peekAgent.nodeId, "files");
          else void onSelect(peekAgent.nodeId);
        }}
        onNext={
          nextCall(peekAgent.key)
            ? () => openChat(nextCall(peekAgent.key)!.agent.key)
            : null
        }
        onClose={closePeekChat}
        composer={
          peek!.chat && peekLeaf ? (
            <TownComposer
              leaf={peekLeaf}
              onDirect={() => {
                setPeek(null);
                openOfficeTerminal(peekAgent.key);
              }}
              onClose={() =>
                setPeek((current) =>
                  current ? { ...current, chat: false } : current,
                )
              }
              onSent={(submitted) =>
                toast(
                  "ok",
                  submitted
                    ? `Sent to ${peekAgent.displayLabel}`
                    : `Inserted for ${peekAgent.displayLabel}`,
                )
              }
              onError={(message) => toast("error", message)}
            />
          ) : null
        }
        onHold={(hold) => {
          holdPeek.current = hold;
          if (hold) window.clearTimeout(peekTimer.current);
          else if (!peek?.pinned) schedulePeek(null, 320);
        }}
        windowControls={handlers?.controls(closePeekChat) ?? null}
        onToggleFull={handlers?.toggleFull}
        grip={phoneChat && handlers !== null}
      />
    ) : null;
  /** The Town master's chat, docked from the start on wide screens. */
  const masterCard = (
    agent: OfficeAgent,
    handlers: ReturnType<typeof chatHandlers>,
  ) => (
    <TownPeek
      key={masterLeaf ? townPaneIdentity(masterLeaf) : agent.key}
      agent={agent}
      where={whereOf(agent.key)}
      conversation={masterConversation}
      question={masterQuestion}
      choices={masterChoices}
      canReply={masterCanReply}
      anchor={null}
      pinned
      onReply={(text, submit) =>
        reply(masterLeaf, agent.displayLabel, text, submit)
      }
      inlineReply
      deskColor={peekDeskColor(agent.key)}
      onReviewed={() => {
        markCompletionSeen(agent);
        toast("ok", `${agent.displayLabel}'s work reviewed`);
      }}
      onAttach={(files, image) => attach(masterLeaf, agent.key, files, image)}
      uploadScope={masterLeaf ? uploadScopeOf(masterLeaf) : null}
      onChat={() => openChat(agent.key)}
      onTerminal={() => openOfficeTerminal(agent.key)}
      onInspector={() => {
        if (onOpenInspectorView) onOpenInspectorView(agent.nodeId, "files");
        else void onSelect(agent.nodeId);
      }}
      onNext={null}
      onClose={() => setMasterClosed(true)}
      onHold={() => {}}
      windowControls={handlers.controls(() => setMasterClosed(true))}
      onToggleFull={handlers.toggleFull}
    />
  );

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
        ref={setShell}
        className={`world-office-shell world-stage-shell town-view-shell`}
        onPointerDownCapture={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY };
        }}
      >
        {DEVTOOLS && tracing ? (
          <TraceOverlay
            view="town"
            trace={trace}
            status={() => ({ mode: peek ? "peek" : "idle", pointers: 0 })}
            onClose={() => setTrace(false)}
          />
        ) : null}
        <TownRail
          collapsed={railCollapsed}
          onCollapsedChange={setRailCollapsed}
          calls={calls}
          activeKey={peek?.key ?? null}
          now={now}
          onPeek={(key, rect) =>
            key && rect
              ? hoverAgent(key, {
                  x: rect.right,
                  y: rect.top + rect.height / 2,
                })
              : hoverAgent(null)
          }
          onOpen={(key) => openPeek(key, null)}
        />
        {moveFlow ? (
          <TownChooser
            {...moveChooser(moveFlow)}
            onClose={() => setMoveFlow(null)}
          />
        ) : null}
        <ConfirmDialog
          open={moveConfirm !== null}
          title="Close the room?"
          message={moveConfirm?.message ?? ""}
          confirmLabel="Move and close room"
          danger
          onClose={() => setMoveConfirm(null)}
          onConfirm={() => {
            const run = moveConfirm?.run;
            setMoveConfirm(null);
            run?.();
          }}
        />
        {chooserDesk ? (
          <TownChooser
            title={chooserDesk.displayLabel}
            detail={`${chooserDesk.observedPaneCount} panes`}
            onClose={() => setChooser(null)}
            entries={chooserPanes.map(({ device }) => {
              const agent = device.agentKey
                ? agentByKey.get(device.agentKey)?.agent
                : undefined;
              return {
                key: device.key,
                label: device.displayLabel,
                detail: agent ? townStatusText(agent) : "terminal",
                onChoose: () => {
                  setChooser(null);
                  if (agent) openPeek(agent.key, null);
                  else openReply(device.key);
                },
              };
            })}
          />
        ) : null}
        {chatWindow || masterOpen ? (
          <WindowSurface
            state={chatWindows.state}
            dispatch={chatWindows.dispatch}
            stage={chatStage}
            compact={false}
            onLayer={ignoreLayer}
            bounds={chatStage}
            className="town-chat-surface"
          >
            {({ entry, geometry, stage, workArea, zIndex, active }) => {
              const master = entry.id === TOWN_MASTER_WINDOW_ID;
              const agent = master ? masterAgent : peekAgent;
              if (!agent) return null;
              const handlers = chatHandlers(entry.id);
              return (
                <WindowFrame
                  key={entry.id}
                  id={entry.id}
                  label={`${agent.displayLabel} chat window`}
                  geometry={geometry}
                  restoreGeometry={
                    entry.maximized || entry.placement.kind !== "floating"
                      ? entry.floating
                      : undefined
                  }
                  stage={stage}
                  workArea={workArea}
                  active={active}
                  compact={false}
                  zIndex={zIndex}
                  className={`town-chat-window${phoneChat ? " is-phone" : ""}`}
                  onRaise={() =>
                    chatWindows.dispatch({ type: "raise", id: entry.id })
                  }
                  onPlace={handlers.place}
                  onSnap={handlers.snap}
                  onMaximize={handlers.toggleFull}
                >
                  {master && masterAgent
                    ? masterCard(masterAgent, handlers)
                    : peekCard(handlers)}
                </WindowFrame>
              );
            }}
          </WindowSurface>
        ) : null}
        {peekAgent && !peek?.pinned ? peekCard(null) : null}
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
            trace={trace}
            projection={office}
            terminalColors={terminalColors}
            selectedKey={townSelectedKey}
            completionSeenKeys={completionSeenKeys}
            summonedKeys={summonedKeys}
            conversationTargets={conversationTargets}
            onSelect={tapTown}
            onActivateAgent={openReply}
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
            onAnchorChange={(anchors: WorldConversationAnchors | null) => {
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
              right: 0,
            }}
            roomActions={{
              onDropDesk: (deskKey, roomKey) => runDeskMove(deskKey, roomKey),
              onReorderDesk: (deskKey, ontoKey) =>
                runDeskReorder(deskKey, ontoKey),
              onDropAgent: (agentKey, deskKey) =>
                runAgentMove(agentKey, deskKey),
              onMoveDesk: (deskKey) => {
                setPeek(null);
                setMoveFlow({ step: "room", deskKey });
              },
              onMoveAgent: (agentKey) => {
                setPeek(null);
                setMoveFlow({ step: "desk", agentKey });
              },
              onChoosePanes: (deskKey) => {
                setPeek(null);
                setChooser(deskKey);
              },
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
