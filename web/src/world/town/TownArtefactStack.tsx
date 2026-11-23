/**
 * Town's mark for what an agent made: a small stack of papers on its desk,
 * from the room level, one sheet per artefact up to three. Hover, focus or
 * a tap names the newest; the agent's card lists them all and opens them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentArtefact } from "../../../../shared/agentArtefacts";
import { markAway } from "./townQuestPennant";
import type { TownRendererHandle } from "./townRenderer";
import "./townArtefacts.css";

/** What a seat's paper stack shows, from the agent's artefact records. */
export type TownArtefactMark = {
  count: number;
  /** The newest artefact's title. */
  latest: string;
};

/** Each agent's paper-stack mark, by agent key, from its desk read. */
export function useTownMadeMarks(
  artefacts: ReadonlyMap<string, readonly AgentArtefact[]>,
): ReadonlyMap<string, TownArtefactMark> {
  return useMemo(
    () =>
      new Map(
        [...artefacts].map(([key, made]) => [
          key,
          { count: made.length, latest: made[0]!.title },
        ]),
      ),
    [artefacts],
  );
}

export function TownArtefactStack({
  mark,
  agentKey,
  agentLabel,
  top,
  x,
  renderer,
  marks,
}: {
  mark: TownArtefactMark;
  agentKey: string;
  agentLabel: string;
  top: boolean;
  x: number;
  renderer: { readonly current: TownRendererHandle | null };
  marks: Set<HTMLElement>;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  const made = `${mark.count} thing${mark.count === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      ref={(stack) => {
        if (button.current) marks.delete(button.current);
        button.current = stack;
        if (!stack) return;
        marks.add(stack);
        markAway(stack, renderer.current);
      }}
      className={`town-made${top ? " town-made-top" : ""}`}
      data-agent={agentKey}
      data-sheets={Math.min(mark.count, 3)}
      data-open={open || undefined}
      style={{ left: x }}
      aria-label={`Made ${made}, newest ${mark.latest}, ${agentLabel}`}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      onBlur={() => setOpen(false)}
    >
      <span className="town-made-sheets" aria-hidden="true" />
      <span className="town-made-label" aria-hidden="true">
        <b>Made</b> {mark.latest}
        {mark.count > 1 ? <small> +{mark.count - 1}</small> : null}
      </span>
    </button>
  );
}
