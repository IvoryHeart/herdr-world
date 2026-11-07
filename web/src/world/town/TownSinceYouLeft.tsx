import { useNow } from "../handoffs";
import { needsYouItems, openNeedsYou } from "../needsYou";
import { itemName } from "../NeedsYouItem";
import { sharedPresence, useOwnerPresence } from "../presence";
import {
  awayFor,
  leftAt,
  sinceYouLeft,
  sinceYouLeftShort,
  type SinceYouLeftLine,
} from "../sinceYouLeft";
import { useReviewedWork } from "../useReviewedWork";
import { sharedAsksStore, useWorldAsks } from "../worldAsks";
import type { WorldObject } from "../worldObject";
import { useWorldSources } from "../worldSources";

/**
 * "Since you left" on the Town board sign (and, on phones, one line under
 * the summary chip) after a return of 30 minutes or more. Each line opens
 * Needs you at the item it names; ✕ clears only the recap.
 */
export function TownSinceYouLeft({
  world,
  variant,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  variant: "board" | "chip";
}) {
  const presence = useOwnerPresence();
  const asks = useWorldAsks(sharedAsksStore());
  const work = useReviewedWork();
  const sources = useWorldSources();
  const now = useNow(30_000);
  const away = presence.dismissed ? null : presence.away;
  if (!away) return null;
  const lines = sinceYouLeft({
    window: away,
    items: needsYouItems(world, asks, (leaf) => work.toReview(leaf, now)),
    stoppedAt: work.stoppedAt,
    name: itemName,
    sources: sources.items,
  });
  if (!lines.length) return null;
  const left = leftAt(away.since, now);
  if (variant === "chip") {
    const first = lines.find((line) => line.itemKey);
    const text = `Since ${left}: ${sinceYouLeftShort(lines)}`;
    return (
      <button
        type="button"
        className="town-recap-chip"
        aria-label={`${text}. Open Needs you.`}
        onClick={() => openNeedsYou(first?.itemKey)}
      >
        <span>{text}</span>
        <span aria-hidden="true">›</span>
      </button>
    );
  }
  return (
    <section className="town-recap" aria-label="Since you left">
      <header>
        <span>
          Since {left} · away {awayFor(away.at - away.since)}
        </span>
        <button
          type="button"
          className="town-recap-clear"
          aria-label="Clear since you left"
          title="Clear since you left"
          onClick={() => sharedPresence().dismiss()}
        >
          ✕
        </button>
      </header>
      <ul>
        {lines.map((line) => (
          <li key={line.kind}>
            <RecapLine line={line} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecapLine({ line }: { line: SinceYouLeftLine }) {
  // A merged line names no item, so it opens Needs you itself.
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
