import { useLayoutEffect, useRef } from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townPortrait } from "./townSprites";

export const portrait = townPortrait;

function ago(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

export function ReceptionEntry({
  agent,
  asking = false,
  since,
  now,
  selected,
  onSelect,
  onActivate,
  onHoverEntry,
}: {
  agent: OfficeAgent;
  asking?: boolean;
  since: number;
  now: number;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (selected) ref.current?.setAttribute("data-selected", "true");
    else ref.current?.removeAttribute("data-selected");
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      className={`town-reception-entry${!asking && agent.semanticStatus === "done" ? " town-reception-done" : ""}`}
      data-agent-key={agent.key}
      data-owner-question={asking || undefined}
      disabled={agent.stale || !agent.canOpenInSpaces}
      aria-label={
        asking
          ? `${agent.displayLabel}, owner question`
          : agent.semanticStatus === "done"
            ? `${agent.displayLabel}, finished`
            : `${agent.displayLabel}, needs input for ${ago(since, now)}`
      }
      title={agent.taskSummary ?? agent.displayLabel}
      onClick={() => (asking ? onActivate(agent.key) : onSelect(agent.key))}
      onDoubleClick={() => onActivate(agent.key)}
      onMouseEnter={(event) =>
        onHoverEntry(agent.key, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onHoverEntry(null)}
    >
      <img src={portrait(agent.key)} alt="" width={28} height={40} />
      <span>{agent.displayLabel}</span>
      <small>
        {asking
          ? "? Owner wanted"
          : agent.semanticStatus === "done"
            ? "done ✓"
            : ago(since, now)}
      </small>
    </button>
  );
}
