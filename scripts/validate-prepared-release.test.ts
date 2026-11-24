import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePreparedRelease } from "./validate-prepared-release";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(version = "0.4.2") {
  const root = mkdtempSync(join(tmpdir(), "prepared-release-"));
  roots.push(root);
  const write = (file: string, text: string) =>
    writeFileSync(join(root, file), text);
  for (const directory of ["web", "server", "changes", "docs/releases"])
    mkdirSync(join(root, directory), { recursive: true });
  for (const file of [
    "package.json",
    "web/package.json",
    "server/package.json",
  ])
    write(file, '{"version":"0.0.0"}\n');
  write("herdr-plugin.toml", `version = "${version}"\n`);
  write(
    `docs/releases/v${version}.md`,
    `# Herdr World ${version}\n\nReviewed upgrade steps and limits.\n`,
  );
  write(
    "CHANGELOG.md",
    `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-11-24\n\n### Fixed\n\n- A release fix.\n\n## [0.4.1] - 2026-11-20\n`,
  );
  return { root, write };
}

describe("prepared release files", () => {
  test("accepts a promoted stable changelog and private development versions", () => {
    expect(() =>
      validatePreparedRelease(fixture().root, "0.4.2"),
    ).not.toThrow();
  });

  test("rejects a malformed or mismatched public version", () => {
    const { root } = fixture();
    expect(() => validatePreparedRelease(root, "patch")).toThrow(
      "Invalid release version",
    );
    expect(() => validatePreparedRelease(root, "0.4.3")).toThrow(
      "expected 0.4.3",
    );
  });

  test.each(["package.json", "web/package.json", "server/package.json"])(
    "rejects a changed private version in %s",
    (file) => {
      const { root, write } = fixture();
      write(file, '{"version":"0.4.2"}');
      expect(() => validatePreparedRelease(root, "0.4.2")).toThrow(file);
    },
  );

  test("rejects missing release notes", () => {
    const { root } = fixture();
    rmSync(join(root, "docs/releases/v0.4.2.md"));
    expect(() => validatePreparedRelease(root, "0.4.2")).toThrow(
      "Missing release notes",
    );
  });

  test.each([
    "",
    "Some prose",
    "# Herdr World 0.4.1\n\nOld notes.",
    "# Herdr World 0.4.2\n\n",
  ])("rejects empty, malformed or incorrectly versioned notes: %j", (notes) => {
    const { root, write } = fixture();
    write("docs/releases/v0.4.2.md", notes);
    expect(() => validatePreparedRelease(root, "0.4.2")).toThrow(
      "release notes",
    );
  });

  test.each([
    "# Changelog\n",
    "## [Unreleased]\n\n### Fixed\n\n- Not promoted.\n",
    "## [Unreleased]\n\n## [0.4.1] - 2026-11-24\n\n### Fixed\n\n- Wrong version.\n",
    "## [Unreleased]\n\n## [0.4.2] - 2026-02-30\n\n### Fixed\n\n- Invalid date.\n",
    "## [Unreleased]\n\n## [0.4.2] - 2026-99-99\n\n### Fixed\n\n- Invalid date.\n",
    "## [Unreleased]\n\n## [0.4.2] - 2026-11-24\n",
  ])(
    "rejects an unpromoted, malformed or empty stable changelog: %j",
    (changelog) => {
      const { root, write } = fixture();
      write("CHANGELOG.md", changelog);
      expect(() => validatePreparedRelease(root, "0.4.2")).toThrow(
        "CHANGELOG.md",
      );
    },
  );

  test("stable preparation must consume every fragment", () => {
    const { root, write } = fixture();
    write("changes/fix.md", "### Fixed\n\n- Unconsumed fix.\n");
    expect(() => validatePreparedRelease(root, "0.4.2")).toThrow("unconsumed");
  });

  test("RCs keep Unreleased and valid fragments open", () => {
    const { root, write } = fixture("0.4.2-rc.1");
    write("CHANGELOG.md", "## [Unreleased]\n\n## [0.4.1] - 2026-11-20\n");
    write("changes/fix.md", "### Fixed\n\n- A pending fix.\n");
    write(
      "docs/releases/v0.4.2-rc.1.md",
      "# Herdr World 0.4.2-rc.1 release candidate\n\nCheck this candidate.\n",
    );
    expect(() => validatePreparedRelease(root, "0.4.2-rc.1")).not.toThrow();
    write("changes/fix.md", "Malformed fragment\n");
    expect(() => validatePreparedRelease(root, "0.4.2-rc.1")).toThrow(
      "changes/fix.md",
    );
  });
});
