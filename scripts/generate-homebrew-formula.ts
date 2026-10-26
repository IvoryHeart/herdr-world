#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { VERIFIED_HERDR_VERSION } from "../server/src/herdr/release";
import { readReleaseArchive } from "./release-archive";
import { isReleaseCandidate, RELEASE_VERSION_RE } from "./release-version";

export function renderHomebrewFormula(
  version: string,
  digests: Record<string, string>,
) {
  const source = (platform: string) => `
      url "https://github.com/IvoryHeart/herdr-world/releases/download/v${version}/herdr-world-v${version}-${platform}.tar.xz"
      sha256 "${digests[platform]}"`;
  const candidate = isReleaseCandidate(version);
  const formulaClass = candidate ? "HerdrWorldRc" : "HerdrWorld";
  const conflict = candidate ? "herdr-world" : "herdr-world-rc";
  return `class ${formulaClass} < Formula
  desc "Visual IDE for AI agents with office, mindmaps and boards"
  homepage "https://herdr.world/"
  version "${version}"

  # Herdr retains its own Homebrew owner, including on Intel Macs where
  # Homebrew may build it from source instead of pouring a bottle.
  depends_on "herdr"

  on_macos do
    on_arm do${source("darwin-arm64")}
    end
    on_intel do${source("darwin-x64")}
    end
  end

  on_linux do
    on_arm do${source("linux-arm64")}
    end
    on_intel do${source("linux-x64")}
    end
  end

  conflicts_with "${conflict}", because: "both Formulae provide the herdr-world command"

  def install
    herdr_output = Utils.safe_popen_read(Formula["herdr"].opt_bin/"herdr", "--version")
    herdr_version = herdr_output[/^herdr ([0-9]+[.][0-9]+[.][0-9]+)/, 1]
    if herdr_version.nil? || Version.new(herdr_version) < Version.new("${VERIFIED_HERDR_VERSION}")
      odie "Herdr ${VERIFIED_HERDR_VERSION} or newer is required; run brew update && brew upgrade herdr, then retry."
    end
    libexec.install "herdr-world", "VERSION",
      "LICENSE", "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md", "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md", "LICENSES"
    bin.install_symlink libexec/"herdr-world"
  end

  test do
    assert_match "herdr-world ${version}", shell_output("#{bin}/herdr-world --version")
    herdr_output = shell_output("#{Formula["herdr"].opt_bin}/herdr --version")
    assert_match /^herdr /, herdr_output
    assert_operator Version.new(herdr_output[/[0-9]+[.][0-9]+[.][0-9]+/]), :>=,
                    Version.new("${VERIFIED_HERDR_VERSION}")
  end
end
`;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !RELEASE_VERSION_RE.test(version)) {
    throw new Error(
      "usage: bun scripts/generate-homebrew-formula.ts X.Y.Z[-rc.N] [dist-dir] [output-file]",
    );
  }
  const distDir = resolve(
    process.argv[3] ?? join(import.meta.dir, "..", "dist"),
  );
  const outputFile = resolve(
    process.argv[4] ??
      join(
        distDir,
        isReleaseCandidate(version) ? "herdr-world-rc.rb" : "herdr-world.rb",
      ),
  );
  const digests = Object.fromEntries(
    ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map(
      (platform) => [
        platform,
        readReleaseArchive(distDir, version, platform).digest,
      ],
    ),
  );
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, renderHomebrewFormula(version, digests));
  console.log(`Generated ${outputFile}`);
}
