import { useSyncExternalStore, type CSSProperties } from "react";
import { AGENT_MARKS } from "../agentMarks";
import {
  townEdgeArrowLabel,
  townEdgeArrowsEqual,
  type TownEdgeArrow,
  type TownEdgeMark,
} from "./townEdgeArrows";
import "./townEdgeArrows.css";

/** Town's mark for each edge mark (agentMarks.ts). */
const KIND: Record<TownEdgeMark, keyof typeof AGENT_MARKS> = {
  needs: "needs",
  asks: "asks",
  done: "done",
};

/**
 * The arrows the canvas computes each frame; the arrow layer renders only
 * when they change on screen, so a still town renders nothing.
 */
export class TownEdgeArrowStore {
  private arrows: readonly TownEdgeArrow[] = [];
  private readonly listeners = new Set<() => void>();
  get = () => this.arrows;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(next: readonly TownEdgeArrow[]) {
    if (townEdgeArrowsEqual(this.arrows, next)) return;
    this.arrows = next;
    for (const listener of this.listeners) listener();
  }
}

/** Arrows pinned to the Town view's edges, to what needs you off screen. */
export function TownEdgeArrows({
  store,
  buildingLabel,
  onGo,
}: {
  store: TownEdgeArrowStore;
  buildingLabel: (hostKey: string) => string;
  onGo: (arrow: TownEdgeArrow) => void;
}) {
  const arrows = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (!arrows.length) return null;
  return (
    <div className="town-edge-arrows">
      {arrows.map((arrow) => {
        const label = townEdgeArrowLabel(arrow, buildingLabel);
        return (
          <button
            key={arrow.id}
            type="button"
            className="town-edge-arrow"
            data-mark={arrow.mark}
            data-compass={arrow.compass}
            style={
              {
                left: `${arrow.x}px`,
                top: `${arrow.y}px`,
                "--angle": `${arrow.angle}rad`,
              } as CSSProperties
            }
            aria-label={label}
            title={label}
            onClick={() => onGo(arrow)}
          >
            <span className="town-edge-arrow-tip" aria-hidden="true" />
            <span className="town-edge-arrow-mark" aria-hidden="true">
              {AGENT_MARKS[KIND[arrow.mark]].glyph}
            </span>
            {arrow.count > 1 ? (
              <b className="town-edge-arrow-count" aria-hidden="true">
                {arrow.count}
              </b>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A brief ring on the agent an arrow or Next went to, in world pixels,
 * shown once the camera has arrived. */
export type TownPulse = {
  seq: number;
  mark: TownEdgeMark;
  x: number;
  y: number;
};

export function TownPulseRing({ pulse }: { pulse: TownPulse | null }) {
  if (!pulse) return null;
  return (
    <span
      key={pulse.seq}
      className="town-pulse"
      data-mark={pulse.mark}
      aria-hidden="true"
      style={{
        left: `${pulse.x}px`,
        top: `${pulse.y}px`,
      }}
    />
  );
}

/** Next's transient position, "2 of 7 · N next", read out politely. */
export function TownNextLabel({ text }: { text: string }) {
  return (
    <div
      className="town-next-label"
      role="status"
      aria-live="polite"
      hidden={!text}
    >
      {text}
    </div>
  );
}

/** The edge arrows and Next's label, laid over the Town view. */
export function TownEdgeOverlay({
  edge,
}: {
  edge: {
    arrowStore: TownEdgeArrowStore;
    buildingLabel: (hostKey: string) => string;
    goToArrow: (arrow: TownEdgeArrow) => void;
    nextText: string;
  };
}) {
  return (
    <>
      <TownEdgeArrows
        store={edge.arrowStore}
        buildingLabel={edge.buildingLabel}
        onGo={edge.goToArrow}
      />
      <TownNextLabel text={edge.nextText} />
    </>
  );
}
