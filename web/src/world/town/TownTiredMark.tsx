/**
 * A tired agent at its desk: a sweat drop by its head once its context is
 * nearly full (agentContextFill.ts), so the owner can spot it before it
 * compacts or loses the thread. Hovering the agent shows the reading.
 */
import { useRef } from "react";
import type { AgentContextFill } from "../agentContextFill";
import { markAway } from "./townQuestPennant";
import type { TownRendererHandle } from "./townRenderer";
import "./townTired.css";

export function TownTiredMark({
  fill,
  agentKey,
  agentLabel,
  top,
  x,
  renderer,
  marks,
}: {
  fill: AgentContextFill;
  agentKey: string;
  agentLabel: string;
  top: boolean;
  x: number;
  renderer: { readonly current: TownRendererHandle | null };
  /** Hidden while the agent walks or waits elsewhere (markAway). */
  marks: Set<HTMLElement>;
}) {
  const mark = useRef<HTMLElement | null>(null);
  return (
    <span
      ref={(element) => {
        if (mark.current) marks.delete(mark.current);
        mark.current = element;
        if (!element) return;
        marks.add(element);
        markAway(element, renderer.current);
      }}
      className={`town-tired${top ? " town-tired-top" : ""}`}
      data-agent={agentKey}
      role="img"
      aria-label={`${agentLabel} is tired: ${fill.text}`}
      style={{ left: x }}
    >
      <i aria-hidden="true" />
    </span>
  );
}
