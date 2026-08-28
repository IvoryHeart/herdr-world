import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  parseGlibcVersion,
  selectBridge,
} from "./npm-launcher.mjs";

test("selects the supported bridge for each release target", () => {
  assert.equal(
    selectBridge({ platform: "linux", arch: "x64", report: { getReport: () => ({ header: { glibcVersionRuntime: "2.34" } }) } }),
    "linux-x64",
  );
  assert.equal(selectBridge({ platform: "darwin", arch: "arm64" }), "macos-arm64");
  assert.equal(selectBridge({ platform: "darwin", arch: "x64" }), "macos-x64");
});

test("rejects unsupported libc and host combinations before execution", () => {
  assert.throws(
    () => selectBridge({ platform: "linux", arch: "x64", report: { getReport: () => ({ header: {} }) } }),
    /glibc runtime/,
  );
  assert.throws(
    () => selectBridge({ platform: "linux", arch: "x64", report: { getReport: () => ({ header: { glibcVersionRuntime: "2.33" } }) } }),
    /requires glibc 2\.34/,
  );
  assert.throws(
    () => selectBridge({ platform: "linux", arch: "arm64" }),
    /does not support this platform/,
  );
  assert.deepEqual(parseGlibcVersion("2.34"), { major: 2, minor: 34 });
  assert.equal(parseGlibcVersion("musl"), null);
});

test("help succeeds without starting a bridge process", () => {
  const output = execFileSync(process.execPath, ["scripts/npm-launcher.mjs", "--help"], {
    encoding: "utf8",
  });
  assert.match(output, /Usage: herdr-world/);
});
