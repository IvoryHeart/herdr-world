/**
 * The town center's actions (TownCenterMenu.tsx), each reusing what World
 * already has: the agent launcher and profiles, the Town master's chat,
 * Needs you, the Town summary and room creation.
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
 * master), else the one matching Menu → Town master by Herdr name, then
 * label, as the docked chat finds it.
 */
export async function resolveTownMaster(
  world: Pick<WorldObject, "leaves">,
  roster: readonly { agent: OfficeAgent }[],
  holder: { connection_id: string; terminal_id: string } | null,
  name: string,
): Promise<OfficeAgent | undefined> {
  if (holder) {
    const leaf = world.leaves.find(
      (candidate) =>
        candidate.connectionId === holder.connection_id &&
        candidate.terminalId === holder.terminal_id,
    );
    const agent = leaf
      ? roster.find(({ agent }) => agent.key === leaf.id)?.agent
      : undefined;
    if (agent) return agent;
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
    rooms,
    summary,
    mobile,
    openChat,
    toast,
  }: {
    /** The room in view: a new agent starts there when it can. */
    selectedRoomKey: string | null;
    rooms: RoomActions;
    summary: { summary: { counts: { needsYou: number } }; open(): void };
    mobile: boolean;
    openChat(agentKey: string, focus?: boolean): void;
    toast(kind: "ok" | "error", text: string): void;
  },
): TownCenterAction[] {
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
  const talkToMaster = async () => {
    const master = await resolveTownMaster(
      world,
      office.roster,
      holder,
      name,
    ).catch(() => undefined);
    if (!master) {
      toast("error", `No Town master in Town${name ? ` named ${name}` : ""}`);
      return;
    }
    if (master.stale || !master.canOpenInSpaces) {
      toast("error", `${master.displayLabel} can't be opened now`);
      return;
    }
    openChat(master.key);
  };
  return [
    {
      id: "launch",
      label: "New agent",
      icon: UserPlus,
      detail: launchRoom ? `in ${launchRoom.displayLabel}` : undefined,
      primary: true,
      run: () =>
        launchRoom ? rooms.onNewAgent(launchRoom.key) : requestAgentLaunch({}),
    },
    holder || name
      ? {
          id: "master",
          label: "Town master",
          icon: Crown,
          // The role holder wins over the name; its name is its own.
          detail: holder ? undefined : name,
          run: () => void talkToMaster(),
        }
      : {
          // Nobody holds the role: Sounds is where the owner gives it.
          id: "master",
          label: "Town master",
          icon: Crown,
          detail: "Choose one",
          run: openSounds,
        },
    {
      id: "needs-you",
      label: "Needs you",
      icon: Inbox,
      count: summary.summary.counts.needsYou,
      run: () => openNeedsYou(),
    },
    {
      id: "summary",
      label: "Summary",
      icon: ClipboardList,
      run: () => summary.open(),
    },
    {
      id: "profiles",
      label: "Profiles",
      icon: Shirt,
      run: () => openProfileEditor(),
    },
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
