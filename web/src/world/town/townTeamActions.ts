import type {
  HerdrOfficeProjection,
  OfficeDesk,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";
import type { DeskPins } from "../useDeskPins";
import { groupTerminals, ungroupTerminals } from "../relations";
import { terminalColorKey } from "../terminalColor";
import {
  terminalKey,
  type Relation,
  type TerminalRef,
} from "../../../../shared/relations";
import { officeDeskKey } from "../officeRoom";
import { townDeskColorTarget } from "./townModel";
import type { TownMoveResult } from "./townMoves";
import type { TownJoinRequest } from "./townJoinSeats";

/** What Town's team actions need from the view (TownView.tsx). */
export type TownTeamDeps = {
  world: Pick<WorldObject, "hosts">;
  office: HerdrOfficeProjection;
  deskPins: DeskPins;
  relations: readonly Relation[];
  movingKey: string | null;
  deskForKey(key: string): OfficeDesk | null;
  roomForKey(key: string | null): OfficeRoom | null;
  toast(kind: "ok" | "error", text: string): void;
  confirm(message: string, run: () => void): void;
  runDeskMove(
    deskKey: string,
    roomKey: string,
    allowCloseRoom: boolean,
    then: (tabId: string) => Promise<void>,
  ): Promise<TownMoveResult>;
  /** Close the desk's menu, or open its "Group with…" step. */
  closeMenu(): void;
  openGroupMenu(deskKey: string): void;
  /** Seat a desk beside its new teammate in Town (townJoinSeats.ts). */
  seatJoin(request: TownJoinRequest): void;
  /** Board's writes; tests replace them. */
  io?: {
    groupTerminals: typeof groupTerminals;
    ungroupTerminals: typeof ungroupTerminals;
  };
};

export type TownMenuEntry = {
  key: string;
  label: string;
  detail: string;
  onChoose(): void;
};

/**
 * Group and ungroup desks in Town (relations.ts): by a magnetic drag, or from
 * a desk's move menu (M) without one. Joining moves no other desk: the desk
 * takes a free cell beside its teammate and Herdr's tab order stays as it is
 * (townJoinSeats.ts).
 */
export function townTeamActions(deps: TownTeamDeps) {
  const { toast } = deps;
  const io = deps.io ?? { groupTerminals, ungroupTerminals };
  /** Pinned in Town (useDeskPins.ts, keyed like the desk's colour). */
  const deskPinned = (desk: OfficeDesk) => {
    const target = townDeskColorTarget(deps.office, desk);
    return Boolean(target && deps.deskPins[terminalColorKey(target)]);
  };
  /** Every terminal at a desk, as World observed its host. */
  const deskTerminals = (desk: OfficeDesk): TerminalRef[] =>
    (
      deps.world.hosts.find(
        (host) => host.connectionId === desk.tabRef.connectionId,
      )?.spaces ?? []
    )
      .flatMap((space) => space.children)
      .filter((leaf) => leaf.tabId === desk.tabRef.nativeId)
      // Its agent first: a group holds one terminal per desk.
      .sort((a, b) => Number(b.kind === "agent") - Number(a.kind === "agent"))
      .slice(0, 16)
      .map((leaf) => ({
        connection_id: desk.tabRef.connectionId,
        terminal_id: leaf.terminalId,
      }));
  const runGroupDesk = async (
    deskKey: string,
    targetKey: string,
    allowCloseRoom = false,
  ): Promise<TownMoveResult> => {
    const desk = deps.deskForKey(deskKey);
    const target = deps.deskForKey(targetKey);
    if (!desk || !target || deps.movingKey) return "returned";
    const members = deskTerminals(desk).slice(0, 1);
    const with_ = deskTerminals(target).slice(0, 1);
    if (!members.length || !with_.length) {
      toast("error", `${desk.displayLabel} was not grouped: no terminals seen`);
      return "returned";
    }
    // A pinned desk stays put: it joins a team in its own room only.
    const pinned = deskPinned(desk);
    if (pinned && desk.roomKey !== target.roomKey) {
      toast(
        "error",
        `${desk.displayLabel} is pinned: unpin it to join a team in another room`,
      );
      return "returned";
    }
    // Joining brings the desk to the team's room: ask before grouping when
    // that closes its own, so cancelling leaves it as it was.
    const source = deps.roomForKey(desk.roomKey);
    if (
      !allowCloseRoom &&
      desk.roomKey !== target.roomKey &&
      (source?.observedDeskCount ?? 2) <= 1
    ) {
      deps.confirm(
        `“${desk.displayLabel}” is the last desk in “${source?.displayLabel}”. Joining “${target.displayLabel}” moves it and closes that room.`,
        () => void runGroupDesk(deskKey, targetKey, true),
      );
      return "returned";
    }
    const problem = await io.groupTerminals(members, with_);
    if (problem) {
      toast("error", `${desk.displayLabel} was not grouped: ${problem}`);
      return "returned";
    }
    toast("ok", `${desk.displayLabel} joined ${target.displayLabel}`);
    const from = { fromDeskKey: desk.key, fromRoomKey: desk.roomKey };
    // Bring it to the team's room (its tab gets a new ID there), then seat it
    // next to its teammate.
    if (desk.roomKey !== target.roomKey)
      return deps.runDeskMove(
        deskKey,
        target.roomKey,
        allowCloseRoom,
        async (tabId) =>
          deps.seatJoin({
            ...from,
            deskKey: officeDeskKey(desk.tabRef.connectionId, tabId),
            targetKey: target.key,
          }),
      );
    // A pinned desk keeps its cell.
    if (!pinned) deps.seatJoin({ ...from, deskKey, targetKey: target.key });
    return "returned";
  };
  const runUngroupDesk = async (deskKey: string): Promise<TownMoveResult> => {
    const desk = deps.deskForKey(deskKey);
    if (!desk) return "returned";
    const problem = await io.ungroupTerminals(deskTerminals(desk));
    toast(
      problem ? "error" : "ok",
      problem
        ? `${desk.displayLabel} is still in its team: ${problem}`
        : `${desk.displayLabel} left its team`,
    );
    return "returned";
  };
  /** A desk menu's team entries: join another desk's team, or leave one. */
  const teamEntries = (desk: OfficeDesk | null): TownMenuEntry[] => {
    if (!desk) return [];
    const terminals = deskTerminals(desk);
    const grouped = deps.relations.some(
      (relation) =>
        relation.evidence.some((entry) => entry.kind === "manual") &&
        terminals.some(
          (ref) =>
            terminalKey(ref) === terminalKey(relation.a) ||
            terminalKey(ref) === terminalKey(relation.b),
        ),
    );
    return [
      {
        key: `${desk.key}:group`,
        label: "Group with…",
        detail: "Join another desk's team",
        onChoose: () => deps.openGroupMenu(desk.key),
      },
      ...(grouped
        ? [
            {
              key: `${desk.key}:ungroup`,
              label: "Leave the team",
              detail: "Stay here, outside the team",
              onChoose: () => {
                deps.closeMenu();
                void runUngroupDesk(desk.key);
              },
            },
          ]
        : []),
    ];
  };
  /** The "Group with…" step: the desks on its host it can join. */
  const groupMenu = (deskKey: string) => {
    const desk = deps.deskForKey(deskKey);
    const mates = desk
      ? deps.office.deskRoster
          .map(({ desk: other }) => other)
          .filter(
            (other) =>
              other.key !== desk.key &&
              other.hostKey === desk.hostKey &&
              other.tabRef.connectionId === desk.tabRef.connectionId,
          )
      : [];
    return {
      title: `Group ${desk?.displayLabel ?? "desk"} with…`,
      detail: mates.length
        ? "Choose a desk on this host; the desk joins its room"
        : "No other desk on this host",
      entries: mates.map((other) => ({
        key: other.key,
        label: other.displayLabel,
        detail: deps.roomForKey(other.roomKey)?.displayLabel ?? "",
        onChoose: () => {
          deps.closeMenu();
          void runGroupDesk(deskKey, other.key);
        },
      })),
    };
  };
  return { runGroupDesk, runUngroupDesk, teamEntries, groupMenu };
}
