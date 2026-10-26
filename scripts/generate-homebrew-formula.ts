#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readReleaseArchive } from "./release-archive";
import { isReleaseCandidate, RELEASE_VERSION_RE } from "./release-version";

export function renderHomebrewFormula(
  version: string,
  digests: Record<string, string>,
) {
  const source = (platform: string) => `
      url "https://github.com/IvoryHeart/herdr-world/releases/download/v${version}/herdr-world-v${version}-${platform}.tar.xz"
      sha256 "${digests[platform]}"`;
  const launcher = readFileSync(
    new URL("./homebrew-launcher.sh", import.meta.url),
    "utf8",
  )
    .replace(
      "@HERDR_WORLD_BINARY@",
      '#{(libexec/"herdr-world").to_s.shellescape}',
    )
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `      ${line}` : ""))
    .join("\n");
  const candidate = isReleaseCandidate(version);
  const formulaClass = candidate ? "HerdrWorldRc" : "HerdrWorld";
  const conflict = candidate ? "herdr-world" : "herdr-world-rc";
  return `class ${formulaClass} < Formula
  desc "Visual IDE for AI agents with office, mindmaps and boards"
  homepage "https://herdr.world/"
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

  conflicts_with "${conflict}", because: "both Formulae provide the herdr-world command"

  def install
    libexec.install "herdr-world", "VERSION",
      "LICENSE", "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md", "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md", "LICENSES"
    (bin/"herdr-world").write <<~SH
${launcher}
    SH
    (bin/"herdr-world").chmod 0755
  end

  def caveats
    <<~EOS
      World reuses your existing Herdr. On first launch, if Herdr is missing,
      it installs the verified prebuilt release in ~/.local/bin, outside Homebrew.
      Existing Herdr installations are not upgraded. Add ~/.local/bin to PATH.
      Run herdr-world herdr setup to start Herdr as a user service.
    EOS
  end

  test do
    assert_match "herdr-world ${version}", shell_output("#{bin}/herdr-world --version")
    assert_match "Herdr", shell_output("#{bin}/herdr-world herdr status")
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
