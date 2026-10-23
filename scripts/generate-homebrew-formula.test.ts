import { expect, test } from "bun:test";
import {
  VERIFIED_HERDR_SHA256,
  VERIFIED_HERDR_VERSION,
} from "../server/src/herdr/release";
import { renderHomebrewFormula } from "./generate-homebrew-formula";

test("Homebrew Formula uses each platform's verified archive digest", () => {
  const digests = {
    "darwin-arm64": "a".repeat(64),
    "darwin-x64": "b".repeat(64),
    "linux-arm64": "c".repeat(64),
    "linux-x64": "d".repeat(64),
  };
  const formula = renderHomebrewFormula("0.2.0", digests);
  for (const [platform, digest] of Object.entries(digests)) {
    expect(formula).toContain(
      `herdr-world-v0.2.0-${platform}.tar.xz"\n      sha256 "${digest}"`,
    );
  }
  expect(formula).toContain('version "0.2.0"');
  expect(formula).toContain('homepage "https://herdr.world/"');
  expect(formula).toContain('libexec.install "herdr-world", "VERSION"');
  expect(formula).not.toContain('Dir["herdr-world-*"]');
  expect(formula).toContain('libexec/"herdr-world"');
  // Bottled platforms depend on Homebrew's herdr; Intel Macs, which have no
  // bottle, install World's verified prebuilt Herdr instead of building it.
  const block = (start: string, end: string) =>
    formula.slice(formula.indexOf(start), formula.indexOf(end));
  const macArm = block("on_macos do\n    on_arm do", "on_intel do");
  const macIntel = block("    on_intel do", "on_linux do");
  const linux = block("on_linux do", "conflicts_with");
  expect(macArm).toContain('depends_on "herdr"');
  expect(linux).toContain('depends_on "herdr"');
  expect(macIntel).not.toContain("depends_on");
  expect(macIntel).toContain(
    `url "https://github.com/herdrdev/herdr/releases/download/v${VERIFIED_HERDR_VERSION}/herdr-macos-x86_64"`,
  );
  expect(macIntel).toContain(
    `sha256 "${VERIFIED_HERDR_SHA256["macos-x86_64"]}"`,
  );
  expect(formula).toContain(
    "install_prebuilt_herdr if OS.mac? && Hardware::CPU.intel?",
  );
  expect(formula).toContain('bin.install_symlink libexec/"herdr/herdr"');
});

test("Homebrew RC Formula uses the separate candidate identity", () => {
  const digests = {
    "darwin-arm64": "a".repeat(64),
    "darwin-x64": "b".repeat(64),
    "linux-arm64": "c".repeat(64),
    "linux-x64": "d".repeat(64),
  };
  const formula = renderHomebrewFormula("0.2.0-rc.1", digests);
  expect(formula).toContain("class HerdrWorldRc < Formula");
  expect(formula).toContain('conflicts_with "herdr-world"');
  expect(formula).toContain("herdr-world-v0.2.0-rc.1-linux-x64.tar.xz");
});
