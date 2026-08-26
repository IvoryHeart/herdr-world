import assert from "node:assert/strict";
import test from "node:test";

import {
  RELEASE_REPOSITORY,
  assertReleaseRemoteUrls,
  githubRepositoryFromRemoteUrl,
  releaseCreateArgs,
  withReleaseRepository,
} from "./release-target.mjs";

test("recognizes canonical Herdr World GitHub remote forms", () => {
  assert.equal(
    githubRepositoryFromRemoteUrl("git@github.com:IvoryHeart/herdr-world.git"),
    RELEASE_REPOSITORY,
  );
  assert.equal(
    githubRepositoryFromRemoteUrl("ssh://git@github.com/IvoryHeart/herdr-world.git"),
    RELEASE_REPOSITORY,
  );
  assert.equal(
    githubRepositoryFromRemoteUrl("https://github.com/IvoryHeart/herdr-world.git"),
    RELEASE_REPOSITORY,
  );
});

test("rejects an upstream or unsupported release remote", () => {
  assert.throws(
    () => assertReleaseRemoteUrls(["git@github.com:kcosr/herdr-web.git"], "push"),
    /must resolve to IvoryHeart\/herdr-world; resolved kcosr\/herdr-web/,
  );
  assert.throws(
    () => assertReleaseRemoteUrls(["/tmp/not-a-github-repository"], "fetch"),
    /unsupported or non-GitHub remote/,
  );
});

test("requires every configured URL to resolve to Herdr World", () => {
  assert.doesNotThrow(() =>
    assertReleaseRemoteUrls(
      [
        "git@github.com:IvoryHeart/herdr-world.git",
        "https://github.com/IvoryHeart/herdr-world.git",
      ],
      "push",
    ),
  );
  assert.throws(
    () =>
      assertReleaseRemoteUrls(
        [
          "git@github.com:IvoryHeart/herdr-world.git",
          "git@github.com:kcosr/herdr-web.git",
        ],
        "push",
      ),
    /resolved kcosr\/herdr-web/,
  );
});

test("adds an explicit repository to GitHub CLI release commands", () => {
  assert.deepEqual(withReleaseRepository(["release", "view", "v1.2.3"]), [
    "release",
    "view",
    "v1.2.3",
    "--repo",
    "IvoryHeart/herdr-world",
  ]);
});

test("marks release-candidate GitHub releases as prereleases", () => {
  assert.deepEqual(releaseCreateArgs("v0.1.0-rc.3", "notes.md"), [
    "release",
    "create",
    "v0.1.0-rc.3",
    "--verify-tag",
    "--notes-file",
    "notes.md",
    "--prerelease",
    "--repo",
    "IvoryHeart/herdr-world",
  ]);
});

test("leaves stable GitHub releases stable", () => {
  assert.deepEqual(releaseCreateArgs("v0.1.0", "notes.md"), [
    "release",
    "create",
    "v0.1.0",
    "--verify-tag",
    "--notes-file",
    "notes.md",
    "--repo",
    "IvoryHeart/herdr-world",
  ]);
});
