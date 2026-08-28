import assert from "node:assert/strict";
import test from "node:test";

import {
  homebrewFormulaName,
  renderHomebrewFormula,
} from "./homebrew-formula.mjs";

const checksums = {
  "linux-x86_64": "1".repeat(64),
  "macos-arm64": "2".repeat(64),
  "macos-x86_64": "3".repeat(64),
};

test("generates the stable Formula from exact release archives", () => {
  const formula = renderHomebrewFormula({ tag: "v1.2.3", checksums });
  assert.equal(homebrewFormulaName("v1.2.3"), "herdr-world");
  assert.match(formula, /class HerdrWorld < Formula/);
  assert.match(formula, /version "1\.2\.3"/);
  assert.match(formula, /herdr-world-v1\.2\.3-linux-x86_64\.tar\.gz/);
  assert.match(formula, /sha256 "111111/);
  assert.match(formula, /conflicts_with "herdr-world-rc"/);
  assert.match(formula, /libexec\.install "VERSION", "bin", "share"/);
  assert.doesNotMatch(formula, /herdr-world-installer/);
});
test("generates the RC Formula without advancing stable", () => {
  const formula = renderHomebrewFormula({ tag: "v1.2.3-rc.2", checksums });
  assert.equal(homebrewFormulaName("v1.2.3-rc.2"), "herdr-world-rc");
  assert.match(formula, /class HerdrWorldRc < Formula/);
  assert.match(formula, /version "1\.2\.3-rc\.2"/);
  assert.match(formula, /conflicts_with "herdr-world"/);
});

test("requires every native archive checksum", () => {
  assert.throws(
    () => renderHomebrewFormula({ tag: "v1.2.3", checksums: {} }),
    /missing SHA-256 for Homebrew target macos-arm64/,
  );
});
