import { useLayoutEffect, useRef } from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townPortrait } from "./townSprites";
import { townReceptionName } from "./townNameplates";
import { useTownGroupKeys } from "./useTownGroup";

export const portrait = townPortrait;

function ago(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

export function ReceptionEntry({
  agent,
  room,
  desk,
  asking = false,
  since,
  now,
  selected,
  onSelect,
  onActivate,
  onHoverEntry,
}: {
  agent: OfficeAgent;
  /** The agent's room and desk labels: the chip says where it waits from. */
  room?: string;
  desk?: string;
  asking?: boolean;
  since: number;
  now: number;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const group = useTownGroupKeys();
  const grouped = !!group?.keys.has(agent.key);
  const { name, title } = townReceptionName(agent, room, desk);
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
      data-grouped={grouped || undefined}
      data-owner-question={asking || undefined}
      disabled={agent.stale || !agent.canOpenInSpaces}
      aria-label={`${
        asking
          ? `${title}, owner question`
          : agent.semanticStatus === "done"
            ? `${title}, finished`
            : `${title}, needs you for ${ago(since, now)}`
      }${grouped ? ", selected" : ""}`}
      title={agent.taskSummary ? `${title}: ${agent.taskSummary}` : title}
      onClick={(event) =>
        // Shift+click toggles the agent in the group selection (#820).
        event.shiftKey && group
          ? group.toggle([agent.key])
          : asking
            ? onActivate(agent.key)
            : onSelect(agent.key)
      }
      onDoubleClick={() => onActivate(agent.key)}
      onMouseEnter={(event) =>
        onHoverEntry(agent.key, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onHoverEntry(null)}
    >
      <img src={portrait(agent.key)} alt="" width={28} height={40} />
      <span>{name}</span>
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
