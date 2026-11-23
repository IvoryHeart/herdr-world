import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "../herdrOfficeProjection";
import { TOWN_PINNED_HINT } from "./townDrag";
import type { TownMoveResult } from "./townMoves";
import type { townTeamActions, TownMenuEntry } from "./townTeamActions";

/** A room's runtime icon, when its building holds more than one runtime. */
function townRoomRuntime(room: OfficeRoom | null) {
  return room?.runtimeTag && room.runtimeKind
    ? { runtime: { kind: room.runtimeKind, tag: room.runtimeTag } }
    : {};
}

/**
 * A room's runtime shows as an icon beside its name; its words join an
 * entry's detail only where two entries would otherwise read the same.
 */
function withRuntimeWords<
  T extends { label: string; detail: string; runtime?: { tag: string } },
>(entries: T[]): T[] {
  const reads = (entry: T) => `${entry.label}\n${entry.detail}`;
  const count = new Map<string, number>();
  for (const entry of entries)
    count.set(reads(entry), (count.get(reads(entry)) ?? 0) + 1);
  return entries.map((entry) =>
    entry.runtime && count.get(reads(entry))! > 1
      ? { ...entry, detail: `${entry.detail} · ${entry.runtime.tag}` }
      : entry,
  );
}

/** A move being chosen in Town: a desk's place or room, its team, or an agent's desk. */
export type TownMoveFlow =
  | { step: "room"; deskKey: string }
  | { step: "group"; deskKey: string }
  | { step: "desk"; agentKey: string };

/** What the move menu needs from the view (TownView.tsx). */
export type TownMoveMenuDeps = {
  office: HerdrOfficeProjection;
  deskForKey(key: string): OfficeDesk | null;
  roomForKey(key: string | null): OfficeRoom | null;
  agentOf(key: string): OfficeAgent | undefined;
  /** A room's pinned desks by desk key, front first (townPinOrder.ts). */
  pinnedSeats(room: OfficeRoom): string[];
  close(): void;
  runDeskReorder(deskKey: string, ontoKey: string | null): Promise<unknown>;
  runDeskMove(deskKey: string, roomKey: string): Promise<TownMoveResult>;
  runAgentMove(agentKey: string, deskKey: string): Promise<unknown>;
  teams: ReturnType<typeof townTeamActions>;
};

/**
 * The choices for each step of a move, the keyboard's way (M) to do what a
 * drag does: a place in the desk's room, another room, a team, or another
 * desk for an agent.
 */
export function townMoveMenu(
  flow: TownMoveFlow,
  deps: TownMoveMenuDeps,
): { title: string; detail: string; entries: TownMenuEntry[] } {
  if (flow.step === "room") {
    const desk = deps.deskForKey(flow.deskKey);
    const rooms = desk
      ? deps.office.rooms.filter(
          (room) =>
            room.hostKey === desk.hostKey &&
            room.key !== desk.roomKey &&
            room.workspaceRef.connectionId === desk.tabRef.connectionId,
        )
      : [];
    // Within its room a desk takes another desk's slot, as in a drag.
    const home = desk ? deps.roomForKey(desk.roomKey) : null;
    const reorder = (ontoKey: string | null) => () => {
      deps.close();
      void deps.runDeskReorder(flow.deskKey, ontoKey);
    };
    // A pinned desk moves only among the pinned seats, and an unpinned one
    // takes none of them, as in a drag.
    const pinned = home ? deps.pinnedSeats(home) : [];
    if (desk && pinned.includes(desk.key)) {
      const seats = pinned.filter((key) => key !== desk.key);
      return {
        title: `Move ${desk.displayLabel}`,
        detail: seats.length
          ? `Choose a pinned desk’s place. ${TOWN_PINNED_HINT}`
          : `No other pinned desk in this room. ${TOWN_PINNED_HINT}`,
        entries: [
          ...seats.map((key) => ({
            key,
            label: `${deps.deskForKey(key)?.displayLabel ?? "desk"}’s place`,
            detail: `Pinned desk ${pinned.indexOf(key) + 1} in ${home?.displayLabel}`,
            onChoose: reorder(key),
          })),
          ...deps.teams.teamEntries(desk),
        ],
      };
    }
    const slots = (home?.desks ?? []).filter(
      (other) => !pinned.includes(other.key),
    );
    const lastDrawn = slots[slots.length - 1];
    const places = [
      ...slots
        .filter((other) => other.key !== desk?.key)
        .map((other) => ({
          key: other.key,
          label: `${other.displayLabel}’s place`,
          detail: `Desk ${pinned.length + slots.indexOf(other) + 1} in ${home?.displayLabel}`,
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
              onChoose: reorder(home?.omittedDeskCount ? lastDrawn.key : null),
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
        ...withRuntimeWords(
          rooms.map((room) => ({
            key: room.key,
            label: room.displayLabel,
            detail: `${room.observedDeskCount} desks`,
            ...townRoomRuntime(room),
            onChoose: () => {
              deps.close();
              void deps.runDeskMove(flow.deskKey, room.key);
            },
          })),
        ),
        // Teams without a drag: join another desk's, or leave a manual one.
        ...deps.teams.teamEntries(desk),
      ],
    };
  }
  if (flow.step === "group") return deps.teams.groupMenu(flow.deskKey);
  const agent = deps.agentOf(flow.agentKey);
  const desks = agent
    ? deps.office.deskRoster
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
    entries: withRuntimeWords(
      desks.map((desk) => {
        const room = deps.roomForKey(desk.roomKey);
        return {
          key: desk.key,
          label: desk.displayLabel,
          detail: room?.displayLabel ?? "",
          ...townRoomRuntime(room),
          onChoose: () => {
            deps.close();
            void deps.runAgentMove(flow.agentKey, desk.key);
          },
        };
      }),
    ),
  };
}
