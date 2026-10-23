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
import { townDeskColorTarget } from "./townModel";
import {
  requestDeskReorder,
  type TownMoveOutcome,
  type TownMoveResult,
} from "./townMoves";

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
  /** Board's and Herdr's writes; tests replace them. */
  io?: {
    groupTerminals: typeof groupTerminals;
    ungroupTerminals: typeof ungroupTerminals;
    requestDeskReorder: typeof requestDeskReorder;
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
 * a desk's move menu (M) without one. Herdr owns the tab order, so joining a
 * team moves the desk's tab beside its teammate's through Herdr.
 */
export function townTeamActions(deps: TownTeamDeps) {
  const { toast } = deps;
  const io = deps.io ?? {
    groupTerminals,
    ungroupTerminals,
    requestDeskReorder,
  };
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
  /**
   * Seat a desk's tab next to its teammate's in Herdr, which owns the order:
   * it takes the teammate's slot, as a reorder does. Town and Spaces follow
   * what Herdr then reports.
   */
  const seatBeside = async (
    desk: OfficeDesk,
    tabId: string,
    target: OfficeDesk,
  ) => {
    // After a move to the team's room the tab has a new ID there.
    const moved = {
      ...desk,
      roomKey: target.roomKey,
      tabRef: { ...desk.tabRef, nativeId: tabId },
    };
    const outcome = await io.requestDeskReorder(moved, target).catch(
      (cause): TownMoveOutcome => ({
        status: "refused",
        reason: "tab_move",
        message: String(cause),
      }),
    );
    if (outcome.status !== "moved")
      toast(
        "error",
        `${desk.displayLabel} joined the team but kept its place: ${outcome.message}`,
      );
  };
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
    // Bring it to the team's room and next to its teammate, through Herdr.
    if (desk.roomKey !== target.roomKey)
      return deps.runDeskMove(
        deskKey,
        target.roomKey,
        allowCloseRoom,
        (tabId) => seatBeside(desk, tabId, target),
      );
    // A pinned desk keeps its cell whatever the tab order: leave Herdr be.
    if (!pinned) await seatBeside(desk, desk.tabRef.nativeId, target);
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
