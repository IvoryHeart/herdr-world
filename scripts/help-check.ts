/**
 * The help check (`bun run help:check`, part of check:docs and the delivery
 * gate's static lane). Help evolves with the product by rule:
 *
 * - every declaration is well formed, with a unique id;
 * - every entry's control is still marked in a component
 *   (`data-help="<control>"` or `helpAnchor("<control>")`);
 * - every entry's pictures exist and were made from the current inputs
 *   (else: bun run help:pictures);
 * - every `*.help.ts` file is listed in web/src/help/entries.ts;
 * - no picture is left over from a removed entry;
 * - docs/HELP.md is current (else: bun run help:docs).
 *
 * A user-facing change that adds no help entry is caught at the PR body
 * (scripts/check-pr-body.ts), like a change without a changelog fragment.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type HelpEntry, helpEntryProblems } from "../web/src/help/helpEntry";
import {
  type HelpAnchor,
  HELP_ENTRIES_FILE,
  HELP_PICTURE_DIRECTORY,
  type HelpPictureManifest,
  helpDeclarationFiles,
  helpEntries,
  helpPictureFiles,
  helpPictureFingerprint,
  readHelpPictureManifest,
  ROOT,
  scanHelpAnchors,
} from "./help-declarations";
import { helpDocCurrent } from "./help-docs";

export type HelpCheckInput = {
  entries: readonly HelpEntry[];
  anchors: Map<string, HelpAnchor[]>;
  manifest: HelpPictureManifest;
  /** Files in web/public/help/. */
  pictures: readonly string[];
  /** `*.help.ts` files, relative to the repository. */
  declarationFiles: readonly string[];
  /** web/src/help/entries.ts's source. */
  entriesSource: string;
  fingerprint: (entry: HelpEntry) => string;
  docCurrent: boolean;
};

/** How entries.ts imports a declaration file. */
function importPath(file: string) {
  const path = relative(dirname(HELP_ENTRIES_FILE), file).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

/** Every problem, as a sentence naming the entry or file and the fix. */
export function helpCheckProblems(input: HelpCheckInput): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const firstRun = new Map<number, string>();
  for (const entry of input.entries) {
    problems.push(...helpEntryProblems(entry));
    if (ids.has(entry.id))
      problems.push(`help entry "${entry.id}" is declared twice`);
    ids.add(entry.id);
    if (entry.firstRun !== undefined) {
      const other = firstRun.get(entry.firstRun);
      if (other)
        problems.push(
          `help entries "${other}" and "${entry.id}" share first-run place ${entry.firstRun}`,
        );
      firstRun.set(entry.firstRun, entry.id);
    }
    if (!input.anchors.has(entry.control)) {
      problems.push(
        `help entry "${entry.id}" points at control "${entry.control}", which no component marks (data-help="${entry.control}"). Mark the control again, or update the entry.`,
      );
      continue;
    }
    const made = input.manifest[entry.id];
    const files = helpPictureFiles(entry);
    const missing = files.filter((file) => !input.pictures.includes(file));
    if (!made || missing.length)
      problems.push(
        `help entry "${entry.id}" has no picture${missing.length ? ` (${missing.join(", ")})` : ""}; run bun run help:pictures`,
      );
    else if (made.fingerprint !== input.fingerprint(entry))
      problems.push(
        `help entry "${entry.id}" has an out-of-date picture: its control, its picture or the stage changed; run bun run help:pictures`,
      );
  }
  const expected = new Set(
    input.entries.flatMap((entry) => helpPictureFiles(entry)),
  );
  for (const picture of input.pictures)
    if (!expected.has(picture))
      problems.push(
        `${HELP_PICTURE_DIRECTORY}/${picture} belongs to no help entry; run bun run help:pictures`,
      );
  for (const id of Object.keys(input.manifest))
    if (!ids.has(id))
      problems.push(
        `the picture manifest lists "${id}", which is no help entry; run bun run help:pictures`,
      );
  for (const file of input.declarationFiles)
    if (!input.entriesSource.includes(`"${importPath(file)}"`))
      problems.push(`${file} is not listed in ${HELP_ENTRIES_FILE}`);
  if (!input.docCurrent)
    problems.push("docs/HELP.md is out of date; run bun run help:docs");
  return problems;
}

/** The repository's help, as the check sees it. */
export function repositoryHelp(root = ROOT): HelpCheckInput {
  const anchors = scanHelpAnchors(root);
  const directory = join(root, HELP_PICTURE_DIRECTORY);
  const entries = helpEntries();
  return {
    entries,
    anchors,
    manifest: readHelpPictureManifest(root),
    pictures: existsSync(directory)
      ? readdirSync(directory).filter((file) => file.endsWith(".webp"))
      : [],
    declarationFiles: helpDeclarationFiles(root),
    entriesSource: readFileSync(join(root, HELP_ENTRIES_FILE), "utf8"),
    fingerprint: (entry) => helpPictureFingerprint(entry, anchors, root),
    docCurrent: helpDocCurrent(root, entries),
  };
}

if (import.meta.main) {
  const problems = helpCheckProblems(repositoryHelp());
  if (problems.length) {
    for (const problem of problems) process.stderr.write(`help: ${problem}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      `help: ${helpEntries().length} entries, each control marked and pictured\n`,
    );
}
