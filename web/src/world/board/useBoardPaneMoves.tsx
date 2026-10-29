import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../../components/ModalDialogs";
import { measuredFixedPositionScale } from "../../fixedPositionScale";
import { townMoveNotice } from "../town/townMoves";
import type { GestureTarget, Point } from "./boardGesture";
import type { BoardModel, BoardPane, BoardTab } from "./boardModel";
import {
  boardPaneMoveReason,
  moveBoardPane,
  type BoardPaneMove,
  type BoardPaneMoveRequest,
} from "./boardPaneMove";
import "./boardPaneMoves.css";

type Job = { pane: BoardPane; source: BoardTab; target: BoardTab };
type Held = {
  pane: BoardPane;
  source: BoardTab;
  element: HTMLDivElement;
  origin: Element | null;
  over: string | null;
  overElement: Element | null;
};

/** Adapts the shared mouse/touch gesture to a single-pane move, leaving the card in place. */
export function useBoardPaneMoves(props: {
  model: BoardModel;
  move?: BoardPaneMove;
  notice(message: string): void;
  moved(): void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const held = useRef<Held | null>(null);
  const busy = useRef(false);
  const [confirm, setConfirm] = useState<Job | null>(null);
  const cancel = useCallback(() => {
    const drag = held.current;
    if (!drag) return false;
    held.current = null;
    drag.element.remove();
    drag.origin?.classList.remove("board-pane-lifted");
    drag.overElement?.classList.remove("board-pane-move-target");
    return true;
  }, []);
  useEffect(
    () => () => {
      cancel();
    },
    [cancel],
  );

  const run = async (job: Job, allowClose: boolean) => {
    if (busy.current) return;
    setConfirm(null);
    const current = latest.current;
    const source = current.model.tabByKey.get(job.source.key);
    const target = current.model.tabByKey.get(job.target.key);
    const pane = source?.panes.find((entry) => entry.key === job.pane.key);
    const sourceWorkspace =
      source && current.model.workspaceByKey.get(source.workspaceKey);
    const targetWorkspace =
      target && current.model.workspaceByKey.get(target.workspaceKey);
    if (
      !source ||
      !target ||
      !pane ||
      !sourceWorkspace ||
      !targetWorkspace ||
      pane.leaf.terminalId !== job.pane.leaf.terminalId ||
      pane.leaf.generation !== job.pane.leaf.generation ||
      pane.leaf.agentSessionFingerprint !==
        job.pane.leaf.agentSessionFingerprint
    ) {
      current.notice("The pane or host changed. Try again.");
      return;
    }
    const request: BoardPaneMoveRequest = {
      pane,
      source,
      target,
      sourceWorkspace,
      targetWorkspace,
    };
    const reason = boardPaneMoveReason(request);
    if (reason) {
      current.notice(reason);
      return;
    }
    busy.current = true;
    current.notice(
      `Moving ${pane.leaf.agentName ?? pane.leaf.label} to ${target.label}…`,
    );
    try {
      const outcome = await (current.move ?? moveBoardPane)(
        request,
        allowClose,
      );
      if (
        outcome.status === "refused" &&
        outcome.reason === "room_would_close" &&
        !allowClose
      ) {
        setConfirm(job);
      } else {
        latest.current.notice(
          townMoveNotice(
            pane.leaf.agentName ?? pane.leaf.label,
            outcome,
            source.nativeId,
          ),
        );
        if (outcome.status === "moved") latest.current.moved();
      }
    } catch (error) {
      latest.current.notice(
        `The pane's location could not be confirmed: ${String(error)}. Check both tabs.`,
      );
    } finally {
      busy.current = false;
    }
  };
  const move = (at: Point) => {
    const drag = held.current;
    if (!drag) return false;
    const scale = measuredFixedPositionScale();
    drag.element.style.left = `${(at.x + 12) / scale}px`;
    drag.element.style.top = `${(at.y + 12) / scale}px`;
    const under = document
      .elementFromPoint(at.x, at.y)
      ?.closest<HTMLElement>(".board-tab");
    const over =
      under?.dataset.key && under.dataset.key !== drag.source.key
        ? under
        : null;
    drag.overElement?.classList.remove("board-pane-move-target");
    drag.overElement = over ?? null;
    drag.over = over?.dataset.key ?? null;
    drag.overElement?.classList.add("board-pane-move-target");
    return true;
  };
  const begin = (target: GestureTarget, at: Point) => {
    if (target.kind !== "card" || !target.paneKey) return false;
    const source = latest.current.model.tabByKey.get(target.key);
    const pane = source?.panes.find((entry) => entry.key === target.paneKey);
    if (!source || !pane) return true;
    if (busy.current || confirm) {
      latest.current.notice("Finish the pending pane move first.");
      return true;
    }
    cancel();
    const element = document.createElement("div");
    element.className = "board-pane-drag";
    element.textContent = pane.leaf.agentName ?? pane.leaf.label;
    document.body.appendChild(element);
    const origin = document.querySelector(
      `[data-pane="${CSS.escape(pane.key)}"]`,
    );
    origin?.classList.add("board-pane-lifted");
    held.current = {
      source,
      pane,
      element,
      origin,
      over: null,
      overElement: null,
    };
    move(at);
    return true;
  };
  const drop = (at: Point) => {
    if (!move(at)) return false;
    const drag = held.current!;
    const target = drag.over && latest.current.model.tabByKey.get(drag.over);
    cancel();
    if (target)
      void run({ pane: drag.pane, source: drag.source, target }, false);
    return true;
  };
  return {
    begin,
    move,
    drop,
    cancel,
    dialog: confirm
      ? createPortal(
          <ConfirmDialog
            open
            title="Move the room's last pane?"
            message="Moving this pane closes its original room. The terminal keeps running in the destination tab."
            confirmLabel="Move pane and close room"
            onConfirm={() => void run(confirm, true)}
            onClose={() => setConfirm(null)}
          />,
          document.body,
        )
      : null,
  };
}
