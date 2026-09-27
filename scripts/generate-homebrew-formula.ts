#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readReleaseArchive } from "./release-archive";

export function renderHomebrewFormula(
  version: string,
  digests: Record<string, string>,
) {
  const source = (platform: string) => `
      url "https://github.com/IvoryHeart/herdr-world/releases/download/v${version}/herdr-world-v${version}-${platform}.tar.xz"
      sha256 "${digests[platform]}"`;
  return `class HerdrWorld < Formula
  desc "Visualize Herdr agent work in Office and Graph across local and SSH hosts"
  homepage "https://ivoryheart.github.io/herdr-world/"
  version "${version}"

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

  conflicts_with "herdr-world-rc", because: "both Formulae provide the herdr-world command"

  def install
    package = Dir["herdr-world-*"].find { |path| File.directory?(path) }
    raise "missing Herdr World archive directory" unless package

    libexec.install "#{package}/herdr-world", "#{package}/VERSION",
      "#{package}/LICENSE", "#{package}/THIRD_PARTY_NOTICES.md",
      "#{package}/DEPENDENCY_NOTICES.md", "#{package}/DEPENDENCY_LICENSES.md",
      "#{package}/UPSTREAM.md", "#{package}/LICENSES"
    bin.install_symlink libexec/"herdr-world"
  end

  test do
    assert_match "herdr-world ${version}", shell_output("#{bin}/herdr-world --version")
  end
end
`;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      "usage: bun scripts/generate-homebrew-formula.ts X.Y.Z [dist-dir] [output-file]",
    );
  }
  const distDir = resolve(
    process.argv[3] ?? join(import.meta.dir, "..", "dist"),
  );
  const outputFile = resolve(
    process.argv[4] ?? join(distDir, "herdr-world.rb"),
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
