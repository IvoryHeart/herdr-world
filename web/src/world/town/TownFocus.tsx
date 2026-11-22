import { Headphones } from "lucide-react";
import { focusLength } from "../../../../shared/focus";
import { FocusControls, useFocusClock } from "../FocusControls";
import {
  dismissFocusRecap,
  focusNow,
  focusRecapSession,
  useFocus,
} from "../focus";
import { useNow } from "../handoffs";
import { itemName, needsYouItems, openNeedsYou } from "../needsYou";
import {
  sinceYouLeft,
  sinceYouLeftShort,
  type SinceYouLeftLine,
} from "../sinceYouLeft";
import { useReviewedWork } from "../useReviewedWork";
import { sharedAsksStore, useWorldAsks } from "../worldAsks";
import type { WorldObject } from "../worldObject";
import { useWorldSources } from "../worldSources";
import { TownSinceYouLeft } from "./TownSinceYouLeft";

/**
 * The status chip's focus mark (#1131): headphones and the time left while a
 * session runs. The chip opens the board, where End now is.
 */
export function TownFocusMark() {
  const { held, left } = useFocusClock();
  if (!held) return null;
  const short = left === "Until you stop" ? "" : left!.replace(" left", "");
  return (
    <span className="town-focus-mark" title={`Focused · ${left}`}>
      <Headphones size={12} aria-hidden="true" />
      {short}
    </span>
  );
}

/** The chip's words for the focus mark, for its accessible name. */
export function useTownFocusLabel() {
  const { held, left } = useFocusClock();
  return held ? `focused, ${left!.toLowerCase()}` : null;
}

/** The board's Focus section: start one, or the time left and End now. */
export function TownFocusSection() {
  return (
    <section className="town-focus" aria-label="Focus" data-help="town.focus">
      <div className="focus-title">FOCUS</div>
      <FocusControls />
    </section>
  );
}

/**
 * The recap of the latest session that ended: "While you focused · 45 m",
 * read with Since you left's model (sinceYouLeft.ts) over the session's
 * window, until cleared with ✕ on this device.
 */
export function useFocusRecap(world: Pick<WorldObject, "leaves" | "nodeById">) {
  const focus = useFocus();
  const asks = useWorldAsks(sharedAsksStore());
  const work = useReviewedWork();
  const sources = useWorldSources();
  useNow(30_000);
  const now = focusNow();
  const session = focusRecapSession(focus.state, now);
  if (!session) return null;
  const lines = sinceYouLeft({
    window: { since: session.started_at, at: session.ended_at },
    items: needsYouItems(world, asks, (leaf) => work.toReview(leaf, now)),
    stoppedAt: work.stoppedAt,
    name: itemName,
    sources: sources.items,
  });
  return {
    session,
    lines,
    heading: `While you focused · ${focusLength(session.ended_at - session.started_at)}`,
  };
}

/**
 * "While you focused" on the board sign and, as one line, under the status
 * chip. Each line opens Needs you at its first item; ✕ clears it here.
 */
export function TownFocusRecap({
  world,
  variant,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  variant: "board" | "chip";
}) {
  const recap = useFocusRecap(world);
  return recap ? <FocusRecapView recap={recap} variant={variant} /> : null;
}

/**
 * The one line under the status chip: a focus session's recap while it
 * shows, else Since you left's (they would sit in the same place).
 */
export function TownRecapChip({
  world,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
}) {
  const recap = useFocusRecap(world);
  return recap ? (
    <FocusRecapView recap={recap} variant="chip" />
  ) : (
    <TownSinceYouLeft world={world} variant="chip" />
  );
}

function FocusRecapView({
  recap,
  variant,
}: {
  recap: NonNullable<ReturnType<typeof useFocusRecap>>;
  variant: "board" | "chip";
}) {
  const { session, lines, heading } = recap;
  if (variant === "chip") {
    const first = lines.find((line) => line.itemKey);
    const text = `${heading}: ${lines.length ? sinceYouLeftShort(lines) : "nothing new"}`;
    return (
      <button
        type="button"
        className="town-recap-chip"
        data-focus-recap="true"
        aria-label={`${text}. Open Needs you.`}
        onClick={() => openNeedsYou(first?.itemKey)}
      >
        <span>{text}</span>
        <span aria-hidden="true">›</span>
      </button>
    );
  }
  return (
    <section className="town-recap" aria-label="While you focused">
      <header>
        <span>{heading}</span>
        <button
          type="button"
          className="town-recap-clear"
          aria-label="Clear while you focused"
          title="Clear while you focused"
          onClick={() => dismissFocusRecap(session.id)}
        >
          ✕
        </button>
      </header>
      <ul>
        {lines.length ? (
          lines.map((line) => (
            <li key={line.kind}>
              <FocusRecapLine line={line} />
            </li>
          ))
        ) : (
          <li>Nothing new arrived</li>
        )}
      </ul>
    </section>
  );
}

function FocusRecapLine({ line }: { line: SinceYouLeftLine }) {
  return (
    <button
      type="button"
      title="Open in Needs you"
      onClick={() => openNeedsYou(line.itemKey)}
    >
      {line.text} <span aria-hidden="true">›</span>
    </button>
  );
}
