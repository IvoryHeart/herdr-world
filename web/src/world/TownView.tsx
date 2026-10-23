import { requestAgentLaunch } from "./agentProfiles";
import { questMark, useAgentQuests } from "./agentQuests";
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
import { useTownOffice } from "./town/useTownOffice";
import { TownCanvas } from "./town/TownCanvas";
import type { TownQuestMark } from "./town/townQuestPennant";
import { townDeskColorTarget, townRoomColorKey } from "./town/townModel";
import { resolveTerminal, type TerminalColor } from "./terminalColor";
import {
  setTerminalColor,
  usePlaceColorChoices,
  useTerminalColors,
  useWorldColorSource,
} from "./useTerminalColors";
import { useRelations } from "./relations";
import { townTeamActions } from "./town/townTeamActions";
import { townMoveMenu, type TownMoveFlow } from "./town/townMoveMenu";
import { inheritedColorKey } from "../../../shared/terminalColor";
import type { OfficeDesk } from "./herdrOfficeProjection";
import { hostColorKey, terminalColorKey } from "./terminalColor";
import { TOWN_HOST_THEMES } from "./town/townPaint";
import {
  sendTownReply,
  townChoices,
  townLeaf,
  townPaneIdentity,
  townQuestion,
  townScreenLines,
  useTownConversation,
  useTownScreen,
} from "./town/townChat";
import { requestTerminalComposer } from "./terminalComposerRequest";
import { TownChooser } from "./town/TownChooser";
import { TownPeek, townStatusText } from "./town/TownPeek";
import {
  nextTownCall,
  readTownRailCollapsed,
  TownRail,
  type TownCall,
} from "./town/TownRail";
import { sharedAsksStore, useWorldAsks } from "./worldAsks";
import { useNow } from "./handoffs";
import type {
  WorldCanvasAnchor,
  WorldCanvasHover,
  WorldConversationAnchors,
} from "./worldConnectorGeometry";
import { OfficeCanvasCallout } from "./OfficeCanvasCallout";
export { OfficeObservabilityDialog } from "./OfficeObservabilityDialog";
import type { OfficeAgent } from "./herdrOfficeProjection";
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

/** A keyed index of a list, built the first time it is read. */
/** Town masters whose chat has been docked in this page visit. */
const dockedTownMasters = new Set<string>();

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
  /**
   * Open World's Inspector on a view (files, changes, history = Chat) for a
   * node. `focus` false opens it without focusing the node's pane.
   */
  onOpenInspectorView?: (
    id: string,
    view: "files" | "changes" | "history",
    focus?: boolean,
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
  const layoutPreferences = useLayoutPreferences();
  const {
    office: observedOffice,
    deskPins,
    toggleRoomFold,
  } = useTownOffice(world, selectedId);
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
  const asksStore = sharedAsksStore();
  const asks = useWorldAsks(asksStore);
  const [width, setWidth] = useState(() => window.innerWidth);
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
  // Each agent's quest, marked over its desk by agent key.
  const agentQuests = useAgentQuests(world.leaves);
  // A Town agent's key is its leaf ID, so the marks come straight from the
  // quests (a dense town's roster is large).
  const questMarks = useMemo(
    (): ReadonlyMap<string, TownQuestMark> =>
      new Map([...agentQuests].map(([key, quest]) => [key, questMark(quest)])),
    [agentQuests],
  );
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
  // Colours and team walls read the same World, so they agree on each relation.
  const terminalColors = useTerminalColors(
    undefined,
    useWorldColorSource(world),
  );
  const relations = useRelations(world);
  const placeChoices = usePlaceColorChoices();
  /** A room's or building's colour for the shared picker (see placeColor). */
  const placeColorOf = (kind: "room" | "host", key: string) => {
    if (kind === "room") {
      const room = office.rooms.find((entry) => entry.key === key);
      return room ? placeChoices(townRoomColorKey(room)) : null;
    }
    const host = office.hosts.find((entry) => entry.key === key);
    if (!host) return null;
    const theme =
      TOWN_HOST_THEMES[
        host.deterministicSkin.themeIndex % TOWN_HOST_THEMES.length
      ]!;
    return {
      ...placeChoices(hostColorKey(host.connectionId)),
      defaultHex: theme.roof,
    };
  };
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
  const [moveFlow, setMoveFlow] = useState<TownMoveFlow | null>(null);
  /** The desk or agent being moved; further moves wait for it. */
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    message: string;
    run(): void;
  } | null>(null);
  /** The hover card being previewed: an agent and the point it sits by. */
  const [peek, setPeek] = useState<{
    key: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const holdPeek = useRef(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const schedulePeek = (next: typeof peek, delay: number) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(next), delay);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  const hoverAgent = (
    key: string | null,
    anchor?: { x: number; y: number },
  ) => {
    if (key && agentByKey.has(key) && anchor)
      schedulePeek({ key, anchor }, peek ? 60 : 280);
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
  /** The desk shows its parent's colour rather than one of its own. */
  const inheritsColor = (desk: OfficeDesk) => {
    const target = townDeskColorTarget(office, desk);
    if (!target) return false;
    const key = terminalColorKey(target);
    return (
      !terminalColors[key] && Boolean(terminalColors[inheritedColorKey(key)])
    );
  };
  const teams = townTeamActions({
    world,
    office,
    deskPins,
    relations: relations.relations,
    movingKey,
    deskForKey,
    roomForKey,
    toast,
    confirm: (message, run) => setMoveConfirm({ message, run }),
    runDeskMove: (deskKey, roomKey, allowCloseRoom, then) =>
      runDeskMove(deskKey, roomKey, allowCloseRoom, then),
    closeMenu: () => setMoveFlow(null),
    openGroupMenu: (deskKey) => setMoveFlow({ step: "group", deskKey }),
  });
  const runDeskMove = async (
    deskKey: string,
    roomKey: string,
    allowCloseRoom = false,
    /** After a move: seat the moved tab (its new ID) next to a teammate. */
    then?: (tabId: string) => Promise<void>,
  ): Promise<TownMoveResult> => {
    const desk = deskForKey(deskKey);
    const room = roomForKey(roomKey);
    const source = desk ? roomForKey(desk.roomKey) : null;
    if (!desk || !room || movingKey) return "returned";
    // Herdr closes a room when its last desk leaves; ask first.
    if (!allowCloseRoom && (source?.observedDeskCount ?? 2) <= 1) {
      setMoveConfirm({
        message: `“${desk.displayLabel}” is the last desk in “${source?.displayLabel}”. Moving it to “${room.displayLabel}” closes that room.`,
        run: () => void runDeskMove(deskKey, roomKey, true, then),
      });
      return "returned";
    }
    setMovingKey(desk.key);
    toast("ok", `Moving ${desk.displayLabel} to ${room.displayLabel}…`);
    try {
      const outcome = await requestDeskMove(
        desk,
        room,
        allowCloseRoom,
        inheritsColor(desk),
      );
      const result = reportMove(
        desk.displayLabel,
        outcome,
        desk.tabRef.nativeId,
      );
      if (outcome.status === "moved" && then) await then(outcome.tab_id);
      return result;
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
  /** The choices for each step of a move (townMoveMenu.ts). */
  const moveChooser = (flow: NonNullable<typeof moveFlow>) =>
    townMoveMenu(flow, {
      office,
      deskForKey,
      roomForKey,
      agentOf: (key) => agentByKey.get(key)?.agent,
      close: () => setMoveFlow(null),
      runDeskReorder,
      runDeskMove,
      runAgentMove,
      teams,
    });
  const openReply = (key: string) => {
    // A desk with more panes than seats lists them all rather than guessing.
    if (crowdedDesk(key)) {
      window.clearTimeout(peekTimer.current);
      setPeek(null);
      setChooser(key);
      return;
    }
    // An agent opens its window on Chat; a pane without an agent opens its
    // terminal.
    const mobile = isMobileLayout();
    const agentKey = agentByKey.has(key)
      ? key
      : (deviceByKey.get(key)?.device.agentKey ?? deskAgentKey(key));
    if (agentKey && agentByKey.has(agentKey)) {
      openChat(agentKey);
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
    2_000,
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
  const nextCall = (currentKey: string | null) =>
    nextTownCall(calls, currentKey);
  /**
   * Open an agent's chat: its one window, World's Inspector, on the Chat
   * view, docked right by default. The agent walks back to its desk. Every
   * way into an agent from Town comes through here; a hover card is only a
   * preview. `focus` false opens it without focusing the agent's pane.
   */
  const openChat = (agentKey: string, focus = true) => {
    const agent = agentByKey.get(agentKey)?.agent;
    if (!agent) return;
    if (DEVTOOLS) trace.record("peek", { key: agentKey });
    window.clearTimeout(peekTimer.current);
    holdPeek.current = false;
    setPeek(null);
    summon(agentKey);
    if (onOpenInspectorView)
      onOpenInspectorView(agent.nodeId, "history", focus);
    else void onSelect(agent.nodeId);
  };
  // The Town master's (FirstMate's) chat is docked from the start on wide
  // screens, once per visit: closed, it stays closed until opened again.
  const masterName = preferences.townMaster.trim().toLowerCase();
  // Herdr's agent name (herdr agent rename) first, then the shown label.
  const masterAgent = masterName
    ? (
        office.roster.find(
          ({ agent }) => agent.agentName?.toLowerCase() === masterName,
        ) ??
        office.roster.find(
          ({ agent }) => agent.displayLabel.toLowerCase() === masterName,
        )
      )?.agent
    : undefined;
  useEffect(() => {
    if (
      !masterAgent ||
      layoutPreferences.mobile ||
      dockedTownMasters.has(masterAgent.key)
    )
      return;
    dockedTownMasters.add(masterAgent.key);
    openChat(masterAgent.key, false);
    // openChat reads the current roster; the master opens once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterAgent?.key, layoutPreferences.mobile]);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
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
      } else openChat(agentKey);
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
      if (event.key === "n" || event.key === "N") {
        const next = nextCall(null);
        if (!next) return;
        event.preventDefault();
        openChat(next.agent.key);
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
          asks={asks}
          onAnswer={(id, text) => asksStore.answer(id, text)}
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
          onOpen={(key) => openChat(key)}
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
                  if (agent) openChat(agent.key);
                  else openReply(device.key);
                },
              };
            })}
          />
        ) : null}
        {peekAgent ? (
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
            anchor={peek!.anchor}
            onAnswer={(key) =>
              void reply(peekLeaf, peekAgent.displayLabel, key, false)
            }
            deskColor={peekDeskColor(peekAgent.key)}
            onReviewed={() => {
              markCompletionSeen(peekAgent);
              toast("ok", `${peekAgent.displayLabel}'s work reviewed`);
            }}
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
            onClose={() => {
              holdPeek.current = false;
              setPeek(null);
            }}
            onHold={(hold) => {
              holdPeek.current = hold;
              if (hold) window.clearTimeout(peekTimer.current);
              else schedulePeek(null, 320);
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
            trace={trace}
            projection={office}
            relations={relations}
            terminalColors={terminalColors}
            deskPins={deskPins}
            selectedKey={townSelectedKey}
            completionSeenKeys={completionSeenKeys}
            summonedKeys={summonedKeys}
            quests={questMarks}
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
              onToggleFold: toggleRoomFold,
              onDropDesk: (deskKey, roomKey) => runDeskMove(deskKey, roomKey),
              onGroupDesk: (deskKey, targetKey) =>
                teams.runGroupDesk(deskKey, targetKey),
              onUngroupDesk: (deskKey) => teams.runUngroupDesk(deskKey),
              onReorderDesk: (deskKey, ontoKey) =>
                runDeskReorder(deskKey, ontoKey),
              onDropAgent: (agentKey, deskKey) =>
                runAgentMove(agentKey, deskKey),
              onMoveDesk: (deskKey) => {
                setPeek(null);
                setMoveFlow({ step: "room", deskKey });
              },
              placeColor: placeColorOf,
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
              onNewAgent: (roomKey) => {
                const room = roomForKey(roomKey);
                if (!room || !canCreateSeat(roomKey)) return;
                setPeek(null);
                requestAgentLaunch({
                  connectionId: room.workspaceRef.connectionId,
                  generation: room.observedGeneration,
                  workspaceId: room.workspaceRef.nativeId,
                  workspaceLabel: room.displayLabel,
                });
              },
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
