import {
  createContext,
  memo,
  useContext,
  type FocusEvent,
  type ReactNode,
} from "react";
import { AgentMark } from "../../components/AgentMark";
import { useNow } from "../handoffs";
import { needsYouItems, openNeedsYou } from "../needsYou";
import { useReviewedWork } from "../useReviewedWork";
import { useAnswerDeliveryCounts } from "../worldAnswerDeliveries";
import { sharedAsksStore, useWorldAsks } from "../worldAsks";
import type { WorldObject } from "../worldObject";
import type { TownLayout } from "./townLayout";
import {
  townPostCounts,
  townPostFoldAt,
  townPostParts,
  townPostSignAt,
  townPostSpoken,
  townPostWaiting,
  type TownPostCounts,
} from "./townPostModel";
import { townPostLotBeside } from "./townPostLot";
import type { TownRendererHandle } from "./townRenderer";
import "./townPost.css";

/**
 * What the post office counts: Town's world (the Hosts filter applied, as
 * Needs you's), counted with Needs you's own items, or fixed counts where a
 * town is drawn alone (captures). Without either it shows its sign alone.
 */
export type TownPostSource =
  | { world: Pick<WorldObject, "leaves" | "nodeById"> }
  | { counts: TownPostCounts };

const TownPostContext = createContext<TownPostSource | null>(null);

/** Town provides its world; only the post office re-renders as it counts. */
export function TownPostProvider({
  source,
  children,
}: {
  source: TownPostSource;
  children: ReactNode;
}) {
  return (
    <TownPostContext.Provider value={source}>
      {children}
    </TownPostContext.Provider>
  );
}

/** Needs you's items by kind, from the same stores and clock as its list. */
function useWorldCounts(
  world: Pick<WorldObject, "leaves" | "nodeById">,
): TownPostCounts {
  const asks = useWorldAsks(sharedAsksStore());
  const work = useReviewedWork();
  const now = useNow(30_000);
  const outbox = useAnswerDeliveryCounts().checks;
  return townPostCounts(
    needsYouItems(world, asks, (leaf) => work.toReview(leaf, now)),
    outbox,
  );
}

function CountedSign({
  world,
  children,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  children(counts: TownPostCounts): ReactNode;
}) {
  return children(useWorldCounts(world));
}

/**
 * Town's post office (#1098): what is addressed to you. Its sign counts
 * Needs you's items by kind without hovering (questions, blocked agents,
 * finished work to review) and the Outbox's answers to check; clicking it,
 * or Enter on it, opens Needs you, the same list as the top bar's counter.
 * A narrow town folds it to a sign on the town center's right wing.
 */
export const TownPostOffice = memo(function TownPostOffice({
  layout,
  renderer,
}: {
  layout: TownLayout;
  /** Brings a focused sign into view. */
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const source = useContext(TownPostContext);
  const folded = layout.formFactor === "narrow";
  const at = folded
    ? townPostFoldAt(layout.center)
    : townPostSignAt(townPostLotBeside(layout.center));
  /** Keyboard focus on an off-screen sign pans it into view. */
  const reveal = (event: FocusEvent<HTMLElement>) => {
    const handle = renderer.current;
    const target = event.currentTarget;
    if (!handle || !focusVisible(target)) return;
    const box = target.getBoundingClientRect();
    const { width, height } = handle.camera.viewport;
    const margin = 80;
    if (
      box.left > margin &&
      box.top > margin &&
      box.right < width - margin &&
      box.bottom < height - margin
    )
      return;
    handle.camera.flyTo(at.x, at.y, handle.camera.z, 0.4);
    handle.invalidate("focus");
  };
  const sign = (counts: TownPostCounts | null) => (
    <Sign counts={counts} folded={folded} at={at} onFocus={reveal} />
  );
  if (!source) return sign(null);
  if ("counts" in source) return sign(source.counts);
  return <CountedSign world={source.world}>{sign}</CountedSign>;
});

function Sign({
  counts,
  folded,
  at,
  onFocus,
}: {
  counts: TownPostCounts | null;
  folded: boolean;
  at: { x: number; y: number };
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const parts = counts ? townPostParts(counts) : [];
  const waiting = counts ? townPostWaiting(counts) : 0;
  return (
    <button
      type="button"
      className={folded ? "town-post-fold" : "town-post-sign"}
      data-waiting={waiting > 0 || undefined}
      style={{ left: at.x, top: at.y }}
      aria-label={`Post office: ${counts ? townPostSpoken(counts) : "Needs you"}. Open Needs you`}
      title="Post office: open Needs you"
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={onFocus}
      onClick={(event) => {
        event.stopPropagation();
        openNeedsYou();
      }}
    >
      {folded ? (
        <span className="town-post-mark" aria-hidden="true" />
      ) : (
        <span className="town-post-sign-title" aria-hidden="true">
          <span className="town-post-mark" />
          POST OFFICE
        </span>
      )}
      {counts ? (
        <span className="town-post-counts" aria-hidden="true">
          {parts.length ? (
            parts.map((part) => (
              <span key={part.key} data-kind={part.key}>
                {part.mark ? (
                  <AgentMark kind={part.mark} />
                ) : (
                  <span className="town-post-letter">✉</span>
                )}
                {folded ? part.count : part.text}
              </span>
            ))
          ) : (
            <span data-kind="none">{folded ? "0" : "Nothing for you"}</span>
          )}
        </span>
      ) : null}
    </button>
  );
}

/** Whether focus arrived by keyboard (a tap must not move the camera). */
function focusVisible(target: HTMLElement) {
  try {
    return target.matches(":focus-visible");
  } catch {
    return false;
  }
}
