import {
  createContext,
  memo,
  useContext,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AgentMark } from "../../components/AgentMark";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { useNow } from "../handoffs";
import { needsYouAskKey, needsYouItems, openNeedsYou } from "../needsYou";
import { useReviewedWork } from "../useReviewedWork";
import {
  sharedAnswerDeliveries,
  useAnswerDeliveryCounts,
  type WorldAnswerDeliveriesStore,
} from "../worldAnswerDeliveries";
import {
  sharedAsksStore,
  useWorldAsks,
  type WorldAsksStore,
} from "../worldAsks";
import type { WorldObject } from "../worldObject";
import { useOpenAnswerOutbox } from "./answerOutbox";
import { BadgePopover } from "./DeskWorkBadge";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_POST_EMPTY,
  TOWN_POST_TROLLEY,
  townLetterAge,
  townLetterFrom,
  townLetterLabel,
  townLetterLine,
  townPostCounts,
  townPostOffice,
  townPostParts,
  townPostSignAt,
  townPostSlot,
  townPostSpoken,
  townPostWaiting,
  townPostYardCount,
  type TownLetter,
  type TownPostCounts,
  type TownPostOffice as Office,
} from "./townPostModel";
import {
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
  townPostLotBeside,
} from "./townPostLot";
import {
  TOWN_POST_FIXTURE_PREFIX,
  townPostFixture,
  townPostFixtureMode,
} from "./townPostFixture";
import { townLetterUrl } from "./townPostPaint";
import type { TownRendererHandle } from "./townRenderer";
import { useTownPlace } from "./useTownPlace";
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
 * The fixture's post office (`?townPostFixture`), made once per mount, or
 * null without the switch.
 */
function useFixtureOffice(): Office | null {
  const [office] = useState(() => {
    const fixture = townPostFixtureMode();
    if (!fixture) return null;
    const made = townPostFixture(fixture, Date.now());
    return townPostOffice(made.asks, made.outgoing);
  });
  return office;
}

/** The post office's window (#1170): Needs you, from its sign or building. */
const openPost = () => openNeedsYou(undefined, { window: true });

/** Keyboard focus on an off-screen sign or letter pans `at` into view. */
function revealer(
  renderer: { readonly current: TownRendererHandle | null },
  at: { x: number; y: number },
) {
  return (event: FocusEvent<HTMLElement>) => {
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
}

/**
 * Town's post office (#1098, #1105): what is addressed to you, mail and
 * never cargo. Its sign counts Needs you's items by kind without hovering
 * (questions, blocked agents, finished work to review) and the Outbox's
 * answers to check; clicking it, or Enter on it, opens Needs you, the same
 * list as the top bar's counter, on a narrow (phone) town too (#1351). In
 * its yard each open question lies as a
 * letter, oldest first, opening a letter card whose **Answer** opens Needs
 * you at that question; your answers still on their way ride the mail
 * trolley, which opens Town's Outbox.
 */
export const TownPostOffice = memo(function TownPostOffice({
  layout,
  renderer,
  asksStore = sharedAsksStore(),
  deliveries = sharedAnswerDeliveries(),
}: {
  layout: TownLayout;
  /** Brings a focused sign or letter into view. */
  renderer: { readonly current: TownRendererHandle | null };
  asksStore?: WorldAsksStore;
  deliveries?: WorldAnswerDeliveriesStore;
}) {
  const source = useContext(TownPostContext);
  const fixture = useFixtureOffice();
  useTownPlace("post", openPost);
  const narrow = layout.formFactor === "narrow";
  const at = townPostSignAt(
    townPostLotBeside(layout.center),
    layout.formFactor,
  );
  const reveal = revealer(renderer, at);
  const sign = (counts: TownPostCounts | null) => (
    <Sign counts={counts} narrow={narrow} at={at} onFocus={reveal} />
  );
  const counted = fixture ? (
    sign(fixtureCounts(fixture))
  ) : !source ? (
    sign(null)
  ) : "counts" in source ? (
    sign(source.counts)
  ) : (
    <CountedSign world={source.world}>{sign}</CountedSign>
  );
  return (
    <>
      {counted}
      {fixture ? (
        <PostYard office={fixture} layout={layout} renderer={renderer} />
      ) : (
        <LedgerYard
          asksStore={asksStore}
          deliveries={deliveries}
          layout={layout}
          renderer={renderer}
        />
      )}
    </>
  );
});

/** The sign's counts for the fixture's letters and trolley. */
const fixtureCounts = (office: Office): TownPostCounts => ({
  ...TOWN_POST_EMPTY,
  asks: office.letters.length,
  outbox: office.outgoing.checks,
});

function Sign({
  counts,
  narrow,
  at,
  onFocus,
}: {
  counts: TownPostCounts | null;
  /** A phone's sign stands at the ridge's middle, its counts stacked. */
  narrow: boolean;
  at: { x: number; y: number };
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const parts = counts ? townPostParts(counts) : [];
  const waiting = counts ? townPostWaiting(counts) : 0;
  return (
    <button
      type="button"
      className="town-post-sign"
      data-narrow={narrow || undefined}
      data-waiting={waiting > 0 || undefined}
      style={{ left: at.x, top: at.y }}
      aria-label={`Post office: ${counts ? townPostSpoken(counts) : "Needs you"}. Open Needs you`}
      title="Post office: open Needs you"
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={onFocus}
      data-town-place="post"
      onClick={(event) => {
        event.stopPropagation();
        openPost();
      }}
    >
      <span className="town-post-sign-title" aria-hidden="true">
        <span className="town-post-mark" />
        POST OFFICE
      </span>
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
                {part.text}
              </span>
            ))
          ) : (
            <span data-kind="none">Nothing for you</span>
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

const letterArt = (verified: boolean) => {
  const url = townLetterUrl(verified);
  return url ? `url("${url}")` : undefined;
};

const isFixture = (letter: TownLetter) =>
  letter.id.startsWith(TOWN_POST_FIXTURE_PREFIX);

/** Needs you at a letter's question, in Town's one window. */
const answer = (letter: TownLetter) =>
  openNeedsYou(needsYouAskKey(letter.id), { window: true });

/** The yard from the World ledger: open asks and answers on their way. */
function LedgerYard({
  asksStore,
  deliveries,
  layout,
  renderer,
}: {
  asksStore: WorldAsksStore;
  deliveries: WorldAnswerDeliveriesStore;
  layout: TownLayout;
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const asks = useWorldAsks(asksStore);
  const outgoing = useAnswerDeliveryCounts(deliveries);
  return (
    <PostYard
      office={townPostOffice(asks, outgoing)}
      layout={layout}
      renderer={renderer}
    />
  );
}

/**
 * The yard (#1105): a letter per open question, oldest first, a "+N"
 * bundle beyond the yard's slots, and the mail trolley with your answers
 * on their way.
 */
function PostYard({
  office,
  layout,
  renderer,
}: {
  office: Office;
  layout: TownLayout;
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const openOutbox = useOpenAnswerOutbox();
  const [cardId, setCardId] = useState<string | null>(null);
  const cardAnchor = useRef<HTMLElement | null>(null);
  const letter = cardId
    ? office.letters.find((entry) => entry.id === cardId)
    : undefined;
  const openCard = (id: string, anchor: HTMLElement | null) => {
    cardAnchor.current = anchor;
    setCardId(id);
  };
  const lot = townPostLotBeside(layout.center);
  const reveal = revealer(renderer, {
    x: (lot.x + lot.w / 2) * T,
    y: lot.yardY * T,
  });
  // A question answered, dismissed or withdrawn takes its card with it.
  const card =
    cardId && letter
      ? createPortal(
          <BadgePopover
            anchor={cardAnchor}
            label={`Letter from ${townLetterFrom(letter)}`}
            onClose={() => setCardId(null)}
          >
            <LetterCard
              letter={letter}
              onAnswer={() => {
                setCardId(null);
                answer(letter);
              }}
            />
          </BadgePopover>,
          document.body,
        )
      : null;
  const outgoing = office.outgoing.waiting + office.outgoing.checks;
  const shown = office.letters.slice(
    0,
    townPostYardCount(office.letters.length),
  );
  const bundle = office.letters.slice(shown.length);
  return (
    <>
      <div
        className="town-post-yard"
        role="group"
        aria-label="Post office yard"
        style={{
          left: lot.x * T,
          top: lot.yardY * T,
          width: TOWN_POST_WIDTH * T,
          height: TOWN_POST_YARD_ROWS * T,
        }}
      >
        {shown.map((entry, index) => {
          const at = townPostSlot(index);
          return (
            <button
              key={entry.id}
              type="button"
              className="town-post-envelope"
              data-unverified={entry.verified ? undefined : ""}
              style={{
                left: at.x,
                top: at.y,
                backgroundImage: letterArt(entry.verified),
              }}
              aria-label={`${townLetterLabel(entry)}. Open letter`}
              onPointerDown={(event) => event.stopPropagation()}
              onFocus={reveal}
              onClick={(event) => {
                event.stopPropagation();
                openCard(entry.id, event.currentTarget);
              }}
            >
              <span className="town-post-label" aria-hidden="true">
                <b>{townLetterFrom(entry)}</b>
                <span>{townLetterLine(entry, 60)}</span>
              </span>
            </button>
          );
        })}
        {bundle.length ? (
          <Bundle
            letters={bundle}
            at={townPostSlot(shown.length)}
            onOpen={openCard}
            onFocus={reveal}
          />
        ) : null}
        {outgoing ? (
          <Trolley
            office={office}
            left={TOWN_POST_WIDTH * T - TOWN_POST_TROLLEY.fromRight}
            onOpen={openOutbox}
            onFocus={reveal}
          />
        ) : null}
      </div>
      {card}
    </>
  );
}

/** The trolley's load: your answers on their way, opening the Outbox. */
function Trolley({
  office,
  left,
  onOpen,
  onFocus,
}: {
  office: Office;
  left: number;
  onOpen(): void;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const { waiting, checks } = office.outgoing;
  return (
    <button
      type="button"
      className="town-post-trolley"
      data-check={checks ? "" : undefined}
      style={{ left, top: TOWN_POST_TROLLEY.y - 8 }}
      aria-label={`Mail trolley: ${outgoingWords(waiting, checks)}. Open Outbox`}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={onFocus}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {waiting + checks}
    </button>
  );
}

const outgoingWords = (waiting: number, checks: number) =>
  [
    waiting ? `${waiting} ${waiting === 1 ? "answer" : "answers"} to send` : "",
    checks ? `${checks} ${checks === 1 ? "answer" : "answers"} to check` : "",
  ]
    .filter(Boolean)
    .join(", ");

/** Letters beyond the yard: a "+N" bundle, opening them as a list. */
function Bundle({
  letters,
  at,
  onOpen,
  onFocus,
}: {
  letters: readonly TownLetter[];
  at: { x: number; y: number };
  onOpen(id: string, anchor: HTMLElement | null): void;
  onFocus(event: FocusEvent<HTMLElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="town-post-bundle"
          style={{ left: at.x, top: at.y }}
          aria-label={`${letters.length} more letters`}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={onFocus}
        >
          +{letters.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-post-popover"
        collisionPadding={8}
        aria-label="More letters"
      >
        <LetterList
          letters={letters}
          onOpen={(id) => {
            setOpen(false);
            onOpen(id, trigger.current);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Letters as rows: the bundle's list. */
function LetterList({
  letters,
  onOpen,
}: {
  letters: readonly TownLetter[];
  onOpen(id: string): void;
}) {
  return (
    <ul className="town-post-list" aria-label="Letters">
      {letters.map((letter) => (
        <li key={letter.id}>
          <button
            type="button"
            className="town-post-row"
            aria-label={`${townLetterLabel(letter)}. Open letter`}
            onClick={() => onOpen(letter.id)}
          >
            <span
              className="town-post-icon"
              style={{ backgroundImage: letterArt(letter.verified) }}
              aria-hidden="true"
            />
            <span className="town-post-row-name">{townLetterFrom(letter)}</span>
            <span className="town-post-row-why">{townLetterLine(letter)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A letter opened: who wrote, when, the question and its choices. */
function LetterCard({
  letter,
  onAnswer,
}: {
  letter: TownLetter;
  onAnswer(): void;
}) {
  const fixture = isFixture(letter);
  return (
    <article className="town-post-card">
      <header className="town-post-card-from">
        <span
          className="town-post-icon"
          style={{ backgroundImage: letterArt(letter.verified) }}
          aria-hidden="true"
        />
        <b>{townLetterFrom(letter)}</b>
        <span>{townLetterAge(letter.at, Date.now())}</span>
      </header>
      <p className="town-post-card-question">{letter.question}</p>
      {letter.options.length ? (
        <ul className="town-post-card-options" aria-label="Choices">
          {letter.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      ) : null}
      {fixture ? (
        <p className="town-post-note">
          A test letter: there is no question to answer.
        </p>
      ) : (
        <button type="button" className="town-post-action" onClick={onAnswer}>
          Answer in Needs you
        </button>
      )}
    </article>
  );
}
