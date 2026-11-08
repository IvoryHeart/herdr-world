/**
 * A working agent's thought bubble over its head at its seat: a glyph for
 * the step it runs now, its time in amber once the step has run long, and,
 * at the desk level or on the selected desk, the task and step in words.
 * The bubble only shows; pointing at the agent still opens its peek card.
 */
import { useCallback, useSyncExternalStore } from "react";
import { markAway } from "./townQuestPennant";
import type { TownRendererHandle } from "./townRenderer";
import type { TownHud } from "./scene/townHud";
import { useTownAges } from "./useTownHud";
import { townStepGlyphUrl } from "./townStepArt";
import type { TownStepStore } from "./townStepStore";
import {
  TOWN_STEP_NAMES,
  TOWN_STEP_WORDS,
  townStepAge,
  townStepLabel,
  townStepLong,
} from "./townSteps";
import "./townStep.css";

export function TownStepBubble({
  steps,
  hud,
  agentKey,
  top,
  x,
  selected,
  renderer,
  pennants,
}: {
  steps: TownStepStore;
  hud: TownHud;
  agentKey: string;
  /** A top seat faces the viewer; its bubble clears the seat's name tag. */
  top: boolean;
  /** The seat's centre, in pixels from the table's left edge. */
  x: number;
  /** The agent or its desk is selected: the bubble shows its words. */
  selected: boolean;
  renderer: { readonly current: TownRendererHandle | null };
  /** Seat marks that hide while their agent is away (markAway). */
  pennants: Set<HTMLElement>;
}) {
  const step = useSyncExternalStore(
    useCallback(
      (listener: () => void) => steps.subscribe(agentKey, listener),
      [steps, agentKey],
    ),
    () => steps.get(agentKey),
  );
  // Ages move on every 15 s while the step has a start (scene/townHud.ts).
  const now = useTownAges(hud, !!step && step.since !== null);
  const ref = useCallback(
    (bubble: HTMLElement | null) => {
      if (!bubble) return;
      pennants.add(bubble);
      markAway(bubble, renderer.current);
      return () => void pennants.delete(bubble);
    },
    [pennants, renderer],
  );
  if (!step) return null;
  const age = townStepLong(step, now) ? townStepAge(step, now) : null;
  return (
    <span
      ref={ref}
      className="town-step"
      data-agent={agentKey}
      data-kind={step.kind}
      data-top={top || undefined}
      data-long={age ? true : undefined}
      data-selected={selected || undefined}
      data-step={`${TOWN_STEP_NAMES[step.kind]}${age ? `, ${age}` : ""}`}
      style={{ left: x }}
      aria-hidden="true"
    >
      <img
        className="town-step-glyph"
        src={townStepGlyphUrl(step.kind)}
        alt=""
        draggable={false}
      />
      <span className="town-step-words">
        {step.task ? <span className="town-step-task">{step.task}</span> : null}
        <span className="town-step-label">
          {age ? TOWN_STEP_WORDS[step.kind] : townStepLabel(step, now)}
        </span>
      </span>
      {age ? <b className="town-step-age">{age}</b> : null}
    </span>
  );
}
