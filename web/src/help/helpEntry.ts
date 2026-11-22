/**
 * Help that ships with each feature (#1025). A user-facing feature declares
 * its help beside its code, in a `<area>.help.ts` file: what it is, the steps
 * to try it, where it lives and the version it arrived in. The in-product
 * help panel, the Town Master's "What's new", docs/HELP.md and the site's
 * help page are all drawn from these declarations (web/src/help/entries.ts
 * lists the files).
 *
 * Declarations are plain data, so the build scripts read them too: no React,
 * CSS or browser globals here or in any `*.help.ts` file.
 */

/** Where an entry lives: a World view, Chat, or everywhere. */
export type HelpPlace = "town" | "board" | "code" | "chat" | "world";

export const HELP_PLACES: readonly HelpPlace[] = [
  "town",
  "board",
  "code",
  "chat",
  "world",
];

export const HELP_PLACE_LABELS: Record<HelpPlace, string> = {
  town: "Town",
  board: "Board",
  code: "Code",
  chat: "Chat",
  world: "Everywhere",
};

/** Places that are World views: Try switches to the view first. */
export const HELP_VIEW_PLACES: readonly HelpPlace[] = ["town", "board", "code"];

/** A picture's screen size: phone (390 × 844) or desktop (1280 × 800). */
export type HelpPictureSize = "phone" | "desktop";
export type HelpPictureTheme = "light" | "dark";

export const HELP_PICTURE_SIZES: readonly HelpPictureSize[] = [
  "desktop",
  "phone",
];
export const HELP_PICTURE_THEMES: readonly HelpPictureTheme[] = [
  "light",
  "dark",
];

/**
 * The synthetic scene a picture is captured from
 * (web/src/help/testing/HelpShots.browser.tsx): Town, Board, Code or an
 * agent's Chat, each with World's view picker over it.
 */
export type HelpScene = "town" | "board" | "code" | "chat";

export type HelpPicture = {
  scene: HelpScene;
  /** Sizes where the control exists; both by default. */
  sizes?: readonly HelpPictureSize[];
  /**
   * Controls pressed, in order, before the capture when the control is not
   * on screen: closed in a menu, or out of Town's view (CSS selectors).
   */
  press?: readonly string[];
};

export type HelpEntry = {
  /** Stable, unique: `<place>.<name>`, lower-case words and hyphens. */
  id: string;
  title: string;
  /** What it is, in one or two plain sentences. */
  summary: string;
  /** The steps to try it, each one short. */
  steps: readonly string[];
  place: HelpPlace;
  /** Where it lives on screen, in words, for when it is not on screen. */
  where: string;
  /**
   * The control it points at: an element marked `data-help="<control>"`
   * (or `helpAnchor("<control>")`) in the real component. Try spotlights
   * it; the check fails when no component carries it any more.
   */
  control: string;
  /** The World version it arrived in (or last changed in a way users see). */
  since: string;
  picture: HelpPicture;
  /** Its place in the short first-run path for a new user, from 1. */
  firstRun?: number;
};

/** Marks a control a help entry points at: `{...helpAnchor("board.next")}`. */
export function helpAnchor(control: string) {
  return { "data-help": control } as const;
}

const ID = /^(town|board|code|chat|world)\.[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Problems with one declaration, as plain sentences naming the entry. */
export function helpEntryProblems(entry: HelpEntry): string[] {
  const problems: string[] = [];
  const at = `help entry "${entry.id}"`;
  if (!ID.test(entry.id))
    problems.push(`${at}: id must be "<place>.<name>" in lower case`);
  else if (entry.id.split(".")[0] !== entry.place)
    problems.push(`${at}: id must start with its place "${entry.place}."`);
  if (!HELP_PLACES.includes(entry.place))
    problems.push(`${at}: unknown place "${entry.place}"`);
  if (!entry.title.trim()) problems.push(`${at}: needs a title`);
  if (!entry.summary.trim()) problems.push(`${at}: needs a summary`);
  if (!entry.where.trim()) problems.push(`${at}: needs a where`);
  if (!entry.steps.length || entry.steps.some((step) => !step.trim()))
    problems.push(`${at}: needs at least one step, none empty`);
  if (entry.steps.length > 5)
    problems.push(
      `${at}: keep it to five steps; detail goes in capability notes`,
    );
  if (!VERSION.test(entry.since))
    problems.push(`${at}: since must be a version such as 0.3.6`);
  if (!/^[a-z][a-z0-9.-]*$/.test(entry.control))
    problems.push(`${at}: control must be lower-case words, dots, hyphens`);
  if (entry.picture.sizes && !entry.picture.sizes.length)
    problems.push(`${at}: picture sizes cannot be empty`);
  return problems;
}

/** Orders versions such as 0.3.10 after 0.3.9. */
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** The sizes a picture is captured at. */
export function helpPictureSizes(entry: HelpEntry) {
  return entry.picture.sizes ?? HELP_PICTURE_SIZES;
}

/** A picture's file name, under web/public/help/. */
export function helpPictureFile(
  entry: Pick<HelpEntry, "id">,
  size: HelpPictureSize,
  theme: HelpPictureTheme,
) {
  return `${entry.id}.${size}.${theme}.webp`;
}

/**
 * The picture for this screen: its size when captured, else the other one.
 * A path under World's own origin.
 */
export function helpPictureUrl(
  entry: HelpEntry,
  size: HelpPictureSize,
  theme: HelpPictureTheme,
) {
  const sizes = helpPictureSizes(entry);
  const shown = sizes.includes(size) ? size : sizes[0];
  return `/help/${helpPictureFile(entry, shown, theme)}`;
}
