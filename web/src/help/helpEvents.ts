import { worldViewFromPath, type WorldView } from "../world/worldViewRouting";
import type { HelpPlace } from "./helpEntry";

/** A tab of the help panel: what is new, or what you can do in a place. */
export type HelpTab = "new" | HelpPlace;

/** Opens the help panel (HelpPanelHost.tsx) at a tab. */
export const OPEN_HELP_EVENT = "herdr-world:open-help";
/** Try: show a help entry's control on screen (helpTry.ts). */
export const HELP_TRY_EVENT = "herdr-world:help-try";

export function openHelp(tab: HelpTab) {
  window.dispatchEvent(
    new CustomEvent<{ tab: HelpTab }>(OPEN_HELP_EVENT, { detail: { tab } }),
  );
}

export function tryHelp(id: string) {
  window.dispatchEvent(
    new CustomEvent<{ id: string }>(HELP_TRY_EVENT, { detail: { id } }),
  );
}

/** The help tab for a World view: Town, Board, or what works everywhere. */
export function helpTabForView(view: WorldView): HelpTab {
  return view === "town" || view === "board" ? view : "world";
}

export function helpTabForPath(pathname: string) {
  return helpTabForView(worldViewFromPath(pathname));
}
