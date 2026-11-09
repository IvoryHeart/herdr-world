import { useCallback } from "react";
import {
  usageStopResetTime,
  usageStopText,
  type AgentUsageStop,
} from "../../../../shared/usageStop";
import { markAway } from "./townQuestPennant";
import type { TownRendererHandle } from "./townRenderer";
import { townFuelGlyphUrl } from "./townFuelGlyph";
import "./townFuelMark.css";

/**
 * An out-of-fuel agent's mark over its seat, from the room level: the
 * canvas's empty fuel can and clock, with the reset time beside it. It is a
 * DOM mark, as the step bubbles are, so the room's plate and the seat tags
 * do not cover it; it takes no pointer, so the table's card still opens.
 */
export function TownFuelMark({
  stop,
  agentKey,
  top,
  x,
  renderer,
  pennants,
}: {
  stop: AgentUsageStop;
  agentKey: string;
  /** A top seat faces the viewer; its mark clears the seat's name tag. */
  top: boolean;
  /** The seat's centre, in pixels from the table's left edge. */
  x: number;
  renderer: { readonly current: TownRendererHandle | null };
  /** Seat marks that hide while their agent is away (markAway). */
  pennants: Set<HTMLElement>;
}) {
  const ref = useCallback(
    (mark: HTMLElement | null) => {
      if (!mark) return;
      pennants.add(mark);
      markAway(mark, renderer.current);
      return () => void pennants.delete(mark);
    },
    [pennants, renderer],
  );
  const now = Date.now();
  return (
    <span
      ref={ref}
      className="town-fuel-mark"
      data-agent={agentKey}
      data-top={top || undefined}
      data-fuel={usageStopText(stop, now)}
      style={{ left: x }}
      aria-hidden="true"
    >
      <img
        className="town-fuel-mark-glyph"
        src={townFuelGlyphUrl()}
        alt=""
        draggable={false}
      />
      {stop.resets_at === null ? null : (
        <span className="town-fuel-mark-time">
          {usageStopResetTime(stop.resets_at, now)}
        </span>
      )}
    </span>
  );
}
