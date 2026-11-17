import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLayoutPreferences } from "../layoutPreferences";
import TownMasterGreetingLayer from "./TownMasterCard";
import { useOwnerPresence } from "./presence";
import {
  GREETING_CARD_ESTIMATE,
  GREETING_COVERS,
  greetingCovered,
  greetingStep,
  lastHere,
  sharedGreeting,
  useGreeting,
} from "./townMasterGreeting";
import type { WorldObject } from "./worldObject";

/**
 * The Town Master's greeting in Town, Board and Desk. On wide screens it
 * opens at the view's anchor (Town's figure beside the board, Board's hub,
 * Desk's summary); on phones it is a sheet with Back. `held` holds every
 * greeting back (the welcome that asks for a first connection);
 * `windowsOpen` is any open window or sheet. On a phone those cover the
 * whole screen; on a wide screen only one over the anchor or the card's
 * place covers it. The card never opens over one, and steps aside (to open
 * again once uncovered) if one opens over it.
 */
export function TownMasterGreetingHost({
  world,
  held,
  windowsOpen,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  held: boolean;
  windowsOpen: boolean;
}) {
  const greeting = sharedGreeting();
  const state = useGreeting(greeting);
  const presence = useOwnerPresence();
  const { mobile } = useLayoutPreferences();
  const here = lastHere(state.visit, presence.away);
  const placed = mobile || Boolean(state.anchor?.isConnected);
  const overlapped = useWindowOverWide(
    !mobile && windowsOpen ? state.anchor : null,
  );
  const covered = held || (mobile ? windowsOpen : overlapped);
  const step = greetingStep(state, { covered, placed });
  useEffect(() => {
    if (step === "show") greeting.show();
    else if (step === "step-aside") greeting.stepAside();
  }, [greeting, step]);
  if (!state.open || covered || !placed) return null;
  return (
    <TownMasterGreetingLayer
      world={world}
      here={here}
      mobile={mobile}
      anchor={mobile ? null : state.anchor}
    />
  );
}

/**
 * Whether an open window or sheet lies over the greeting's place on a wide
 * screen. Checked after every render (windows open, close, move and resize
 * through World's control plane) and when the screen resizes. The card's
 * last measured size is kept, so one that stepped aside is not predicted
 * smaller and shown again under the same window.
 */
function useWindowOverWide(anchor: HTMLElement | null) {
  const [over, setOver] = useState(false);
  const card = useRef(GREETING_CARD_ESTIMATE);
  useLayoutEffect(() => {
    const check = () => {
      if (!anchor?.isConnected) return setOver(false);
      const open = document.querySelector<HTMLElement>(".town-master-greeting");
      if (open?.offsetWidth)
        card.current = {
          width: open.offsetWidth,
          height: Math.max(card.current.height, open.offsetHeight),
        };
      const covers = [
        ...document.querySelectorAll<HTMLElement>(GREETING_COVERS),
      ].map((element) => element.getBoundingClientRect());
      setOver(
        greetingCovered(
          anchor.getBoundingClientRect(),
          card.current,
          { width: window.innerWidth, height: window.innerHeight },
          covers,
        ),
      );
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  });
  return over;
}
