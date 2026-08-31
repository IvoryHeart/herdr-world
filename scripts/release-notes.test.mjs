import assert from "node:assert/strict";
import { test } from "node:test";

import { extractReleaseNotes } from "./release-notes.mjs";

test("extractReleaseNotes returns only the requested release section", () => {
  const changelog = `# Changelog

## [Unreleased]

### Added

- Future work.

## [0.1.0-rc.2] - 2026-08-29

### Added

- Release work.

## [0.1.0-rc.1] - 2026-08-26

### Fixed

- Earlier work.
`;

  assert.equal(
    extractReleaseNotes(changelog, "v0.1.0-rc.2"),
    "### Added\n\n- Release work.",
  );
});

test("extractReleaseNotes rejects a missing release section", () => {
  assert.throws(
    () => extractReleaseNotes("# Changelog\n", "v0.1.0-rc.2"),
    /has no release notes/,
  );
});

test("extractReleaseNotes stops before any following level-two section", () => {
  const changelog = `# Changelog

## [1.0.0] - 2026-08-31

- World release.

## Appendix

- Supporting information.
`;

  assert.equal(extractReleaseNotes(changelog, "v1.0.0"), "- World release.");
});
