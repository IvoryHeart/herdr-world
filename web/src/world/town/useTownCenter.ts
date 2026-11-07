/**
 * The town center's actions (TownCenterMenu.tsx), each reusing what World
 * already has: the agent launcher and profiles, the Town master's chat,
 * Needs you, the Town summary and room creation. Board's hub beside the bin
 * (board/BoardHub.tsx) offers the same actions, built by the same helpers.
 */

import {
  ClipboardList,
  Crown,
  DoorOpen,
  Inbox,
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
import { openNeedsYou } from "../needsYou";
import type { WorldObject } from "../worldObject";
import type { TownCenterAction } from "./TownCenterMenu";
import type { TownRoomActions } from "./TownCanvas";
import { findTownMaster } from "./townMaster";
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

/**
 * The Town master: the agent given the role (Settings → Sounds, Make Town
 * master), else, only when nobody holds the role, the one matching Menu →
 * Town master by Herdr name, then label, as the docked chat finds it. An
 * assigned holder absent from Town is unavailable: the name never stands in
 * for it, since a same-named agent may live on another connection.
 */
export async function resolveTownMaster<T extends TownMasterAgent>(
  world: Pick<WorldObject, "leaves">,
  roster: readonly { agent: T }[],
  holder: { connection_id: string; terminal_id: string } | null,
  name: string,
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
  return findTownMaster(roster, name);
}

/**
 * The center's actions, newest state each render. It also docks the Town
 * master's chat once per visit on wide screens (useTownMaster).
 */
export function useTownCenter(
  world: WorldObject,
  office: HerdrOfficeProjection,
  /** Menu → Town master: the agent's Herdr name or label. */
  { townMaster }: { townMaster: string },
  {
    selectedRoomKey,
    townRoomActions: rooms,
    townSummary: summary,
    openChat,
  }: {
    /** The room in view: a new agent starts there when it can. */
    selectedRoomKey: string | null;
    townRoomActions: RoomActions;
    townSummary: { summary: { counts: { needsYou: number } }; open(): void };
    openChat(agentKey: string, focus?: boolean): void;
  },
  toast: (kind: "ok" | "error", text: string) => void,
): TownCenterAction[] {
  const { mobile } = useLayoutPreferences();
  useTownMaster(office.roster, townMaster, mobile, (key) =>
    openChat(key, false),
  );
  const holder = useAgentProfiles().document?.town_master ?? null;
  return townCenterActions({
    world,
    office,
    holder,
    name: townMaster.trim(),
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
  name,
  selectedRoomKey,
  rooms,
  summary,
  openChat,
  toast,
}: {
  world: Pick<WorldObject, "leaves">;
  office: Pick<HerdrOfficeProjection, "rooms" | "roster">;
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  /** Menu → Town master, trimmed. */
  name: string;
  selectedRoomKey: string | null;
  rooms: RoomActions;
  summary: { summary: { counts: { needsYou: number } }; open(): void };
  openChat(agentKey: string): void;
  toast(kind: "ok" | "error", text: string): void;
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
            run: () => rooms.onNewAgent(launchRoom.key),
          }
        : null,
    ),
    townMasterAction({
      world,
      roster: office.roster,
      holder,
      name,
      openChat,
      toast,
    }),
    needsYouAction(summary.summary.counts.needsYou),
    {
      id: "summary",
      label: "Summary",
      icon: ClipboardList,
      run: () => summary.open(),
    },
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
    run: () => (room ? room.run() : requestAgentLaunch({})),
  };
}

/**
 * Talk to the Town master (resolveTownMaster), or, while nobody holds the
 * role and Menu → Town master is empty, choose one in Sounds.
 */
export function townMasterAction<T extends TownMasterAgent>({
  world,
  roster,
  holder,
  name,
  openChat,
  toast,
}: {
  world: Pick<WorldObject, "leaves">;
  roster: readonly { agent: T }[];
  /** The agent given the Town master role, if any. */
  holder: { connection_id: string; terminal_id: string } | null;
  /** Menu → Town master, trimmed. */
  name: string;
  openChat(agentKey: string): void;
  toast(kind: "ok" | "error", text: string): void;
}): TownCenterAction {
  if (!holder && !name)
    // Nobody holds the role: Sounds is where the owner gives it.
    return {
      id: "master",
      label: "Town master",
      icon: Crown,
      detail: "Choose one",
      run: openSounds,
    };
  const talkToMaster = async () => {
    const master = await resolveTownMaster(world, roster, holder, name).catch(
      () => undefined,
    );
    if (!master) {
      toast(
        "error",
        holder
          ? "The Town master isn't in Town now"
          : `No Town master in Town${name ? ` named ${name}` : ""}`,
      );
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
    // The role holder wins over the name; its name is its own.
    detail: holder ? undefined : name,
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

/** The agent profiles, in the profile editor. */
export const profilesAction = (): TownCenterAction => ({
  id: "profiles",
  label: "Profiles",
  icon: Shirt,
  run: () => openProfileEditor(),
});
