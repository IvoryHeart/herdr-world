import { memo, useRef, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { needsYouAskKey, openNeedsYou } from "../needsYou";
import {
  sharedAsksStore,
  useWorldAsks,
  type WorldAsksStore,
} from "../worldAsks";
import {
  sharedAnswerDeliveries,
  useAnswerDeliveryCounts,
  type WorldAnswerDeliveriesStore,
} from "../worldAnswerDeliveries";
import { useOpenAnswerOutbox } from "./answerOutbox";
import { BadgePopover } from "./DeskWorkBadge";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_POST_TROLLEY,
  townLetterAge,
  townLetterFrom,
  townLetterLabel,
  townLetterLine,
  townPostCountParts,
  townPostOffice,
  townPostSignAt,
  townPostSignText,
  townPostSlot,
  townPostSpoken,
  townPostYardCount,
  type TownLetter,
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
import "./townPost.css";

const letterArt = (verified: boolean) => {
  const url = townLetterUrl(verified);
  return url ? `url("${url}")` : undefined;
};

/** The letters and the trolley: the fixture's, else the World ledger's. */
function usePostOffice(
  asksStore: WorldAsksStore,
  deliveries: WorldAnswerDeliveriesStore,
): Office {
  const asks = useWorldAsks(asksStore);
  const outgoing = useAnswerDeliveryCounts(deliveries);
  const fixture = townPostFixtureMode();
  const [now] = useState(() => Date.now());
  if (fixture) {
    const made = townPostFixture(fixture, now);
    return townPostOffice(made.asks, made.outgoing);
  }
  return townPostOffice(asks, outgoing);
}

const isFixture = (letter: TownLetter) =>
  letter.id.startsWith(TOWN_POST_FIXTURE_PREFIX);

/** Needs you, at a letter's question, or at its first question. */
const answer = (letter?: TownLetter) =>
  openNeedsYou(letter ? needsYouAskKey(letter.id) : undefined);

/**
 * Town's post office (#1105): mail, not cargo. Questions your agents asked
 * you lie in its sorting yard as letters, oldest first, each opening a
 * letter card whose **Answer** opens Needs you at that question; your
 * answers still on their way ride the mail trolley, which opens Town's
 * Outbox. Its sign counts both without hovering and opens Needs you. A
 * narrow (stacked) town has the same post office beside its town center.
 */
export const TownPostOffice = memo(function TownPostOffice({
  layout,
  renderer,
  asksStore = sharedAsksStore(),
  deliveries = sharedAnswerDeliveries(),
}: {
  layout: TownLayout;
  /** Brings a focused letter into view. */
  renderer: { readonly current: TownRendererHandle | null };
  asksStore?: WorldAsksStore;
  deliveries?: WorldAnswerDeliveriesStore;
}) {
  const office = usePostOffice(asksStore, deliveries);
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
  const narrow = layout.formFactor === "narrow";
  const sign = townPostSignAt(lot, narrow);
  /** Keyboard focus on an off-screen letter or sign pans it into view. */
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
    handle.camera.flyTo(
      (lot.x + lot.w / 2) * T,
      lot.yardY * T,
      handle.camera.z,
      0.4,
    );
    handle.invalidate("focus");
  };
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
      <button
        type="button"
        className="town-post-sign"
        data-quiet={office.letters.length || outgoing ? undefined : ""}
        data-narrow={narrow ? "" : undefined}
        style={{ left: sign.x, top: sign.y }}
        aria-label={`Post office: ${townPostSpoken(office)}. Open Needs you`}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={reveal}
        onClick={(event) => {
          event.stopPropagation();
          answer(office.letters[0]);
        }}
      >
        <span className="town-post-sign-title" aria-hidden="true">
          POST OFFICE
        </span>
        <SignCounts office={office} />
      </button>
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
              className="town-post-letter"
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
});

function focusVisible(element: HTMLElement) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** The sign's second line: the counts by kind, or "No mail". */
function SignCounts({ office }: { office: Office }) {
  const parts = townPostCountParts(office);
  return (
    <span className="town-post-sign-counts" aria-hidden="true">
      {parts.length
        ? parts.map((part) => (
            <span key={part.kind} data-kind={part.kind}>
              <i aria-hidden="true" />
              {part.text}
            </span>
          ))
        : townPostSignText(office)}
    </span>
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
