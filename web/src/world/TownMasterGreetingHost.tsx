import { Suspense, useEffect } from "react";
import { lazyWithReload } from "../lazyWithReload";
import { useLayoutPreferences } from "../layoutPreferences";
import { useOwnerPresence } from "./presence";
import {
  greetingStep,
  lastHere,
  sharedGreeting,
  useGreeting,
} from "./townMasterGreeting";
import type { WorldObject } from "./worldObject";

const TownMasterGreetingLayer = lazyWithReload(
  "town-master-greeting",
  () => import("./TownMasterCard"),
);

/**
 * The Town Master's greeting in Town, Board and Desk. On wide screens it
 * opens at the view's anchor (Town's figure beside the board, Board's hub,
 * Desk's summary); on phones it is a sheet with Back. `covered` is any open
 * window or sheet: the card never opens over one, and steps aside (to open
 * again once uncovered) if one opens over it.
 */
export function TownMasterGreetingHost({
  world,
  covered,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  covered: boolean;
}) {
  const greeting = sharedGreeting();
  const state = useGreeting(greeting);
  const presence = useOwnerPresence();
  const { mobile } = useLayoutPreferences();
  const here = lastHere(state.visit, presence.away);
  const placed = mobile || Boolean(state.anchor?.isConnected);
  const step = greetingStep(state, { covered, placed, here });
  useEffect(() => {
    if (step === "show") greeting.show();
    else if (step === "step-aside") greeting.stepAside();
  }, [greeting, step]);
  if (!state.open || covered || !placed) return null;
  return (
    <Suspense fallback={null}>
      <TownMasterGreetingLayer
        world={world}
        here={here}
        mobile={mobile}
        anchor={mobile ? null : state.anchor}
      />
    </Suspense>
  );
}
