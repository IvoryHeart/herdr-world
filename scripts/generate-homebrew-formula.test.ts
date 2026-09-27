import { expect, test } from "bun:test";
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
  expect(formula).toContain('libexec/"herdr-world"');
});
