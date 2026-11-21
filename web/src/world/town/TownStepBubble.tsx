/**
 * A working agent's thought bubble over its head at its seat: a glyph for
 * the step it runs now, its time in amber once the step has run long, and,
 * at the desk level or on the selected desk, the task and step in words.
 * A working agent whose session has gone quiet (townQuietWork.ts) also
 * shows an hourglass with how long it has been quiet, and its step's time
 * whatever the step; a quiet agent with no step shows only the hourglass.
 * The bubble only shows; pointing at the agent still opens its peek card.
 */
import { useCallback, useSyncExternalStore } from "react";
import { markAway } from "./townQuestPennant";
import type { TownRendererHandle } from "./townRenderer";
import type { TownHud } from "./scene/townHud";
import { useTownAges } from "./useTownHud";
import { townQuietGlyphUrl } from "./townQuietGlyph";
import { townQuietAge } from "./townQuietWork";
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

const NO_STEP = () => undefined;

export function TownStepBubble({
  steps,
  quietSince = null,
  hud,
  agentKey,
  top,
  x,
  selected,
  renderer,
  pennants,
}: {
  /** The agents' steps; without them only a quiet agent has a bubble. */
  steps?: TownStepStore;
  /** When a quiet working agent last moved; null while it is not quiet. */
  quietSince?: number | null;
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
  const read = steps ? () => steps.get(agentKey) : NO_STEP;
  const step = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        steps ? steps.subscribe(agentKey, listener) : () => {},
      [steps, agentKey],
    ),
    read,
    read,
  );
  const quiet = quietSince !== null;
  // Ages move on every 15 s while the step has a start or the agent is
  // quiet (scene/townHud.ts).
  const now = useTownAges(hud, (!!step && step.since !== null) || quiet);
  const ref = useCallback(
    (bubble: HTMLElement | null) => {
      if (!bubble) return;
      pennants.add(bubble);
      markAway(bubble, renderer.current);
      return () => void pennants.delete(bubble);
    },
    [pennants, renderer],
  );
  if (!step && !quiet) return null;
  // A quiet agent keeps its step's running time on show: how long it has
  // been at it, beside how long it has gone quiet.
  const age =
    step && (quiet || townStepLong(step, now)) ? townStepAge(step, now) : null;
  const quietAge = quietSince !== null ? townQuietAge(quietSince, now) : null;
  return (
    <span
      ref={ref}
      className="town-step"
      data-agent={agentKey}
      data-kind={step?.kind}
      data-top={top || undefined}
      data-long={age ? true : undefined}
      data-selected={selected || undefined}
      data-step={
        step
          ? `${TOWN_STEP_NAMES[step.kind]}${age ? `, ${age}` : ""}`
          : undefined
      }
      data-quiet={quietAge ?? undefined}
      style={{ left: x }}
      aria-hidden="true"
    >
      {step ? (
        <>
          <img
            className="town-step-glyph"
            src={townStepGlyphUrl(step.kind)}
            alt=""
            draggable={false}
          />
          <span className="town-step-words">
            {step.task ? (
              <span className="town-step-task">{step.task}</span>
            ) : null}
            <span className="town-step-label">
              {age ? TOWN_STEP_WORDS[step.kind] : townStepLabel(step, now)}
            </span>
          </span>
          {age ? <b className="town-step-age">{age}</b> : null}
        </>
      ) : null}
      {quietAge ? (
        <>
          <img
            className="town-step-quiet-glyph"
            src={townQuietGlyphUrl()}
            alt=""
            draggable={false}
          />
          <b className="town-step-quiet">{quietAge}</b>
        </>
      ) : null}
    </span>
  );
}
