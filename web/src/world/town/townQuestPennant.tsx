/**
 * Town's quest pennant: an agent's quest beside its seat, from the room
 * level, with a label on hover, focus or a tap.
 */
import { useEffect, useRef, useState } from "react";
import type { TownRendererHandle } from "./townRenderer";
import "./townQuest.css";

/** What a seat's quest pennant shows: the agent's quest and its progress. */
export type TownQuestMark = {
  title: string;
  /** Short progress: "2/5", "Loop ×3", or the source's name. */
  progress: string;
  done: number;
  total: number;
  status: "active" | "done" | "blocked" | "paused";
};

/**
 * A pennant leaves with its agent: it hides while the agent walks or waits
 * elsewhere. Set outside React, from the renderer's actors.
 */
export function markAway(
  pennant: HTMLElement,
  renderer: TownRendererHandle | null,
) {
  const away =
    !!renderer && !renderer.actorPosition(pennant.dataset.agent!)?.seated;
  if (pennant.hasAttribute("data-away") !== away)
    pennant.toggleAttribute("data-away", away);
}

/**
 * A quest pennant beside a seated agent: a swallowtail flag in the quest's
 * status colour, with its progress bar when it has steps. Hover, focus or
 * a tap shows "Quest" and its title.
 */
export function TownQuestPennant({
  quest,
  agentKey,
  agentLabel,
  top,
  x,
  renderer,
  pennants,
}: {
  quest: TownQuestMark;
  agentKey: string;
  agentLabel: string;
  top: boolean;
  x: number;
  renderer: { readonly current: TownRendererHandle | null };
  pennants: Set<HTMLElement>;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  // Safari does not focus a tapped button, so blur alone never closes the
  // label: a press anywhere else does.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  const label = `Quest: ${quest.title}, ${quest.progress}`;
  return (
    <button
      type="button"
      ref={(pennant) => {
        if (button.current) pennants.delete(button.current);
        button.current = pennant;
        if (!pennant) return;
        pennants.add(pennant);
        markAway(pennant, renderer.current);
      }}
      className={`town-quest${top ? " town-quest-top" : ""}`}
      data-agent={agentKey}
      data-status={quest.status}
      data-open={open || undefined}
      style={{ left: x }}
      aria-label={`${label}, ${agentLabel}`}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onBlur={() => setOpen(false)}
    >
      <span className="town-quest-flag" aria-hidden="true" />
      {quest.total > 0 ? (
        <span className="town-quest-bar" aria-hidden="true">
          <i
            style={{
              width: `${(Math.min(quest.done, quest.total) / quest.total) * 100}%`,
            }}
          />
        </span>
      ) : null}
      <span className="town-quest-label" aria-hidden="true">
        <b>Quest</b> {quest.title} <small>{quest.progress}</small>
      </span>
    </button>
  );
}
