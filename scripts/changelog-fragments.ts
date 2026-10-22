#!/usr/bin/env bun
// Per-PR changelog fragments (after towncrier news fragments and Changesets).
// Each user-facing PR adds changes/<pr-number-or-slug>.md; stable release
// preparation appends them to CHANGELOG.md's Unreleased section and deletes them.
//
// Usage:
//   bun scripts/changelog-fragments.ts check            validate every fragment
//   bun scripts/changelog-fragments.ts assemble         fold fragments into CHANGELOG.md
//   bun scripts/changelog-fragments.ts pr <event.json>  require a fragment or opt-out in a PR

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedPathsBetween } from "./check-knowledge-map";
import { isDocumentationPath } from "./ci-reuse-full-check";

export const FRAGMENT_DIR = "changes";
const README = "README.md";
// Headings CHANGELOG.md uses, in the order new Unreleased sections are placed.
export const FRAGMENT_HEADINGS = [
  "Breaking Changes",
  "Added",
  "Changed",
  "Removed",
  "Fixed",
  "Documentation",
  "Known issues",
] as const;
const FRAGMENT_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;
const NO_CHANGELOG_REASON = /^\s*(?:-\s*)?Changelog:\s*none\s*[-–—:]\s*(.+)$/im;
const UNRELEASED = "## [Unreleased]\n";

export type Section = { heading: string; body: string };
export type Fragment = { name: string; sections: Section[] };

/** Parse and validate one fragment; throws with the first problem found. */
export function parseFragment(name: string, text: string): Fragment {
  const fail = (message: string): never => {
    throw new Error(`${FRAGMENT_DIR}/${name}: ${message}`);
  };
  if (!FRAGMENT_NAME.test(name)) {
    fail("name must be lower-case letters, digits and hyphens, ending in .md");
  }
  const raw: Array<{ heading: string; lines: string[] }> = [];
  for (const [index, line] of text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .entries()) {
    const at = `line ${index + 1}`;
    const current = raw.at(-1);
    const heading = /^(#+)\s*(.*?)\s*$/.exec(line);
    if (heading) {
      const title = heading[2];
      if (
        heading[1] !== "###" ||
        !(FRAGMENT_HEADINGS as readonly string[]).includes(title)
      ) {
        fail(
          `${at}: heading must be one of ${FRAGMENT_HEADINGS.map((h) => `"### ${h}"`).join(", ")}`,
        );
      }
      if (raw.some((section) => section.heading === title)) {
        fail(`${at}: "### ${title}" appears twice`);
      }
      raw.push({ heading: title, lines: [] });
      continue;
    }
    if (!line.trim()) {
      current?.lines.push("");
      continue;
    }
    if (!current) {
      return fail(
        `${at}: start with a "### Added", "### Changed" or "### Fixed" heading`,
      );
    }
    const first = current.lines.every((entry) => !entry.trim());
    if (first ? !line.startsWith("- ") : !/^(- |\s{2,}\S)/.test(line)) {
      fail(
        `${at}: entries are "- " bullets; indent continuation lines by two spaces`,
      );
    }
    current.lines.push(line.trimEnd());
  }
  const sections: Section[] = raw.map(({ heading, lines }) => {
    const body = lines.join("\n").trim();
    if (!body) fail(`"### ${heading}" has no entries`);
    return { heading, body };
  });
  if (!sections.length) fail("no entries");
  return { name, sections };
}

/** Read and validate every fragment, sorted by name (numbers numerically). */
export function readFragments(root: string): Fragment[] {
  const dir = join(root, FRAGMENT_DIR);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name !== README)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((name) => parseFragment(name, readFileSync(join(dir, name), "utf8")));
}

/** Append fragment entries to the Unreleased section, grouped by heading. */
export function assembleChangelog(
  changelog: string,
  fragments: Fragment[],
): string {
  const start = changelog.indexOf(UNRELEASED);
  if (start < 0) throw new Error("CHANGELOG.md has no Unreleased section");
  const bodyStart = start + UNRELEASED.length;
  const nextRelease = changelog.indexOf("\n## [", bodyStart);
  const end = nextRelease < 0 ? changelog.length : nextRelease + 1;
  if (!fragments.length) return changelog;

  const body = changelog.slice(bodyStart, end);
  const parts = body.split(/^### /m);
  const preamble = parts[0].trim();
  const sections: Section[] = parts.slice(1).map((part) => {
    const newline = part.indexOf("\n");
    return {
      heading: (newline < 0 ? part : part.slice(0, newline)).trim(),
      body: newline < 0 ? "" : part.slice(newline + 1).trim(),
    };
  });
  const rank = (heading: string) => {
    const index = (FRAGMENT_HEADINGS as readonly string[]).indexOf(heading);
    return index < 0 ? FRAGMENT_HEADINGS.length : index;
  };
  for (const fragment of fragments) {
    for (const entry of fragment.sections) {
      const existing = sections.find(
        ({ heading }) => heading === entry.heading,
      );
      if (existing) {
        existing.body = existing.body
          ? `${existing.body}\n${entry.body}`
          : entry.body;
        continue;
      }
      const before = sections.findIndex(
        ({ heading }) => rank(heading) > rank(entry.heading),
      );
      sections.splice(before < 0 ? sections.length : before, 0, { ...entry });
    }
  }
  const blocks = [
    ...(preamble ? [preamble] : []),
    ...sections.map(({ heading, body }) => `### ${heading}\n\n${body}`),
  ];
  return `${changelog.slice(0, bodyStart)}\n${blocks.join("\n\n")}\n\n${changelog.slice(end)}`;
}

/** Fold every fragment into CHANGELOG.md and delete the fragments. */
export function assembleFragments(root: string): string[] {
  const fragments = readFragments(root);
  if (!fragments.length) return [];
  const path = join(root, "CHANGELOG.md");
  writeFileSync(path, assembleChangelog(readFileSync(path, "utf8"), fragments));
  for (const { name } of fragments) rmSync(join(root, FRAGMENT_DIR, name));
  return fragments.map(({ name }) => name);
}

/**
 * A PR that changes code (anything CI would not treat as documentation-only)
 * must add or edit a fragment, or say `Changelog: none — <reason>` in its body.
 */
export function assessPullRequest(
  changedPaths: readonly string[],
  presentPaths: ReadonlySet<string>,
  body: string | null | undefined,
): {
  ok: boolean;
  codePaths: string[];
  fragments: string[];
  reason: string | null;
} {
  const fragments = changedPaths.filter(
    (path) =>
      path.startsWith(`${FRAGMENT_DIR}/`) &&
      path !== `${FRAGMENT_DIR}/${README}` &&
      path.endsWith(".md") &&
      presentPaths.has(path),
  );
  const codePaths = changedPaths.filter((path) => !isDocumentationPath(path));
  const reason = (body ?? "").match(NO_CHANGELOG_REASON)?.[1]?.trim() ?? null;
  const hasReason =
    reason !== null && reason.length >= 20 && !/^<.*>$/.test(reason);
  return {
    ok: codePaths.length === 0 || fragments.length > 0 || hasReason,
    codePaths,
    fragments,
    reason: hasReason ? reason : null,
  };
}

function main(argv: string[]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const [command, eventPath] = argv;
  if (command === "check") {
    const fragments = readFragments(root);
    console.log(`${fragments.length} changelog fragment(s) valid.`);
    return;
  }
  if (command === "assemble") {
    const names = assembleFragments(root);
    console.log(
      names.length
        ? `Added ${names.length} fragment(s) to CHANGELOG.md: ${names.join(", ")}`
        : "No changelog fragments to assemble.",
    );
    return;
  }
  if (command === "pr" && eventPath) {
    readFragments(root);
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: {
        base?: { sha?: string };
        head?: { sha?: string };
        body?: string | null;
      };
    };
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha;
    if (!base || !head) throw new Error("Missing pull-request base or head");
    const changed = changedPathsBetween(root, base, head);
    const present = new Set(
      changed.filter((path) => existsSync(join(root, path))),
    );
    const result = assessPullRequest(
      changed,
      present,
      event.pull_request?.body,
    );
    if (result.ok) {
      console.log(
        result.fragments.length
          ? `Changelog fragment(s): ${result.fragments.join(", ")}`
          : result.reason
            ? `No changelog entry: ${result.reason}`
            : "Documentation-only change; no changelog fragment needed.",
      );
      return;
    }
    console.error(
      `${result.codePaths.length} non-documentation file(s) changed without a changelog fragment.`,
    );
    console.error(
      `Add ${FRAGMENT_DIR}/<pr-number-or-slug>.md (see ${FRAGMENT_DIR}/${README}), or put \`Changelog: none — <specific reason>\` in the PR description.`,
    );
    process.exitCode = 1;
    return;
  }
  throw new Error(
    "Usage: changelog-fragments.ts check | assemble | pr <event.json>",
  );
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
