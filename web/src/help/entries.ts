import { CHAT_HELP } from "../components/chat/chat.help";
import { BOARD_HELP } from "../world/board/board.help";
import { CODE_HELP } from "../world/code/code.help";
import { TOWN_HELP } from "../world/town/town.help";
import { WORLD_HELP } from "../world/world.help";
import type { HelpEntry, HelpPlace } from "./helpEntry";

/**
 * Every help declaration (helpEntry.ts). A new `*.help.ts` file is listed
 * here; `bun run help:check` fails on one that is not.
 */
export const HELP_ENTRIES: readonly HelpEntry[] = [
  ...TOWN_HELP,
  ...BOARD_HELP,
  ...CODE_HELP,
  ...CHAT_HELP,
  ...WORLD_HELP,
];

export function helpEntry(id: string) {
  return HELP_ENTRIES.find((entry) => entry.id === id) ?? null;
}

export function helpFor(place: HelpPlace) {
  return HELP_ENTRIES.filter((entry) => entry.place === place);
}

/** The short first-run path for a new user, in order. */
export function firstRunPath(entries: readonly HelpEntry[] = HELP_ENTRIES) {
  return entries
    .filter((entry) => entry.firstRun !== undefined)
    .sort((a, b) => a.firstRun! - b.firstRun!);
}
