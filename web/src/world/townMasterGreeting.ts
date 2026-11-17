import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AgentLook } from "../../../shared/agentProfile";
import { worldLocalStorage } from "../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  writeOfficePreferences,
  type OfficePreferences,
} from "./officePreferences";
import { sharedPresence } from "./presence";
import { AWAY_MS, type AwayWindow } from "./sinceYouLeft";

/**
 * The Town Master's greeting (onboarding O1): one card per visit with hello,
 * "since you left" and update news. A visit is World opening, or the page
 * coming back on screen after being hidden for 30 minutes or more. The card
 * opens once per visit, never over an open window or sheet: covered, it
 * waits until uncovered. **Show this on start** (on by default) is kept per
 * browser, like the since-you-left ✕.
 */

export type GreetingVisit = {
  /** The visit began after this time (epoch ms). */
  from: number;
  /** When the owner was last here before the visit, if known. */
  before: number | null;
};

export type GreetingSnapshot = {
  open: boolean;
  /** This visit's greeting has not been shown yet. */
  pending: boolean;
  visit: GreetingVisit | null;
  /** Where the card opens on wide screens: the figure or a summary card. */
  anchor: HTMLElement | null;
};

export type GreetingDeps = {
  now(): number;
  showOnStart(): boolean;
};

export class TownMasterGreeting {
  #deps: GreetingDeps;
  #listeners = new Set<() => void>();
  #state: GreetingSnapshot = {
    open: false,
    pending: false,
    visit: null,
    anchor: null,
  };
  #hiddenAt: number | null = null;
  /** The figure opened the card: it comes back after stepping aside. */
  #byFigure = false;

  constructor(deps: GreetingDeps) {
    this.#deps = deps;
  }

  get = () => this.#state;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** A visit begins; its greeting waits to be shown if Show this on start is on. */
  visit(visit: GreetingVisit) {
    this.#byFigure = false;
    this.#set({ visit, open: false, pending: this.#deps.showOnStart() });
  }

  /** The page went off screen. */
  hidden() {
    this.#hiddenAt ??= this.#deps.now();
  }

  /** The page came back on screen: a new visit after 30 minutes or more. */
  visible() {
    const hiddenAt = this.#hiddenAt;
    this.#hiddenAt = null;
    if (hiddenAt !== null && this.#deps.now() - hiddenAt >= AWAY_MS)
      this.visit({ from: hiddenAt, before: hiddenAt });
  }

  /**
   * Uncovered and placed: the visit's pending greeting opens, unless Show
   * this on start was turned off while it waited.
   */
  show() {
    if (!this.#state.pending) return;
    const open = this.#byFigure || this.#deps.showOnStart();
    this.#set({ open, pending: false });
  }

  /** A window or sheet opened over the place: wait until it closes. */
  stepAside() {
    if (this.#state.open) this.#set({ open: false, pending: true });
  }

  /** ✕, Escape, Back, a press outside, or a line taken. */
  close() {
    this.#byFigure = false;
    if (this.#state.open || this.#state.pending)
      this.#set({ open: false, pending: false });
  }

  /** The figure: opens the card again, or closes it. */
  toggle() {
    this.#byFigure = !this.#state.open;
    this.#set({ open: !this.#state.open, pending: false });
  }

  anchor(element: HTMLElement | null) {
    if (this.#state.anchor !== element) this.#set({ anchor: element });
  }

  #set(patch: Partial<GreetingSnapshot>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

/**
 * What the greeting does now: open a waiting greeting once nothing covers
 * its place, or step aside when a window or sheet opens over it. Every
 * visit greets, the very first too (its hello has no last time).
 */
export function greetingStep(
  state: Pick<GreetingSnapshot, "open" | "pending">,
  { covered, placed }: { covered: boolean; placed: boolean },
): "show" | "step-aside" | null {
  if (state.open) return covered ? "step-aside" : null;
  return state.pending && !covered && placed ? "show" : null;
}

/**
 * When the owner was last here: the start of a return that began in this
 * visit (it knows other devices too), else the visit's own last seen.
 */
export function lastHere(
  visit: GreetingVisit | null,
  away: AwayWindow | null,
): number | null {
  if (!visit) return null;
  if (away && away.at > visit.from) return away.since;
  return visit.before;
}

type Box = Pick<DOMRect, "left" | "top" | "right" | "bottom">;
type Size = { width: number; height: number };

const MARGIN = 8;

/**
 * Where the card opens beside its anchor: below it when it fits, else above,
 * kept on screen.
 */
export function greetingPlacement(
  anchor: Pick<DOMRect, "left" | "top" | "bottom">,
  card: Size,
  viewport: Size,
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

/** The card's size before it has been measured (townMasterCard.css). */
export const GREETING_CARD_ESTIMATE: Size = Object.freeze({
  width: 300,
  height: 280,
});

/**
 * Open windows and sheets on wide screens: agent windows such as Chat,
 * panels, the context rail (an intent or docked window) and Needs you.
 */
export const GREETING_COVERS =
  ".world-managed-window, .world-context-rail, .needs-you-tab";

/**
 * Whether an open window or sheet lies over the greeting's place: its anchor
 * and the card where it opens. A window docked or floating elsewhere on a
 * wide screen leaves the place free, so the greeting still opens.
 */
export function greetingCovered(
  anchor: Box,
  card: Size,
  viewport: Size,
  covers: readonly Box[],
) {
  const { left, top } = greetingPlacement(anchor, card, viewport);
  const place: Box[] = [
    anchor,
    { left, top, right: left + card.width, bottom: top + card.height },
  ];
  return covers.some(
    (cover) =>
      cover.right > cover.left &&
      cover.bottom > cover.top &&
      place.some(
        (box) =>
          box.left < cover.right &&
          cover.left < box.right &&
          box.top < cover.bottom &&
          cover.top < box.bottom,
      ),
  );
}

/** The Town Master's look: Town's sprites, a captain with a badge. */
export const TOWN_MASTER_LOOK: AgentLook = Object.freeze({
  skin: "#d9a066",
  hair: "#3b2a1e",
  hair_style: "short",
  outfit: "captain",
  shirt: "#2d4a6b",
  pants: "#253244",
  accessory: "badge",
});

let shared: TownMasterGreeting | null = null;

/** The page's greeting; World opening is its first visit. */
export function sharedGreeting() {
  if (shared) return shared;
  shared = new TownMasterGreeting({
    now: () => Date.now(),
    showOnStart: () => readOfficePreferences(worldLocalStorage).townGreeting,
  });
  shared.visit({
    from: Date.now() - performance.now(),
    before: sharedPresence().lastSeenBefore,
  });
  return shared;
}

/** Tests start from no greeting. */
export function resetGreetingForTest(greeting: TownMasterGreeting | null) {
  shared = greeting;
}

/**
 * Browser suites that mount World but do not test the greeting: no visit
 * greets, so the card never sits over what they press.
 */
export function quietGreetingForTest() {
  resetGreetingForTest(
    new TownMasterGreeting({ now: () => Date.now(), showOnStart: () => false }),
  );
}

export function useGreeting(greeting = sharedGreeting()) {
  return useSyncExternalStore(greeting.subscribe, greeting.get, greeting.get);
}

/** Watches the page coming back on screen while World runs. */
export function useGreetingWatch() {
  useEffect(() => {
    const greeting = sharedGreeting();
    const onVisibility = () => {
      if (document.visibilityState === "visible") greeting.visible();
      else greeting.hidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}

/** A ref for the element the card opens at in this view. */
export function useGreetingAnchor() {
  return useCallback(
    (element: HTMLElement | null) => sharedGreeting().anchor(element),
    [],
  );
}

/** Show this on start: the one per-browser value, also in Menu. */
export function setGreetingOnStart(on: boolean): OfficePreferences {
  const next = writeOfficePreferences(worldLocalStorage, {
    ...readOfficePreferences(worldLocalStorage),
    townGreeting: on,
  });
  window.dispatchEvent(
    new CustomEvent<OfficePreferences>(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, {
      detail: next,
    }),
  );
  return next;
}

/** Opens World's Menu at its update control (ConfigMenu listens). */
export const WORLD_OPEN_UPDATE_MENU_EVENT = "herdr-world:open-update-menu";
