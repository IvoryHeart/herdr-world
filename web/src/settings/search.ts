/**
 * The one search over the registry (#1035): the Settings screen and the
 * command box (Cmd+K) both call it, so a word finds the same things in both.
 * It matches an entry's title, the words people use for it ("lighting",
 * "night"), its line, its category and its choices' names, and says which
 * choice matched so "night" can offer Night at once.
 */

import { normalizeSearchText } from "../searchText";
import {
  categoryLabel,
  type ChoiceOption,
  type RegistryEntry,
} from "./registry";

export type SettingsMatch = {
  entry: RegistryEntry;
  /** 0–1; higher first. */
  score: number;
  /** The choice the search named, such as Night for "night". */
  option?: ChoiceOption;
};

/** Folds a word to its stem enough that "sounds" finds "Sound". */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function terms(text: string) {
  return normalizeSearchText(text).split(" ").filter(Boolean).map(stem);
}

/** Every query word starts some word of the text. */
function covers(query: readonly string[], text: string) {
  if (!query.length) return false;
  const words = terms(text);
  return query.every((q) => words.some((word) => word.startsWith(q)));
}

function phrase(query: string, text: string) {
  return normalizeSearchText(text).includes(query);
}

function options(entry: RegistryEntry): readonly ChoiceOption[] {
  return entry.kind === "setting" && entry.control.type === "choice"
    ? entry.control.options
    : [];
}

/** How well one entry answers a query, or null when it does not. */
export function matchEntry(
  entry: RegistryEntry,
  rawQuery: string,
): SettingsMatch | null {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { entry, score: 0.5 };
  const words = terms(query);
  const title = normalizeSearchText(entry.title);
  const synonyms = (entry.words ?? []).join(" ");
  for (const option of options(entry)) {
    const optionText = [option.label, ...(option.words ?? [])].join(" ");
    if (covers(words, optionText)) return { entry, score: 0.9, option };
  }
  if (title === query) return { entry, score: 1 };
  if (title.includes(query)) return { entry, score: 0.95 };
  if (phrase(query, synonyms) || covers(words, entry.title))
    return { entry, score: 0.85 };
  if (covers(words, `${entry.title} ${synonyms}`))
    return { entry, score: 0.75 };
  const everything = [
    entry.title,
    synonyms,
    entry.description ?? "",
    categoryLabel(entry.category),
    entry.alsoOn ?? "",
    ...options(entry).flatMap((option) => [
      option.label,
      ...(option.words ?? []),
    ]),
  ].join(" ");
  if (covers(words, everything)) return { entry, score: 0.55 };
  return null;
}

/** The entries a query finds, best first; with no query, all in order. */
export function searchSettings(
  list: readonly RegistryEntry[],
  query: string,
): SettingsMatch[] {
  const found: SettingsMatch[] = [];
  for (const entry of list) {
    const match = matchEntry(entry, query);
    if (match) found.push(match);
  }
  if (!normalizeSearchText(query)) return found;
  return found
    .map((match, index) => ({ match, index }))
    .sort((a, b) => b.match.score - a.match.score || a.index - b.index)
    .map(({ match }) => match);
}

/**
 * The same search for a command box action (title, line, keywords), so the
 * command box ranks its own commands as Settings does: 0 when it does not
 * match.
 */
export function commandMatchScore(
  action: { title: string; detail?: string; keywords?: readonly string[] },
  query: string,
) {
  return (
    matchEntry(
      {
        kind: "command",
        id: "",
        category: "commands",
        title: action.title,
        description: action.detail,
        words: action.keywords,
        run: () => {},
      },
      query,
    )?.score ?? 0
  );
}
