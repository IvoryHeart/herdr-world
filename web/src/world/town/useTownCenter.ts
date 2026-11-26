/**
 * The town center's actions (TownCenterMenu.tsx), each reusing what World
 * already has: the agent launcher and profiles, the Town master's chat,
 * Focus, the Town summary and room creation. Places with a building (Needs
 * you's post office, the Library, Apartments…) are not here: Town adds one
 * **Buildings** entry for them (townCenterBuildings.ts, #1261). Board's hub
 * beside the bin (board/BoardHub.tsx) offers these actions and some places,
 * built by the same helpers.
 */

import {
  Building2,
  ClipboardList,
  Crown,
  DoorOpen,
  Headphones,
  Inbox,
  LibraryBig,
  Shirt,
  UserPlus,
} from "lucide-react";
import { openSounds } from "../../chimes/chimeHost";
import { useLayoutPreferences } from "../../layoutPreferences";
import {
  openProfileEditor,
  requestAgentLaunch,
  useAgentProfiles,
} from "../agentProfiles";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import { openApartments } from "../apartments/apartmentsStore";
import {
  type MemoryLibraryRequest,
  openMemoryLibrary,
} from "../memory/memoryEvents";
import { openNeedsYou } from "../needsYou";
import { openFocus } from "../focus";
import { useFocusClock } from "../FocusControls";
import type { WorldObject } from "../worldObject";
import type { TownCenterAction } from "./TownCenterMenu";
import type { TownRoomActions } from "./TownCanvas";
import { useTownMaster } from "./useTownMaster";

/** What finding and opening the Town master reads of an agent. */
export type TownMasterAgent = Pick<
  OfficeAgent,
  "key" | "agentName" | "displayLabel" | "stale" | "canOpenInSpaces"
>;

type RoomActions = Pick<
  TownRoomActions,
  | "canCreateSeat"
  | "onNewAgent"
  | "canCreateRoom"
  | "createRoomReason"
  | "onCreateRoom"
>;

/** Resolve only the synced holder; an absent holder never falls back to a name. */
export async function resolveTownMaster<T extends TownMasterAgent>(
  world: Pick<WorldObject, "leaves">,
  roster: readonly { agent: T }[],
  holder: { connection_id: string; terminal_id: string } | null,
): Promise<T | undefined> {
  if (holder) {
    const leaf = world.leaves.find(
      (candidate) =>
        candidate.connectionId === holder.connection_id &&
        candidate.terminalId === holder.terminal_id,
    );
    const agent = leaf
      ? roster.find(({ agent }) => agent.key === leaf.id)?.agent
      : undefined;
    return agent;
  }
  return undefined;
}

/**
 * The center's actions, newest state each render. It also docks the Town
 * master's chat once per visit on wide screens (useTownMaster).
 */
export function useTownCenter(
  world: WorldObject,
  office: HerdrOfficeProjection,
  {
    selectedRoomKey,
    townRoomActions: rooms,
    townSummary: summary,
    openChat,
  }: {
    /** The room in view: a new agent starts there when it can. */
    selectedRoomKey: string | null;
    townRoomActions: RoomActions;
    townSummary: { open(): void };
    openChat(agentKey: string, focus?: boolean): void;
  },
  toast: (kind: "ok" | "error", text: string) => void,
): TownCenterAction[] {
  const { mobile } = useLayoutPreferences();
  const holder = useAgentProfiles().document?.town_master ?? null;
  useTownMaster(world, holder, mobile, (key) => openChat(key, false));
  const focus = useFocusClock();
  return townCenterActions({
    focusing: !!focus.left,
    world,
    office,
    holder,
    selectedRoomKey,
    rooms,
    summary,
    openChat,
    toast,
  });
}

/** What the ring offers, from the town as it is now. */
export function townCenterActions({
  world,
  office,
  holder,
  selectedRoomKey,
  rooms,
  summary,
  openChat,
  toast,
  focusing = false,
}: {
  world: Pick<WorldObject, "leaves">;
  office: Pick<HerdrOfficeProjection, "rooms" | "roster">;
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  selectedRoomKey: string | null;
  rooms: RoomActions;
  summary: { open(): void };
  openChat(agentKey: string): void;
  toast(kind: "ok" | "error", text: string): void;
  /**
   * Whether a focus session runs: Focus then reads "On". The ring shows no
   * counts or numbers (#1261), so not its time left.
   */
  focusing?: boolean;
}): TownCenterAction[] {
  const launchRoom =
    selectedRoomKey && rooms.canCreateSeat(selectedRoomKey)
      ? (office.rooms.find((room) => room.key === selectedRoomKey) ?? null)
      : null;
  const roomBlocked = !rooms.canCreateRoom(selectedRoomKey);
  return [
    launchAction(
      launchRoom
        ? {
            label: launchRoom.displayLabel,
            run: () => rooms.onNewAgent(launchRoom.key, "center"),
          }
        : null,
    ),
    townMasterAction({
      world,
      roster: office.roster,
      holder,
      openChat,
      toast,
    }),
    focusAction(focusing ? "On" : null),
    summaryAction(() => summary.open()),
    profilesAction(),
    {
      id: "room",
      label: "New room",
      icon: DoorOpen,
      disabled: roomBlocked,
      detail: roomBlocked
        ? (rooms.createRoomReason(selectedRoomKey) ?? "Unavailable")
        : undefined,
      run: () => rooms.onCreateRoom(selectedRoomKey),
    },
  ];
}

/**
 * New agent: in `room` (a workspace, by its label) when given, else the
 * launcher asks where.
 */
export function launchAction(
  room: { label: string; run(): void } | null,
): TownCenterAction {
  return {
    id: "launch",
    label: "New agent",
    icon: UserPlus,
    detail: room ? `in ${room.label}` : undefined,
    primary: true,
    run: () => (room ? room.run() : requestAgentLaunch({}, "center")),
  };
}

/**
 * Talk to the synced Town master, or choose one in Sounds.
 */
export function townMasterAction<T extends TownMasterAgent>({
  world,
  roster,
  holder,
  openChat,
  toast,
}: {
  world: Pick<WorldObject, "leaves">;
  roster: readonly { agent: T }[];
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  openChat(agentKey: string): void;
  toast(kind: "ok" | "error", text: string): void;
}): TownCenterAction {
  if (!holder)
    // Nobody holds the role: Sounds is where the owner gives it.
    return {
      id: "master",
      label: "Town master",
      icon: Crown,
      detail: "Choose one",
      run: openSounds,
    };
  const talkToMaster = async () => {
    const master = await resolveTownMaster(world, roster, holder).catch(
      () => undefined,
    );
    if (!master) {
      toast("error", "The Town master isn't in Town now");
      return;
    }
    if (master.stale || !master.canOpenInSpaces) {
      toast("error", `${master.displayLabel} can't be opened now`);
      return;
    }
    openChat(master.key);
  };
  return {
    id: "master",
    label: "Town master",
    icon: Crown,
    run: () => void talkToMaster(),
  };
}

/** Needs you, with its count when the view knows it. */
export const needsYouAction = (count?: number): TownCenterAction => ({
  id: "needs-you",
  label: "Needs you",
  icon: Inbox,
  count,
  run: () => openNeedsYou(),
});

/**
 * Focus (#1131): start a session that holds chimes and notifications, or,
 * while one runs, its time left and End now.
 */
export const focusAction = (left: string | null = null): TownCenterAction => ({
  id: "focus",
  label: "Focus",
  icon: Headphones,
  detail: left ?? undefined,
  run: openFocus,
});

/**
 * Town's summary: who needs you, finishes, hosts and their rooms, and spend.
 * `detail` says where it opens, from a view other than Town.
 */
export const summaryAction = (
  open: () => void,
  detail?: string,
): TownCenterAction => ({
  id: "summary",
  label: "Summary",
  icon: ClipboardList,
  detail,
  run: open,
});

/** Finished agents, searchable and resumable (apartments/). */
export const apartmentsAction = (residents?: number): TownCenterAction => ({
  id: "apartments",
  label: "Apartments",
  icon: Building2,
  detail: residents ? `${residents} residents` : undefined,
  run: () => openApartments(),
});

/** The agent profiles, in the profile editor. */
export const profilesAction = (): TownCenterAction => ({
  id: "profiles",
  label: "Profiles",
  icon: Shirt,
  run: () => openProfileEditor(),
});

/**
 * The Library (#1027): what agents and projects remember, on `request`'s
 * host, project or agent when given.
 */
export const libraryAction = (
  request: MemoryLibraryRequest = {},
  detail?: string,
): TownCenterAction => ({
  id: "library",
  label: "Library",
  icon: LibraryBig,
  detail,
  run: () => openMemoryLibrary(request),
});
