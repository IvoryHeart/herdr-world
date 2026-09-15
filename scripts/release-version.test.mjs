import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  RELEASE_REFERENCE_PATHS,
  assertAndroidReleaseMetadata,
  assertCurrentReleaseReferences,
  assertPublicReleaseCompatibility,
  compareReleaseTags,
  escapeRegex,
  homebrewFormulaName,
  isReleaseCommitSubject,
  npmDistributionTag,
  normalizeReleaseTag,
  parseReleaseTag,
  prepareAndroidReleaseMetadata,
  releaseVersion,
  readCurrentReleaseTag,
  stampCurrentRelease,
  stampPublicReleaseCompatibility,
} from "./release-version.mjs";

const ANDROID_BUILD = `apply plugin: 'com.android.application'

android {
    defaultConfig {
        versionCode 7
        versionName "1.2.2"
    }
}
`;

function releaseReadme(version, details = "") {
  return `${version}${details}\nrequires Herdr \`v0.8.2\` or newer\nwith terminal protocol \`20\`.\n`;
}

function releaseSite(version, details = "") {
  return `${version}${details}\n<div><dt>Herdr</dt><dd>v0.8.2+</dd></div>\n<div><dt>Protocol</dt><dd>20</dd></div>\n<p>Herdr-managed / Herdr 0.8.2+</p>\n`;
}

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

test("stamps Android metadata once in the reviewed release diff", () => {
  const prepared = prepareAndroidReleaseMetadata(ANDROID_BUILD, "v1.2.3-rc.4");

  assert.match(prepared, /versionCode 8\b/);
  assert.match(prepared, /versionName "1\.2\.3-rc\.4"/);
  assert.equal(assertAndroidReleaseMetadata(prepared, "v1.2.3-rc.4"), true);
  assert.equal(prepareAndroidReleaseMetadata(prepared, "v1.2.3-rc.4").match(/versionCode (\d+)/)?.[1], "9");
});

test("stamps and validates the current public Herdr compatibility requirement", () => {
  const readme = "requires Herdr `v0.8.2` or newer\nwith terminal protocol `20`.\n";
  const site = "<div><dt>Herdr</dt><dd>v0.8.2+</dd></div>\n<div><dt>Protocol</dt><dd>20</dd></div>\n<p>Herdr-managed / Herdr 0.8.2+</p>\n";
  const stampedReadme = stampPublicReleaseCompatibility(readme, "README.md");
  const stampedSite = stampPublicReleaseCompatibility(site, "site/index.html");

  assert.equal(
    stampedReadme,
    "requires Herdr `v0.9.0` or newer\nwith terminal protocol `22`.\n",
  );
  assert.equal(
    stampedSite,
    "<div><dt>Herdr</dt><dd>v0.9.0+</dd></div>\n<div><dt>Protocol</dt><dd>22</dd></div>\n<p>Herdr-managed / Herdr 0.9.0+</p>\n",
  );
  assert.throws(
    () => assertPublicReleaseCompatibility({ readme, site }),
    /README\.md advertises Herdr v0\.8\.2 with terminal protocol 20; expected Herdr v0\.9\.0 with terminal protocol 22/,
  );
  assert.equal(
    assertPublicReleaseCompatibility({ readme: stampedReadme, site: stampedSite }),
    true,
  );
  assert.throws(
    () => assertPublicReleaseCompatibility({
      readme: stampedReadme,
      site: stampedSite.replace("Herdr-managed / Herdr 0.9.0+", "Herdr-managed / Herdr 0.8.2+"),
    }),
    /site\/index\.html advertises Herdr v0\.8\.2; expected Herdr v0\.9\.0/,
  );
});

test("rejects Android metadata that no longer matches the reviewed release", () => {
  assert.throws(
    () => assertAndroidReleaseMetadata(ANDROID_BUILD, "v1.2.3"),
    /Android versionName is 1\.2\.2, not 1\.2\.3/,
  );
});

test("rejects ambiguous or exhausted Android release metadata", () => {
  assert.throws(
    () => prepareAndroidReleaseMetadata(ANDROID_BUILD.replace("versionCode 7", "versionCode releaseCode"), "v1.2.3"),
    /exactly one literal versionCode and versionName/,
  );
  assert.throws(
    () => prepareAndroidReleaseMetadata(`${ANDROID_BUILD}\nversionName "duplicate"\n`, "v1.2.3"),
    /exactly one literal versionCode and versionName/,
  );
  assert.throws(
    () => prepareAndroidReleaseMetadata(ANDROID_BUILD.replace("versionCode 7", "versionCode 2100000000"), "v1.2.3"),
    /exceed 2100000000/,
  );
});

test("maps release types to their public install channels", () => {
  assert.equal(npmDistributionTag("v1.2.3-rc.1"), "next");
  assert.equal(npmDistributionTag("v1.2.3"), "latest");
  assert.equal(homebrewFormulaName("v1.2.3-rc.1"), "herdr-world-rc");
  assert.equal(homebrewFormulaName("v1.2.3"), "herdr-world");
});

test("accepts only the reviewed GitHub squash-merged release commit subject", () => {
  assert.equal(isReleaseCommitSubject("Release v1.2.3", "v1.2.3"), false);
  assert.equal(isReleaseCommitSubject("Release v1.2.3-rc.9 (#46)", "v1.2.3-rc.9"), true);
  assert.equal(isReleaseCommitSubject("Release v1.2.3-rc.9 (#)", "v1.2.3-rc.9"), false);
  assert.equal(isReleaseCommitSubject("Release v1.2.3-rc.9 (#46) extra", "v1.2.3-rc.9"), false);
  assert.equal(isReleaseCommitSubject("Release v1.2.4 (#46)", "v1.2.3-rc.9"), false);
});

test("escapes release versions for literal changelog matching", () => {
  const heading = new RegExp(`^## \\[${escapeRegex("1.2.3")}\\] - `, "m");
  assert.match("## [1.2.3] - Release\n", heading);
  assert.doesNotMatch("## [1x2x3] - Release\n", heading);
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
    writeFileSync(join(root, "README.md"), releaseReadme("v1.2.3-rc.1", " twice v1.2.3-rc.1"));
    writeFileSync(join(root, "site", "index.html"), releaseSite("v1.2.3-rc.1"));
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

test("stamps the plugin manifest's intentionally unprefixed version", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-plugin-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3-rc.1"}\n');
    writeFileSync(join(root, "README.md"), releaseReadme("v1.2.3-rc.1"));
    writeFileSync(join(root, "site", "index.html"), releaseSite("v1.2.3-rc.1"));
    writeFileSync(join(root, "site", "site.js"), "v1.2.3-rc.1\n");
    writeFileSync(join(root, "herdr-plugin.toml"), 'version = "1.2.3-rc.1"\n');

    assert.equal(assertCurrentReleaseReferences(root), "v1.2.3-rc.1");
    stampCurrentRelease("v1.2.3-rc.2", root);
    assert.equal(readFileSync(join(root, "herdr-plugin.toml"), "utf8"), 'version = "1.2.3-rc.2"\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("switches public install channels when moving from an RC to stable", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-channels-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3-rc.1"}\n');
    writeFileSync(
      join(root, "README.md"),
      releaseReadme("v1.2.3-rc.1", " @1.2.3-rc.1 @next tap/herdr-world-rc upgrade herdr-world-rc uninstall herdr-world-rc"),
    );
    writeFileSync(
      join(root, "site", "index.html"),
      releaseSite("v1.2.3-rc.1", " @1.2.3-rc.1 @next tap/herdr-world-rc upgrade herdr-world-rc uninstall herdr-world-rc"),
    );
    writeFileSync(
      join(root, "site", "site.js"),
      "v1.2.3-rc.1 @1.2.3-rc.1 @next tap/herdr-world-rc upgrade herdr-world-rc uninstall herdr-world-rc\n",
    );

    stampCurrentRelease("v1.2.3", root);

    for (const relativePath of ["README.md", "site/index.html", "site/site.js"]) {
      const contents = readFileSync(join(root, relativePath), "utf8");
      assert.match(contents, /@1\.2\.3/);
      assert.match(contents, /@latest/);
      assert.match(contents, /tap\/herdr-world/);
      assert.match(contents, /upgrade herdr-world/);
      assert.match(contents, /uninstall herdr-world/);
      assert.doesNotMatch(contents, /@next|herdr-world-rc/);
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
    writeFileSync(join(root, "README.md"), releaseReadme("v1.2.3"));
    writeFileSync(join(root, "site", "index.html"), releaseSite("v1.2.3"));
    writeFileSync(join(root, "site", "site.js"), "v9.9.9\n");

    assert.throws(
      () => stampCurrentRelease("v1.2.4", root),
      /site\/site\.js does not reference the current release v1\.2\.3/,
    );
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), releaseReadme("v1.2.3"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects reusing a release tag even when public references already match", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-release-version-"));
  try {
    mkdirSync(join(root, "site"));
    writeFileSync(join(root, "release.json"), '{"current":"v1.2.3-rc.1"}\n');
    writeFileSync(join(root, "README.md"), releaseReadme("v1.2.3-rc.1"));
    writeFileSync(join(root, "site", "index.html"), releaseSite("v1.2.3-rc.1"));
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
