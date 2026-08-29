import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPublication,
  channelForRelease,
  versionForRelease,
} from "./release-publication.mjs";

test("maps release identities to npm channels", () => {
  assert.equal(channelForRelease("v1.2.3-rc.4"), "next");
  assert.equal(channelForRelease("v1.2.3"), "latest");
  assert.equal(versionForRelease("v1.2.3-rc.4"), "1.2.3-rc.4");
});

test("publishes an absent version", () => {
  assert.deepEqual(
    assessPublication({ candidate: "v1.2.3", currentVersion: "v1.2.2" }),
    { action: "publish", version: "v1.2.3" },
  );
});
test("rejects a lower candidate before mutation", () => {
  assert.match(
    assessPublication({ candidate: "v1.2.2", currentVersion: "v1.2.3" }).reason,
    /lower than target-channel version/,
  );
});

test("recognizes an exact-content retry as complete", () => {
  assert.deepEqual(
    assessPublication({
      candidate: "v1.2.3-rc.2",
      currentVersion: "v1.2.3-rc.2",
      exactVersionExists: true,
      exactDigestMatches: true,
      pointerVersion: "v1.2.3-rc.2",
    }),
    { action: "complete", version: "v1.2.3-rc.2" },
  );
});

test("rejects same-version content replacement", () => {
  assert.match(
    assessPublication({
      candidate: "v1.2.3-rc.2",
      exactVersionExists: true,
      exactDigestMatches: false,
    }).reason,
    /different content/,
  );
});

test("allows an exact-content retry to repair an older moving pointer", () => {
  assert.deepEqual(
    assessPublication({
      candidate: "v1.2.3",
      currentVersion: "v1.2.2",
      exactVersionExists: true,
      exactDigestMatches: true,
      pointerVersion: "v1.2.2",
    }),
    { action: "update-pointer", version: "v1.2.3" },
  );
});
