import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPreparedReleaseChangelog,
  herdrWebBaselineNote,
  prepareReleaseChangelog,
} from "./release-changelog.mjs";

const upstream = `# Upstreams

Current synchronization points:

- Herdr Web: \`4384c884da418ea3f3fb75954da5347b2e12f063\`
  (\`v0.5.0\` plus the JetBrains Mono fallback)
`;

const source = `# Changelog

World releases and downstream changes only.

## [Unreleased]

### Breaking Changes

### Added

- Stable feature.

### Changed

### Fixed

- Stable fix.

### Removed

## [0.9.0] - 2026-08-01

- Earlier release.

## Herdr Web 0.1.0 - 2026-06-16

- Upstream release.
`;

test("prepares one reviewed release diff with the next Unreleased section already open", () => {
  const prepared = prepareReleaseChangelog(source, "v1.0.0", "2026-08-31", upstream);

  assert.match(
    prepared,
    /^# Changelog\n\nWorld releases and downstream changes only\.\n\n## \[Unreleased\]/,
  );
  assert.match(prepared, /## \[1\.0\.0\] - 2026-08-31/);
  assert.match(
    prepared,
    /> \*\*Herdr Web baseline:\*\* Derived from v0\.5\.0 plus the JetBrains Mono fallback at\n> \[`4384c884`\]\(https:\/\/github\.com\/kcosr\/herdr-web\/commit\/4384c884da418ea3f3fb75954da5347b2e12f063\)\.\n\n### Added/,
  );
  assert.match(prepared, /### Added\n\n- Stable feature\./);
  assert.match(prepared, /### Fixed\n\n- Stable fix\./);
  assert.doesNotMatch(
    prepared.match(/## \[1\.0\.0\][\s\S]*?(?=\n## |$)/)?.[0] ?? "",
    /Breaking Changes|### Changed|### Removed/,
  );
  assert.equal(
    assertPreparedReleaseChangelog(prepared, "v1.0.0", upstream, "2026-08-31"),
    true,
  );
});

test("formats the exact Herdr Web synchronization point as release provenance", () => {
  assert.equal(
    herdrWebBaselineNote(upstream),
    "> **Herdr Web baseline:** Derived from v0.5.0 plus the JetBrains Mono fallback at\n" +
      "> [`4384c884`](https://github.com/kcosr/herdr-web/commit/4384c884da418ea3f3fb75954da5347b2e12f063).",
  );
  assert.throws(
    () => herdrWebBaselineNote("# Upstreams\n"),
    /missing a parseable Herdr Web synchronization point/,
  );
});

test("rejects empty, duplicate, and post-preparation Unreleased notes", () => {
  assert.throws(
    () => prepareReleaseChangelog(source, "v0.9.0", "2026-08-31", upstream),
    /already contains a release section/,
  );
  assert.throws(
    () => prepareReleaseChangelog(
      source.replace("- Stable feature.", "").replace("- Stable fix.", ""),
      "v1.0.0",
      "2026-08-31",
      upstream,
    ),
    /no release notes/,
  );

  const prepared = prepareReleaseChangelog(source, "v1.0.0", "2026-08-31", upstream);
  assert.throws(
    () => assertPreparedReleaseChangelog(
      prepared.replace("### Added\n\n### Changed", "### Added\n\n- Late change.\n\n### Changed"),
      "v1.0.0",
      upstream,
    ),
    /Unreleased section must be empty/,
  );
  assert.throws(
    () => assertPreparedReleaseChangelog(
      prepared.replace("v0.5.0 plus the JetBrains Mono fallback", "v0.4.2"),
      "v1.0.0",
      upstream,
    ),
    /must record the current Herdr Web baseline/,
  );
  assert.throws(
    () => assertPreparedReleaseChangelog(prepared, "v1.0.0", upstream, "2026-09-01"),
    /release date for v1\.0\.0 is 2026-08-31, not 2026-09-01/,
  );
});
