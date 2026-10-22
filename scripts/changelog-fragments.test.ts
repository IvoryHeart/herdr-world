import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleChangelog,
  assembleFragments,
  assessPullRequest,
  parseFragment,
  readFragments,
} from "./changelog-fragments";
import { promoteChangelog } from "./prepare-release";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Added

- Existing addition.

### Fixed

- Existing fix
  with a continuation line.

## [0.1.0] - 2026-01-01

### Added

- Released entry.
`;

test("a fragment is one or more known headings followed by bullets", () => {
  expect(
    parseFragment(
      "262.md",
      "### Fixed\n\n- Repair a thing\n  across two lines.\n- Another fix.\n\n### Added\n\n- New thing.\n",
    ).sections,
  ).toEqual([
    {
      heading: "Fixed",
      body: "- Repair a thing\n  across two lines.\n- Another fix.",
    },
    { heading: "Added", body: "- New thing." },
  ]);
  const bad: Array<[string, string, RegExp]> = [
    ["empty.md", "\n", /no entries/],
    ["no-heading.md", "- Loose bullet.\n", /start with/],
    ["unknown.md", "### Improved\n\n- Thing.\n", /heading must be one of/],
    ["level.md", "## Added\n\n- Thing.\n", /heading must be one of/],
    ["twice.md", "### Added\n\n- A.\n\n### Added\n\n- B.\n", /appears twice/],
    ["bare.md", "### Added\n\nProse instead of a bullet.\n", /bullets/],
    ["hollow.md", "### Added\n\n### Fixed\n\n- B.\n", /has no entries/],
    ["Upper.md", "### Added\n\n- A.\n", /name must be/],
  ];
  for (const [name, text, error] of bad) {
    expect(() => parseFragment(name, text)).toThrow(error);
  }
});

test("assembly appends to existing headings and adds missing ones in order", () => {
  const fragments = [
    parseFragment("10.md", "### Changed\n\n- Ten changed.\n"),
    parseFragment(
      "9.md",
      "### Fixed\n\n- Nine fixed.\n\n### Added\n\n- Nine added.\n",
    ),
  ];
  expect(assembleChangelog(CHANGELOG, fragments)).toBe(`# Changelog

Intro.

## [Unreleased]

### Added

- Existing addition.
- Nine added.

### Changed

- Ten changed.

### Fixed

- Existing fix
  with a continuation line.
- Nine fixed.

## [0.1.0] - 2026-01-01

### Added

- Released entry.
`);
  expect(assembleChangelog(CHANGELOG, [])).toBe(CHANGELOG);
});

test("assembly into an empty Unreleased section can be promoted", () => {
  const empty = CHANGELOG.replace(
    /## \[Unreleased\][\s\S]*?(?=## \[0\.1\.0\])/u,
    "## [Unreleased]\n\n",
  );
  const assembled = assembleChangelog(empty, [
    parseFragment("fix.md", "### Fixed\n\n- Only fix.\n"),
  ]);
  expect(assembled).toContain(
    "## [Unreleased]\n\n### Fixed\n\n- Only fix.\n\n## [0.1.0]",
  );
  expect(promoteChangelog(assembled, "0.2.0", "2026-02-02")).toContain(
    "## [Unreleased]\n\n## [0.2.0] - 2026-02-02\n\n### Fixed\n\n- Only fix.\n\n## [0.1.0]",
  );
});

test("the repository changelog and fragments are well formed", () => {
  const root = join(import.meta.dir, "..");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  expect(assembleChangelog(changelog, [])).toBe(changelog);
  expect(() => readFragments(root)).not.toThrow();
});

test("assembling writes CHANGELOG.md, deletes fragments and keeps the README", () => {
  const root = mkdtempSync(join(tmpdir(), "changelog-fragments-"));
  roots.push(root);
  mkdirSync(join(root, "changes"));
  writeFileSync(join(root, "CHANGELOG.md"), CHANGELOG);
  writeFileSync(
    join(root, "changes/README.md"),
    "# Changes\n\nNot a fragment.\n",
  );
  writeFileSync(join(root, "changes/2.md"), "### Added\n\n- Two.\n");
  writeFileSync(join(root, "changes/11.md"), "### Added\n\n- Eleven.\n");
  expect(assembleFragments(root)).toEqual(["2.md", "11.md"]);
  expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toContain(
    "- Existing addition.\n- Two.\n- Eleven.\n\n### Fixed",
  );
  expect(existsSync(join(root, "changes/2.md"))).toBe(false);
  expect(existsSync(join(root, "changes/11.md"))).toBe(false);
  expect(existsSync(join(root, "changes/README.md"))).toBe(true);
  expect(assembleFragments(root)).toEqual([]);
});

test("a code PR needs a fragment or a stated reason; docs-only PRs do not", () => {
  const code = ["server/src/index.ts", "README.md"];
  const none = new Set<string>();
  expect(assessPullRequest(code, none, null).ok).toBe(false);
  expect(
    assessPullRequest(
      [...code, "changes/262.md"],
      new Set(["changes/262.md"]),
      null,
    ),
  ).toMatchObject({ ok: true, fragments: ["changes/262.md"] });
  // Deleting a fragment or editing the README does not count as an entry.
  expect(assessPullRequest([...code, "changes/262.md"], none, null).ok).toBe(
    false,
  );
  expect(
    assessPullRequest(
      [...code, "changes/README.md"],
      new Set(["changes/README.md"]),
      null,
    ).ok,
  ).toBe(false);
  expect(
    assessPullRequest(
      code,
      none,
      "- Changelog: none — contributor tooling only; no user-visible behaviour.",
    ),
  ).toMatchObject({
    ok: true,
    reason: "contributor tooling only; no user-visible behaviour.",
  });
  expect(assessPullRequest(code, none, "Changelog: none — <reason>").ok).toBe(
    false,
  );
  expect(assessPullRequest(code, none, "Changelog: none — n/a").ok).toBe(false);
  // Workflow and agent guidance are not documentation-only.
  expect(assessPullRequest(["AGENTS.md"], none, null).ok).toBe(false);
  expect(
    assessPullRequest(["docs/release.md", "README.md"], none, null).ok,
  ).toBe(true);
  expect(
    assessPullRequest(["changes/262.md"], new Set(["changes/262.md"]), null).ok,
  ).toBe(true);
});
