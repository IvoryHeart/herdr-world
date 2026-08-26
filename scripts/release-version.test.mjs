import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertCurrentReleaseReferences,
  readCurrentReleaseTag,
  stampCurrentRelease,
} from "./release-version.mjs";

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
