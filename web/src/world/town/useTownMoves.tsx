/**
 * Town's desk and agent moves: dropping or choosing a room or desk, the
 * confirmation before a move closes its room, one move at a time, and the
 * move and group menus (townMoveMenu.ts, townTeamActions.ts).
 */

import { useState } from "react";
import { ConfirmDialog } from "../../components/ModalDialogs";
import { inheritedColorKey } from "../../../../shared/terminalColor";
import type { ViewTrace } from "../devtools/flag";
import { DEVTOOLS } from "../devtools/flag";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type { Relation } from "../../../../shared/relations";
import { terminalColorKey, type TerminalColor } from "../terminalColor";
import type { WorldObject } from "../worldObject";
import type { DeskPins } from "../useDeskPins";
import { TownChooser } from "./TownChooser";
import { townDeskColorTarget } from "./townModel";
import { townMoveMenu, type TownMoveFlow } from "./townMoveMenu";
import {
  requestAgentMove,
  requestDeskMove,
  requestDeskReorder,
  townMoveNotice,
  townMoveResult,
  type TownMoveOutcome,
  type TownMoveResult,
} from "./townMoves";
import { townTeamActions } from "./townTeamActions";

export function useTownMoves({
  world,
  office,
  deskPins,
  relations,
  terminalColors,
  agentByKey,
  roomForKey,
  toast,
  trace,
}: {
  world: WorldObject;
  office: HerdrOfficeProjection;
  deskPins: DeskPins;
  relations: readonly Relation[];
  terminalColors: Readonly<Record<string, TerminalColor>>;
  agentByKey: { get(key: string): { agent: OfficeAgent } | undefined };
  roomForKey(roomKey: string | null): OfficeRoom | null;
  toast(kind: "ok" | "error", text: string): void;
  trace: ViewTrace;
}) {
  /** A desk or agent move being chosen: what to move, then where. */
  const [moveFlow, setMoveFlow] = useState<TownMoveFlow | null>(null);
  /** The desk or agent being moved; further moves wait for it. */
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    message: string;
    run(): void;
  } | null>(null);
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
    relations,
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
  const dialogs = (
    <>
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
    </>
  );
  return {
    moveFlow,
    setMoveFlow,
    deskForKey,
    runDeskMove,
    runDeskReorder,
    runAgentMove,
    teams,
    dialogs,
  };
}
