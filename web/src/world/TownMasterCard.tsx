import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { worldLocalStorage } from "../browserStorage";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import { useStoreSelector } from "../store";
import type { UpdateInfo } from "../store/types";
import { openNeedsYou } from "./needsYou";
import { readOfficePreferences } from "./officePreferences";
import { ProfileSprite } from "./ProfileSprite";
import { leftAt, type SinceYouLeftLine } from "./sinceYouLeft";
import { useSinceYouLeft } from "./town/TownSinceYouLeft";
import {
  setGreetingOnStart,
  sharedGreeting,
  TOWN_MASTER_LOOK,
  useGreeting,
  useGreetingAnchor,
  WORLD_OPEN_UPDATE_MENU_EVENT,
} from "./townMasterGreeting";
import type { WorldObject } from "./worldObject";
import "./townMasterCard.css";

/**
 * The open greeting: the card at its anchor on wide screens, a sheet with
 * Back on phones. Loaded when it first opens (TownMasterGreetingHost.tsx).
 */
export default function TownMasterGreetingLayer({
  world,
  here,
  mobile,
  anchor,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  here: number | null;
  mobile: boolean;
  anchor: HTMLElement | null;
}) {
  const greeting = sharedGreeting();
  const card = useRef<HTMLElement>(null);
  const { lines, now } = useSinceYouLeft(world);
  const update = useStoreSelector((state) => state.updateInfo);
  const [onStart, setOnStart] = useState(
    () => readOfficePreferences(worldLocalStorage).townGreeting,
  );
  const close = () => greeting.close();
  // Escape, Back on a phone and a press outside close it; the anchor (the
  // figure) toggles it instead.
  useLayer(true, close, {
    element: () => card.current,
    anchors: () => [anchor],
  });
  const place = useGreetingPlacement(card, anchor);
  return createPortal(
    <TownMasterGreetingCard
      cardRef={card}
      mobile={mobile}
      style={place}
      hello={helloLine(here, now)}
      lines={lines}
      update={update}
      onStart={onStart}
      onClose={close}
      onLine={(line) => {
        close();
        openNeedsYou(line.itemKey);
      }}
      onUpdate={() => {
        close();
        window.dispatchEvent(new Event(WORLD_OPEN_UPDATE_MENU_EVENT));
      }}
      onStartChange={(on) => setOnStart(setGreetingOnStart(on).townGreeting)}
    />,
    document.body,
  );
}

/** "Hello! You were last here at 14:05." (another day adds its weekday). */
export function helloLine(here: number | null, now: number) {
  return here === null
    ? "Hello!"
    : `Hello! You were last here at ${leftAt(here, now)}.`;
}

/** The update line, when World's update check reports a newer release. */
export function updateLine(update: UpdateInfo | null) {
  return update?.update_available && update.latest_version
    ? `Herdr World ${update.latest_version} is available.`
    : null;
}

/** The card itself, without placement or layers. */
export function TownMasterGreetingCard({
  cardRef,
  mobile,
  style,
  hello,
  lines,
  update,
  onStart,
  onClose,
  onLine,
  onUpdate,
  onStartChange,
}: {
  cardRef?: React.Ref<HTMLElement>;
  mobile: boolean;
  style?: React.CSSProperties;
  hello: string;
  lines: readonly SinceYouLeftLine[];
  update: UpdateInfo | null;
  onStart: boolean;
  onClose(): void;
  onLine(line: SinceYouLeftLine): void;
  onUpdate(): void;
  onStartChange(on: boolean): void;
}) {
  const news = updateLine(update);
  return (
    <section
      ref={cardRef}
      className={`town-master-greeting${mobile ? " is-sheet" : ""}`}
      style={style}
      role="dialog"
      aria-label="Town Master"
    >
      <header>
        {mobile ? (
          <button
            type="button"
            className="town-master-greeting-back"
            aria-label="Back"
            title="Back"
            data-layer-back
            onClick={onClose}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        ) : null}
        <ProfileSprite look={TOWN_MASTER_LOOK} scale={2} />
        <h2>Town Master</h2>
        {mobile ? null : (
          <CloseButton label="Close the greeting" onClick={onClose} />
        )}
      </header>
      <p className="town-master-greeting-hello">{hello}</p>
      <div className="town-master-greeting-recap">
        <h3>Since you left</h3>
        {lines.length ? (
          <ul>
            {lines.map((line) => (
              <li key={line.kind}>
                <button
                  type="button"
                  title="Open in Needs you"
                  onClick={() => onLine(line)}
                >
                  {line.text} <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing new since you left.</p>
        )}
      </div>
      {news ? (
        <p className="town-master-greeting-update">
          <span>{news}</span>
          <button type="button" onClick={onUpdate}>
            See update
          </button>
        </p>
      ) : null}
      <footer>
        <label>
          <input
            type="checkbox"
            checked={onStart}
            onChange={(event) => onStartChange(event.currentTarget.checked)}
          />
          Show this on start
        </label>
      </footer>
    </section>
  );
}

const MARGIN = 8;

/**
 * Where the card opens beside its anchor: below it when it fits, else above,
 * kept on screen.
 */
export function greetingPlacement(
  anchor: Pick<DOMRect, "left" | "top" | "bottom">,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, viewport.width - card.width - MARGIN),
  );
  const below = anchor.bottom + MARGIN;
  const top =
    below + card.height <= viewport.height - MARGIN
      ? below
      : Math.max(MARGIN, anchor.top - MARGIN - card.height);
  return { left, top };
}

function useGreetingPlacement(
  card: React.RefObject<HTMLElement | null>,
  anchor: HTMLElement | null,
): React.CSSProperties | undefined {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const element = card.current;
      if (!element || !anchor.isConnected) return;
      const next = greetingPlacement(
        anchor.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPlace((current) =>
        current?.left === next.left && current.top === next.top
          ? current
          : next,
      );
    };
    measure();
    // Lines can arrive after it opens; a taller card may need to move up.
    const resize =
      typeof ResizeObserver === "function" && card.current
        ? new ResizeObserver(measure)
        : null;
    if (resize && card.current) resize.observe(card.current);
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor, card]);
  if (!anchor) return undefined;
  // Measured before it shows, so it never flashes in the corner.
  return place ?? { visibility: "hidden" };
}

/**
 * The Town Master beside the town board: the greeting opens from it, and a
 * tap opens it again.
 */
export function TownMasterFigure() {
  const anchor = useGreetingAnchor();
  const { open } = useGreeting();
  return (
    <button
      ref={anchor}
      type="button"
      className="town-master-figure"
      aria-label="Town Master"
      title="Town Master"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => sharedGreeting().toggle()}
    >
      <ProfileSprite look={TOWN_MASTER_LOOK} scale={2} />
    </button>
  );
}
