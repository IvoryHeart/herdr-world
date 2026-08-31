import { escapeRegex, normalizeReleaseTag, releaseVersion } from "./release-version.mjs";

const CHANGELOG_SUBSECTIONS = ["Breaking Changes", "Added", "Changed", "Fixed", "Removed"];

export const UNRELEASED_CHANGELOG_TEMPLATE = `## [Unreleased]

### Breaking Changes

### Added

### Changed

### Fixed

### Removed
`;

const HERDR_WEB_COMMIT_URL = "https://github.com/kcosr/herdr-web/commit";

export function herdrWebBaselineNote(upstream) {
  const match = upstream.match(
    /- Herdr Web: `([0-9a-f]{40})`\s+\(([^)]+)\)/,
  );
  if (!match) {
    throw new Error("UPSTREAM.md is missing a parseable Herdr Web synchronization point");
  }
  const [, commit, rawDescription] = match;
  const description = rawDescription.replaceAll("`", "").replace(/\s+/g, " ").trim();
  return (
    `> **Herdr Web baseline:** Derived from ${description} at\n` +
    `> [\`${commit.slice(0, 8)}\`](${HERDR_WEB_COMMIT_URL}/${commit}).`
  );
}

export function removeEmptyChangelogSubsections(body) {
  let cleaned = body;
  for (const subsection of CHANGELOG_SUBSECTIONS) {
    cleaned = cleaned.replace(
      new RegExp(`(^|\\n)### ${escapeRegex(subsection)}\\n\\n*(?=### |$)`, "g"),
      "$1",
    );
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trimEnd();
  return cleaned ? `\n${cleaned.trimStart()}\n` : "\n";
}

export function prepareReleaseChangelog(changelog, tag, date, upstream) {
  const version = releaseVersion(normalizeReleaseTag(tag));
  const releaseHeading = new RegExp(`^## \\[${escapeRegex(version)}\\] - `, "m");
  if (releaseHeading.test(changelog)) {
    throw new Error(`CHANGELOG.md already contains a release section for ${tag}`);
  }

  const unreleasedPattern = /(^|\n)## \[Unreleased\]\n([\s\S]*?)(?=\n## |$)/;
  const unreleased = changelog.match(unreleasedPattern);
  if (!unreleased) {
    throw new Error("CHANGELOG.md is missing an Unreleased section");
  }
  const releaseBody = removeEmptyChangelogSubsections(unreleased[2]);
  if (!releaseBody.trim()) {
    throw new Error("CHANGELOG.md has no release notes under Unreleased");
  }

  const prepared = changelog.replace(
    unreleasedPattern,
    `${unreleased[1]}${UNRELEASED_CHANGELOG_TEMPLATE}\n` +
      `## [${version}] - ${date}\n\n${herdrWebBaselineNote(upstream)}\n${releaseBody}`,
  );
  if (prepared === changelog) {
    throw new Error("could not open the next Unreleased changelog section");
  }
  return prepared;
}

export function assertPreparedReleaseChangelog(changelog, tag, upstream, expectedDate) {
  const version = releaseVersion(normalizeReleaseTag(tag));
  const unreleased = changelog.match(/(?:^|\n)## \[Unreleased\]\n([\s\S]*?)(?=\n## |$)/);
  if (!unreleased) {
    throw new Error("CHANGELOG.md is missing an Unreleased section");
  }
  if (removeEmptyChangelogSubsections(unreleased[1]).trim()) {
    throw new Error("CHANGELOG.md Unreleased section must be empty before tagging");
  }

  const releasePattern = new RegExp(
    `(?:^|\\n)## \\[${escapeRegex(version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\n` +
      `([\\s\\S]*?)(?=\\n## |$)`,
    "g",
  );
  const releases = [...changelog.matchAll(releasePattern)];
  if (releases.length !== 1 || !releases[0][2].trim()) {
    throw new Error(`CHANGELOG.md must contain exactly one non-empty release section for ${tag}`);
  }
  const releaseDate = releases[0][1];
  if (expectedDate && releaseDate !== expectedDate) {
    throw new Error(
      `CHANGELOG.md release date for ${tag} is ${releaseDate}, not ${expectedDate}; ` +
      "update and review the release PR before tagging",
    );
  }
  const expectedBaseline = herdrWebBaselineNote(upstream);
  if (!releases[0][2].includes(expectedBaseline)) {
    throw new Error(
      `CHANGELOG.md release section for ${tag} must record the current Herdr Web baseline`,
    );
  }
  return true;
}
