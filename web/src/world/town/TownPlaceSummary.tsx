import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { officeReadModel } from "../officeReadModel";
import { OfficeCanvasCallout } from "../OfficeCanvasCallout";
import { officeCalloutForKey } from "../officeSelection";
import type { WorldCanvasHover } from "../worldConnectorGeometry";
import type { TownAskActions } from "./TownRail";
import type { TownAsker } from "./townAskers";
import type { TownRoomActions } from "./TownCanvas";
import { townPlaceSummary, type TownSummary } from "./townSummary";
import { TownSummaryPanel, TownSummaryStatusCounts } from "./TownSummaryPanel";
import "./townPlaceSummary.css";

export type TownPlaceSummaryAnchor = Pick<
  DOMRect,
  "left" | "right" | "top" | "bottom"
>;
export type ShowTownPlaceSummary = (
  key: string | null,
  anchor?: TownPlaceSummaryAnchor,
  pinned?: boolean,
) => void;

/** One card at a time; hover, keyboard focus and touch share the same content. */
export function useTownPlaceSummary(
  office: HerdrOfficeProjection,
  summary: TownSummary,
  askers: ReadonlyMap<string, TownAsker>,
) {
  const [sceneHover, setSceneHover] = useState<WorldCanvasHover | null>(null);
  const [target, setTarget] = useState<{
    key: string;
    anchor: TownPlaceSummaryAnchor;
    pinned: boolean;
  } | null>(null);
  const current = useRef(target);
  current.current = target;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const hold = useCallback(() => {
    held.current = true;
    clearTimeout(timer.current);
  }, []);
  const close = useCallback(() => {
    held.current = false;
    clearTimeout(timer.current);
    setTarget(null);
  }, []);
  const show = useCallback<ShowTownPlaceSummary>(
    (key, anchor, pinned = false) => {
      if (held.current && !pinned) return;
      clearTimeout(timer.current);
      if (key && anchor) {
        if (current.current?.pinned && !pinned) return;
        setTarget({ key, anchor, pinned });
      } else if (!current.current?.pinned) {
        timer.current = setTimeout(() => setTarget(null), 180);
      }
    },
    [],
  );
  const release = () => {
    held.current = false;
    show(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!target) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          ".town-place-summary, [data-town-place-summary-trigger]",
        )
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
    };
  }, [Boolean(target), close]);
  const place = useMemo(
    () =>
      target ? townPlaceSummary(office, summary, target.key, askers) : null,
    [office, summary, target?.key, askers],
  );
  useEffect(() => {
    if (target && !place) close();
  }, [target, place, close]);
  const hover = (
    next: WorldCanvasHover | null,
    pointer: { current: { x: number; y: number } | null },
    hoverAgent: (key: string | null, anchor?: { x: number; y: number }) => void,
  ) => {
    if (held.current) return;
    // Room labels own their enter/leave lifecycle. The canvas beneath a label
    // can publish a delayed leave; it must not dismiss or replace that card.
    const currentKey = current.current?.key;
    if (currentKey && office.roomRoster.some(({ key }) => key === currentKey))
      return;
    const anchor = next ? { x: next.clientX, y: next.clientY } : undefined;
    if (anchor) pointer.current = anchor;
    const agent = next && officeReadModel(office).agentOf(next.key);
    const desk =
      !agent &&
      next &&
      office.deskRoster.find(({ desk }) => desk.key === next.key);
    if (desk && next)
      show(next.key, {
        left: next.clientX,
        right: next.clientX,
        top: next.clientY,
        bottom: next.clientY,
      });
    else show(null);
    setSceneHover(agent || desk ? null : next);
    hoverAgent(agent && next ? next.key : null, anchor);
  };
  return {
    target,
    place,
    show,
    hold,
    release,
    close,
    hover,
    sceneHover,
    office,
  };
}

export function TownPlaceSummaryCard({
  preview,
  now,
  onOpenAgent,
  askActions,
  selectedKey,
  roomActions,
}: {
  preview: ReturnType<typeof useTownPlaceSummary>;
  now: number;
  onOpenAgent(key: string): void;
  askActions: TownAskActions;
  selectedKey: string | null;
  roomActions: Pick<
    TownRoomActions,
    "canRenameRoom" | "onRenameRoom" | "canCloseRoom" | "onCloseRoom"
  >;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 440 });
  const { target, place, hold, release, show, close } = preview;
  const room =
    target && preview.office.roomRoster.find(({ key }) => key === target.key);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !target) return;
    const box = card.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(target.anchor.left, window.innerWidth - box.width - 8),
    );
    const belowSpace = window.innerHeight - target.anchor.bottom - 16;
    const aboveSpace = target.anchor.top - 16;
    const desired = Math.min(440, card.scrollHeight + 2);
    const below = desired <= belowSpace || belowSpace >= aboveSpace;
    const maxHeight = Math.max(
      40,
      Math.min(440, below ? belowSpace : aboveSpace),
    );
    const height = Math.min(desired, maxHeight);
    const top = below
      ? target.anchor.bottom + 8
      : Math.max(8, target.anchor.top - height - 8);
    setPosition({ left, top, maxHeight });
  }, [target, place]);
  if (!target || !place) {
    const hover = preview.sceneHover;
    return hover && hover.key !== selectedKey ? (
      <OfficeCanvasCallout
        callout={officeCalloutForKey(preview.office, hover.key)}
        left={hover.clientX}
        top={hover.clientY}
      />
    ) : null;
  }
  return createPortal(
    <div
      ref={ref}
      className="town-place-summary"
      style={position}
      role="dialog"
      aria-label={`Summary of ${place.label}`}
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocusCapture={() => show(target.key, target.anchor, true)}
    >
      <header>
        <strong>{place.label}</strong>
        <button type="button" aria-label="Close place summary" onClick={close}>
          ×
        </button>
      </header>
      {room ? (
        <div
          className="town-place-summary-actions"
          role="group"
          aria-label={`Room actions for ${place.label}`}
        >
          <button
            type="button"
            aria-label={`Rename room ${place.label}`}
            disabled={!roomActions.canRenameRoom(room.key)}
            onClick={() => {
              close();
              roomActions.onRenameRoom(room.key);
            }}
          >
            <Pencil size={14} aria-hidden="true" /> Rename
          </button>
          <button
            type="button"
            aria-label={`Close room ${place.label}`}
            disabled={!roomActions.canCloseRoom(room.key)}
            onClick={() => {
              close();
              roomActions.onCloseRoom(room.key);
            }}
          >
            <Trash2 size={14} aria-hidden="true" /> Close
          </button>
        </div>
      ) : null}
      <TownSummaryStatusCounts counts={place.agentCounts} />
      <TownSummaryPanel
        compact
        summary={place}
        now={now}
        onOpenAgent={(key) => {
          close();
          onOpenAgent(key);
        }}
        onShowRoom={() => {}}
        askActions={askActions}
      />
    </div>,
    document.body,
  );
}
