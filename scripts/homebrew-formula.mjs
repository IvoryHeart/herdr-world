#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeReleaseTag } from "./release-version.mjs";

const RELEASE_ARCHIVE_TAG_PATTERN =
  /https:\/\/github\.com\/IvoryHeart\/herdr-world\/releases\/download\/(v[^/"\s]+)\//g;

export function homebrewFormulaName(tag) {
  return normalizeReleaseTag(tag).includes("-rc.") ? "herdr-world-rc" : "herdr-world";
}

export function homebrewFormulaReleaseTag(formula) {
  if (typeof formula !== "string") {
    throw new Error("Homebrew Formula contents must be a string");
  }
  const tags = new Set(
    [...formula.matchAll(RELEASE_ARCHIVE_TAG_PATTERN)].map((match) =>
      normalizeReleaseTag(match[1]),
    ),
  );
  if (tags.size === 0) {
    throw new Error("Homebrew Formula has no parseable Herdr World release URL");
  }
  if (tags.size !== 1) {
    throw new Error("Homebrew Formula release URLs do not use one version");
  }
  return [...tags][0];
}

function archiveUrl(tag, platform) {
  const normalizedTag = normalizeReleaseTag(tag);
  return `https://github.com/IvoryHeart/herdr-world/releases/download/${normalizedTag}/herdr-world-${normalizedTag}-${platform}.tar.gz`;
}

export function renderHomebrewFormula({ tag, checksums }) {
  const normalizedTag = normalizeReleaseTag(tag);
  const formulaName = homebrewFormulaName(normalizedTag);
  const className = formulaName
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  const otherFormula = formulaName === "herdr-world" ? "herdr-world-rc" : "herdr-world";
  const checksum = (platform) => {
    const value = checksums?.[platform];
    if (!/^[a-f0-9]{64}$/.test(value ?? "")) {
      throw new Error(`missing SHA-256 for Homebrew target ${platform}`);
    }
    return value;
  };

  return `class ${className} < Formula
  desc "Browser and mobile client for monitoring and controlling Herdr agents"
  homepage "https://ivoryheart.github.io/herdr-world/"

  on_macos do
    on_arm do
      url "${archiveUrl(normalizedTag, "macos-arm64")}"
      sha256 "${checksum("macos-arm64")}"
    end
    on_intel do
      url "${archiveUrl(normalizedTag, "macos-x86_64")}"
      sha256 "${checksum("macos-x86_64")}"
    end
  end

  on_linux do
    on_intel do
      url "${archiveUrl(normalizedTag, "linux-x86_64")}"
      sha256 "${checksum("linux-x86_64")}"
    end
  end

  conflicts_with "${otherFormula}", because: "both Formulae provide the herdr-world command"

  def install
    libexec.install "VERSION", "bin", "share", "docs", "vendor",
      "third_party", "LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.md",
      "README.md", "install"
    bin.install_symlink libexec/"bin/herdr-world"
  end

  test do
    system bin/"herdr-world", "--help"
  end
end
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, checksumsPath, outputPath] = process.argv.slice(2);
  if (!tag || !checksumsPath || !outputPath) {
    console.error("Usage: node scripts/homebrew-formula.mjs TAG CHECKSUMS_JSON OUTPUT_RB");
    process.exit(2);
  }
  try {
    const formula = renderHomebrewFormula({
      tag,
      checksums: JSON.parse(readFileSync(checksumsPath, "utf8")),
    });
    writeFileSync(outputPath, formula);
    console.log(`Generated ${homebrewFormulaName(tag)} at ${outputPath}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
