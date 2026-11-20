import { compareVersions, type HelpEntry } from "./helpEntry";
import { firstRunPath, HELP_ENTRIES } from "./entries";

/**
 * What the Town Master offers from the help declarations (helpEntry.ts):
 * a returning user sees the entries newer than the last ones they were
 * shown; a new user gets the short first-run path. Both once: closing the
 * greeting marks them seen in this browser.
 */
export type WhatsNew = {
  kind: "new" | "start";
  entries: readonly HelpEntry[];
};

/** The newest version any entry arrived in, the one marked seen. */
export function newestHelpVersion(
  entries: readonly HelpEntry[] = HELP_ENTRIES,
) {
  return entries.reduce<string | null>(
    (newest, entry) =>
      newest === null || compareVersions(entry.since, newest) > 0
        ? entry.since
        : newest,
    null,
  );
}

/**
 * `seen` is the newest version already shown in this browser, or null.
 * Without one, a user World has seen before (`returning`) gets the newest
 * version's entries, and a new user the first-run path.
 */
export function whatsNew(
  seen: string | null,
  returning: boolean,
  entries: readonly HelpEntry[] = HELP_ENTRIES,
): WhatsNew | null {
  if (seen === null && !returning) {
    const start = firstRunPath(entries);
    return start.length ? { kind: "start", entries: start } : null;
  }
  const since = seen ?? previousVersion(entries);
  const fresh = entries
    .filter(
      (entry) => since === null || compareVersions(entry.since, since) > 0,
    )
    .sort((a, b) => compareVersions(b.since, a.since));
  return fresh.length ? { kind: "new", entries: fresh } : null;
}

/** The version before the newest, so a returning user sees the newest's entries. */
function previousVersion(entries: readonly HelpEntry[]) {
  const newest = newestHelpVersion(entries);
  return newest === null
    ? null
    : entries.reduce<string | null>(
        (previous, entry) =>
          compareVersions(entry.since, newest) < 0 &&
          (previous === null || compareVersions(entry.since, previous) > 0)
            ? entry.since
            : previous,
        null,
      );
}

const SEEN = "help.seen";

export function readHelpSeen(storage: Pick<Storage, "getItem">) {
  const value = storage.getItem(SEEN);
  return value && /^\d+\.\d+\.\d+$/.test(value) ? value : null;
}

export function markHelpSeen(
  storage: Pick<Storage, "setItem">,
  entries: readonly HelpEntry[] = HELP_ENTRIES,
) {
  const newest = newestHelpVersion(entries);
  if (newest === null) return;
  try {
    storage.setItem(SEEN, newest);
  } catch {
    // Storage full or blocked: the news shows again next time.
  }
}

/**
 * Testing switch: `?whatsNewSince=0.3.0` shows what is new after 0.3.0, and
 * `?whatsNewSince=new` the first-run path, as if this browser had seen that
 * much. The address loses the parameter at once; the stored value is
 * replaced as if the user had been shown that much, so a reload shows it
 * again until the greeting closes.
 */
export function takeWhatsNewSwitch(
  storage: Pick<Storage, "setItem" | "removeItem">,
  location: Pick<Location, "href">,
  history: Pick<History, "replaceState" | "state">,
): { returning: boolean } | null {
  const url = new URL(location.href);
  const value = url.searchParams.get("whatsNewSince");
  if (value === null) return null;
  url.searchParams.delete("whatsNewSince");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  if (value === "new") {
    storage.removeItem(SEEN);
    return { returning: false };
  }
  if (!/^\d+\.\d+\.\d+$/.test(value)) return null;
  storage.setItem(SEEN, value);
  return { returning: true };
}
