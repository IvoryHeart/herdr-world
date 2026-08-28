import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  RELEASE_REFERENCE_PATHS,
  assertCurrentReleaseReferences,
  compareReleaseTags,
  normalizeReleaseTag,
  parseReleaseTag,
  releaseVersion,
  readCurrentReleaseTag,
  stampCurrentRelease,
} from "./release-version.mjs";

test("accepts only stable releases and numbered release candidates", () => {
  assert.equal(normalizeReleaseTag("1.2.3"), "v1.2.3");
  assert.equal(normalizeReleaseTag("v1.2.3-rc.4"), "v1.2.3-rc.4");
  assert.equal(releaseVersion("v1.2.3-rc.4"), "1.2.3-rc.4");
  assert.deepEqual(parseReleaseTag("v0.0.0"), {
    major: 0,
    minor: 0,
    patch: 0,
    rc: null,
    tag: "v0.0.0",
  });

  for (const value of [
    "v01.2.3",
    "v1.02.3",
    "v1.2.03",
    "v1.2.3-rc.0",
    "v1.2.3-beta.1",
    "v1.2.3+build.1",
    "v1.2.3-rc.1+build.1",
    "v1.2.3-rc",
  ]) {
    assert.throws(() => normalizeReleaseTag(value), /invalid release tag/);
  }
});

test("compares stable and release-candidate precedence", () => {
  assert.equal(compareReleaseTags("v1.2.3-rc.1", "v1.2.3-rc.2"), -1);
  assert.equal(compareReleaseTags("v1.2.3-rc.9", "v1.2.3"), -1);
  assert.equal(compareReleaseTags("v1.2.4", "v1.2.3"), 1);
  assert.equal(compareReleaseTags("v1.2.3", "1.2.3"), 0);
});

test("repository release references agree with release.json", () => {
  const root = resolve(import.meta.dirname, "..");
  assert.equal(assertCurrentReleaseReferences(root), readCurrentReleaseTag(root));
});

test("stamps every public release reference from one source of truth", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-version-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3-rc.1"}\n');
    writeFileSync(join(root, "README.md"), "v1.2.3-rc.1 twice v1.2.3-rc.1\n");
    writeFileSync(join(root, "site", "index.html"), "<p>v1.2.3-rc.1</p>\n");
    writeFileSync(join(root, "site", "site.js"), 'const version = "v1.2.3-rc.1";\n');

    stampCurrentRelease("v1.2.3-rc.2", root);

    assert.equal(readCurrentReleaseTag(root), "v1.2.3-rc.2");
    for (const relativePath of ["README.md", "site/index.html", "site/site.js"]) {
      const contents = readFileSync(join(root, relativePath), "utf8");
      assert.match(contents, /v1\.2\.3-rc\.2/);
      assert.doesNotMatch(contents, /v1\.2\.3-rc\.1/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when a required public surface has drifted", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-version-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3"}\n');
    writeFileSync(join(root, "README.md"), "v1.2.3\n");
    writeFileSync(join(root, "site", "index.html"), "v1.2.3\n");
    writeFileSync(join(root, "site", "site.js"), "v9.9.9\n");

    assert.throws(
      () => stampCurrentRelease("v1.2.4", root),
      /site\/site\.js does not reference the current release v1\.2\.3/,
    );
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), "v1.2.3\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects reusing a release tag even when public references already match", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-version-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3-rc.1"}\n');
    writeFileSync(join(root, "README.md"), "v1.2.3-rc.1\n");
    writeFileSync(join(root, "site", "index.html"), "v1.2.3-rc.1\n");
    writeFileSync(join(root, "site", "site.js"), "v1.2.3-rc.1\n");

    assert.throws(
      () => stampCurrentRelease("v1.2.3-rc.1", root),
      /release references already point to v1\.2\.3-rc\.1/,
    );

    assert.throws(
      () => stampCurrentRelease("v1.2.3-rc.1", root),
      /release references already point to v1\.2\.3-rc\.1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
