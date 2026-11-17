import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type { TownMoveResult } from "./townMoves";
import type { townTeamActions, TownMenuEntry } from "./townTeamActions";

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
    const slots = home?.desks ?? [];
    const lastDrawn = slots[slots.length - 1];
    const reorder = (ontoKey: string | null) => () => {
      deps.close();
      void deps.runDeskReorder(flow.deskKey, ontoKey);
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
        ...rooms.map((room) => ({
          key: room.key,
          label: room.displayLabel,
          detail: `${room.observedDeskCount} desks`,
          onChoose: () => {
            deps.close();
            void deps.runDeskMove(flow.deskKey, room.key);
          },
        })),
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
    entries: desks.map((desk) => ({
      key: desk.key,
      label: desk.displayLabel,
      detail: deps.roomForKey(desk.roomKey)?.displayLabel ?? "",
      onChoose: () => {
        deps.close();
        void deps.runAgentMove(flow.agentKey, desk.key);
      },
    })),
  };
}
