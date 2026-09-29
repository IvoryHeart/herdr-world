#!/usr/bin/env bash
set -euo pipefail

asset_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
platform="${HERDR_WORLD_PREVIEW_PLATFORM:-}"
if [[ -z "$platform" ]]; then
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Run this preview installer on macOS" >&2
    exit 2
  fi
  case "$(uname -m)" in
    arm64) platform="darwin-arm64" ;;
    x86_64) platform="darwin-x64" ;;
    *) echo "Unsupported macOS architecture" >&2; exit 2 ;;
  esac
fi
case "$platform" in
  darwin-arm64|darwin-x64) ;;
  *) echo "Invalid preview platform: $platform" >&2; exit 2 ;;
esac

archives=("$asset_dir"/herdr-world-v0.0.0-rc.*-"$platform".tar.xz)
if [[ ${#archives[@]} -ne 1 || ! -f "${archives[0]}" ]]; then
  echo "Expected exactly one $platform preview archive beside this script" >&2
  exit 1
fi
archive="${archives[0]}"
name="$(basename "$archive")"
version="${name#herdr-world-v}"
version="${version%-$platform.tar.xz}"
if [[ ! "$version" =~ ^0\.0\.0-rc\.[1-9][0-9]*$ ]]; then
  echo "Invalid preview version: $version" >&2
  exit 1
fi

for target in darwin-arm64 darwin-x64; do
  expected="$asset_dir/herdr-world-v$version-$target.tar.xz"
  if [[ ! -f "$expected" || ! -f "$expected.sha256" ]]; then
    echo "Missing $target preview archive or checksum" >&2
    exit 1
  fi
  (cd "$asset_dir" && shasum -a 256 -c "$(basename "$expected.sha256")")
done

archive_url="$(ruby -ruri -e 'print URI::DEFAULT_PARSER.escape("file://" + ARGV.fetch(0))' "$archive")"
digest="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
formula="$asset_dir/herdr-world-preview.rb"
cat > "$formula" <<EOF
class HerdrWorldPreview < Formula
  desc "Visualize and control your agents in Office and Graph across multiple hosts"
  homepage "https://ivoryheart.github.io/herdr-world/"
  version "$version"
  url "$archive_url"
  sha256 "$digest"

  def install
    libexec.install "herdr-world", "VERSION",
      "LICENSE", "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md", "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md", "LICENSES"
    bin.install_symlink libexec/"herdr-world"
  end

  test do
    assert_match "herdr-world $version", shell_output("#{bin}/herdr-world --version")
  end
end
EOF

if [[ "${1:-}" == "--prepare-only" ]]; then
  echo "Prepared $formula"
  exit 0
fi
command -v brew >/dev/null || { echo "Homebrew is required" >&2; exit 1; }
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
tap="herdrworld/preview"
formula_name="$tap/herdr-world-preview"
if ! brew tap | grep -Fxq "$tap"; then
  brew tap-new --no-git "$tap"
fi
tap_directory="$(brew --repository "$tap")"
install -m 0644 "$formula" "$tap_directory/Formula/herdr-world-preview.rb"
if brew list --versions herdr-world-preview | grep -q .; then
  brew reinstall --formula "$formula_name"
else
  brew install --formula "$formula_name"
fi
brew test "$formula_name"
brew list --versions herdr-world-preview
