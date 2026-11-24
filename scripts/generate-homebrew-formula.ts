#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderHerdrBootstrap } from "./herdr-bootstrap";
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
    .replace("@HERDR_BOOTSTRAP@", renderHerdrBootstrap())
    // A Ruby heredoc reads backslash escapes and #{...}/#$/#@ interpolation.
    .replaceAll("\\", "\\\\")
    .replace(/#(?=[{$@])/g, "\\#")
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

  post_install_steps do
    run "herdr-world", args: ["update", "--finish-install"], base: :libexec,
      env: { "HERDR_WORLD_SKIP_HERDR" => "1", "HERDR_WORLD_SKIP_INTEGRATIONS" => "1" }
  end

  def caveats
    <<~EOS
      World uses the herdr-core or Herdr you already have. When it starts and
      neither is installed, it installs herdr-core from its official release
      into ~/.local/bin, outside Homebrew, and starts it now and at each login.
      Installed runtimes are never replaced or upgraded. If automatic setup
      fails, World still starts. Retry with herdr-world herdr upgrade --install,
      or set HERDR_WORLD_SKIP_HERDR=1 to skip it.
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
