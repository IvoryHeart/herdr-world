/**
 * Help declarations as the build sees them (web/src/help/helpEntry.ts): the
 * entries, the controls the product marks with `data-help`, and each
 * picture's input fingerprint. Shared by the check (scripts/help-check.ts),
 * the picture generator (scripts/help-pictures.ts) and the help page
 * (scripts/help-docs.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { HELP_ENTRIES } from "../web/src/help/entries";
import {
  HELP_PICTURE_THEMES,
  helpPictureFile,
  helpPictureSizes,
  type HelpEntry,
  type HelpPictureSize,
} from "../web/src/help/helpEntry";

export const ROOT = resolve(import.meta.dir, "..");
export const HELP_PICTURE_DIRECTORY = "web/public/help";
export const HELP_PICTURE_MANIFEST = "web/src/help/pictures.json";
export const HELP_ENTRIES_FILE = "web/src/help/entries.ts";
export const HELP_DOC = "docs/HELP.md";

/** Screen sizes and the crop around the control, in CSS pixels. */
export const HELP_PICTURE_VIEWPORTS: Record<
  HelpPictureSize,
  { width: number; height: number; mobile: boolean }
> = {
  desktop: { width: 1280, height: 800, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};
export const HELP_PICTURE_CROPS: Record<
  HelpPictureSize,
  { width: number; height: number }
> = {
  desktop: { width: 640, height: 400 },
  phone: { width: 390, height: 300 },
};

/**
 * Where a picture's rendering starts: the stage and the generator. Every
 * repository file they import, directly or through other files (components,
 * CSS, the synthetic scene, the capture script), is an input of every
 * picture; see helpStageInputs.
 */
export const HELP_STAGE_FILES = [
  "web/src/help/testing/HelpShots.browser.tsx",
  "scripts/help-pictures.ts",
] as const;

/**
 * Imported files that are not what a picture shows: the help declarations
 * (each entry's own control and picture are hashed per entry) and the
 * manifest the generator writes.
 */
function notAPictureInput(file: string) {
  return (
    file.endsWith(".help.ts") ||
    file === HELP_ENTRIES_FILE ||
    file === HELP_PICTURE_MANIFEST
  );
}

const SCRIPT_SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;
const STYLE_SPECIFIER =
  /@import\s+(?:url\()?\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;
const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".json",
  "/index.ts",
  "/index.tsx",
];

function resolveRelative(from: string, specifier: string, root: string) {
  if (!specifier.startsWith(".")) return undefined;
  const base = join(root, dirname(from), specifier.replace(/[?#].*$/, ""));
  for (const suffix of RESOLVE_SUFFIXES) {
    const path = base + suffix;
    if (existsSync(path) && statSync(path).isFile())
      return relative(root, path);
  }
  return undefined;
}

const stageInputs = new Map<string, readonly string[]>();

/**
 * Every repository file the pictures are rendered from: the stage files and
 * everything they import through relative paths (scripts, components, CSS
 * and its `@import`/`url()` assets), in a stable order. Packages are pinned
 * by the lockfile and not followed. A change to any of these files makes
 * every picture stale, because any of them can move what a crop shows.
 */
export function helpStageInputs(root = ROOT): readonly string[] {
  const known = stageInputs.get(root);
  if (known) return known;
  const found = new Set<string>();
  const pending: string[] = [...HELP_STAGE_FILES];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (found.has(file) || notAPictureInput(file)) continue;
    found.add(file);
    if (!/\.(tsx?|jsx?|mjs|css)$/.test(file)) continue;
    const text = readFileSync(join(root, file), "utf8");
    const pattern = file.endsWith(".css") ? STYLE_SPECIFIER : SCRIPT_SPECIFIER;
    for (const match of text.matchAll(pattern)) {
      const resolved = resolveRelative(file, match[1] ?? match[2]!, root);
      if (resolved && !found.has(resolved)) pending.push(resolved);
    }
  }
  const inputs = [...found].sort();
  stageInputs.set(root, inputs);
  return inputs;
}

/** Lines around a control that count as the control's own markup. */
const NEIGHBOURHOOD = 20;

export function helpEntries(): readonly HelpEntry[] {
  return HELP_ENTRIES;
}

export type HelpAnchor = {
  file: string;
  line: number;
  /** The control's markup: the lines around the anchor. */
  markup: string;
};

const ANCHOR =
  /data-help="([a-z][a-z0-9.-]*)"|helpAnchor\(\s*"([a-z][a-z0-9.-]*)"\s*\)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" || entry.name === "testing"
        ? []
        : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|browser)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".help.ts")
      ? [path]
      : [];
  });
}

/**
 * Every control the product marks for help, by control: where it is and
 * its markup. The help module itself is not a product control.
 */
export function scanHelpAnchors(root = ROOT) {
  const anchors = new Map<string, HelpAnchor[]>();
  const web = join(root, "web/src");
  for (const path of sourceFiles(web)) {
    const file = relative(root, path);
    if (file.startsWith("web/src/help/")) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes("data-help") && !text.includes("helpAnchor(")) continue;
    const lines = text.split("\n");
    for (const match of text.matchAll(ANCHOR)) {
      const control = match[1] ?? match[2]!;
      const line = text.slice(0, match.index).split("\n").length;
      const markup = lines
        .slice(Math.max(0, line - 1 - NEIGHBOURHOOD), line + NEIGHBOURHOOD)
        .join("\n");
      anchors.set(control, [
        ...(anchors.get(control) ?? []),
        { file, line, markup },
      ]);
    }
  }
  return anchors;
}

/** Every `*.help.ts` declaration file under web/src. */
export function helpDeclarationFiles(root = ROOT) {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (entry.name.endsWith(".help.ts"))
        found.push(relative(root, path));
    }
  };
  walk(join(root, "web/src"));
  return found.sort();
}

/**
 * A picture's inputs, hashed: the entry's control and picture, the control's
 * markup wherever it is marked, and every file the stage renders from
 * (helpStageInputs). The check compares this with the manifest written when
 * the pictures were made.
 */
export function helpPictureFingerprint(
  entry: HelpEntry,
  anchors: Map<string, HelpAnchor[]>,
  root = ROOT,
) {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      control: entry.control,
      picture: entry.picture,
      viewports: HELP_PICTURE_VIEWPORTS,
      crops: HELP_PICTURE_CROPS,
    }),
  );
  for (const anchor of anchors.get(entry.control) ?? [])
    hash.update(`\n${anchor.file}\n${anchor.markup}`);
  for (const file of helpStageInputs(root))
    hash.update(`\n${file}\n${readFileSync(join(root, file), "utf8")}`);
  return hash.digest("hex").slice(0, 16);
}

/** The picture files an entry has: each size it is captured at, both themes. */
export function helpPictureFiles(entry: HelpEntry) {
  return helpPictureSizes(entry).flatMap((size) =>
    HELP_PICTURE_THEMES.map((theme) => helpPictureFile(entry, size, theme)),
  );
}

export type HelpPictureManifest = Record<
  string,
  { fingerprint: string; files: string[] }
>;

export function readHelpPictureManifest(root = ROOT): HelpPictureManifest {
  try {
    return JSON.parse(
      readFileSync(join(root, HELP_PICTURE_MANIFEST), "utf8"),
    ) as HelpPictureManifest;
  } catch {
    return {};
  }
}
