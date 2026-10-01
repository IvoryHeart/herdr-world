# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

## Pre-merge platform previews

Add the `release-preview` label to a release preparation PR. Its CI run first
checks the branch, then builds six downloadable `preview-<platform>` artifacts
and a `preview-npm` artifact assembled from those same archives.
For a pre-merge Homebrew installation on macOS, CI also bundles both Mac archives,
checksums and a local Formula installer as `preview-homebrew`.
Each native artifact contains a `.tar.xz` archive and `.sha256` file for that exact PR
head. Download artifacts from the successful CI run's **Artifacts** section and
verify the checksum before extracting. The binary identifies itself as
`0.0.0-rc.<CI run number>` so it cannot be mistaken for a published release.
With GitHub CLI, use `gh run download RUN_ID -n preview-linux-x64` (substitute
the desired platform).
These previews have no GitHub release, npm version, Homebrew Formula, or update
channel. Run the binary on its target OS and architecture with a test Herdr
server, then exercise local/SSH connection selection, Office, Tree, Graph,
Spaces, terminal and file flows, and the PWA where reachable. Retest the final
RC from its published tag after its reviewed PR merges.

On Linux or macOS, check and extract the archive with:

```bash
sha256sum -c herdr-world-v0.0.0-rc.N-PLATFORM.tar.xz.sha256
tar -xJf herdr-world-v0.0.0-rc.N-PLATFORM.tar.xz
./herdr-world-PLATFORM/herdr-world --version
```

On macOS, use `shasum -a 256 -c` if `sha256sum` is unavailable. On Windows,
compare the digest with `Get-FileHash -Algorithm SHA256`, extract the archive
with `tar -xJf`, and run `herdr-world.exe --version` from its extracted folder.
To test the npm launcher locally, extract `preview-npm` and install its launcher
tarball plus the one matching platform tarball into an isolated directory:

```bash
npm install --offline --ignore-scripts --prefix ./world-preview \
  ./ivoryheart-herdr-world-PLATFORM-0.0.0-rc.N.tgz \
  ./ivoryheart-herdr-world-0.0.0-rc.N.tgz
./world-preview/node_modules/.bin/herdr-world --version
```

Use Node.js 22.14.0 or newer and substitute the CI run number for `N`.
On Windows, run `world-preview\\node_modules\\.bin\\herdr-world.cmd`.
To test Homebrew on macOS before merge, download `preview-homebrew` from the same
CI run, extract it into an empty directory and run `bash install-homebrew-preview.sh`
there. The script verifies both Mac checksums, writes `herdr-world-preview.rb` with
a local archive URL for the current architecture, creates a local
`herdrworld/preview` tap, installs its `herdr-world-preview` Formula and runs
`brew test`. Remove it afterward with `brew uninstall herdr-world-preview`
and `brew untap herdrworld/preview`. It conflicts with installed stable or RC
Formulae because they provide the same command. The published URL and tap flow
are checked again during the RC release workflow.

## Publishing a candidate or stable release

1. Create a clean release branch from current `origin/main` and ensure the Unreleased
   changelog accurately describes user-visible changes and the current source lineage.
   Prepare a concise, reviewed `docs/releases/vX.Y.Z.md` or
   `docs/releases/vX.Y.Z-rc.N.md` covering upgrade steps,
   distribution changes and important limits; the Release workflow uses it as the
   public release body.
2. Run `bun install --frozen-lockfile` and `bun run notices:generate` when the
   dependency graph changed. Run `bun run release:prepare -- X.Y.Z-rc.N` for each
   candidate, starting with `0.2.0-rc.1`, or `bun run release:prepare -- X.Y.Z`
   (or `patch`, `minor`, `major`) for stable. Review the public plugin version and
   release notes, then open a ready release PR. RCs leave the Unreleased changelog
   open; stable preparation promotes it into a dated release section. The helper
   drafts later RC notes from the stable notes when no exact RC notes exist; review
   and edit that draft in the PR. If stable publication moves to another UTC date,
   update and review the date in that PR. Private root, web and server manifests
   remain at `0.0.0`; tagged builds inject the reviewed release version into binaries,
   archives and update metadata. Run the repository checks on the prepared branch;
   the tracked pre-push hook runs the full gate when pushing it.
3. After independent review and merge, identify the exact release PR merge commit
   on `main`. With the current repository settings, create and push the annotated
   `vX.Y.Z[-rc.N]` tag on that commit using a maintainer account authorized by the
   release tag ruleset. Verify the tag does not exist and the commit has the expected
   plugin version before pushing. For example:

   ```bash
   git fetch origin main
   release_sha="$(gh pr view PR_NUMBER --json mergeCommit --jq .mergeCommit.oid)"
   git merge-base --is-ancestor "$release_sha" origin/main
   git show "$release_sha:herdr-plugin.toml" | rg '^version = "X.Y.Z-rc.N"$'
   git ls-remote --tags origin "refs/tags/vX.Y.Z-rc.N" # must print nothing
   git tag -a vX.Y.Z-rc.N -m "Herdr World X.Y.Z-rc.N" "$release_sha"
   git push origin refs/tags/vX.Y.Z-rc.N
   ```

   The tag push starts **Release** automatically. Do not also dispatch **Publish
   Release** for that tag. The **Prepare Release** and **Publish Release** workflows
   require repository settings that currently block their GitHub token: Actions
   cannot create pull requests, and the release tag ruleset permits only the
   maintainer account to create `v*` tags. If those settings change, the automated
   path can be used after confirming its token has the required access.
4. The Release workflow revalidates metadata/tests, builds all six platform archives,
   checks their contents and formats, then publishes archives, checksums, update
   manifests and `install-herdr-world.sh` as a GitHub release. It downloads the
   complete published asset set and verifies the installer, archive bytes, checksums
   and update metadata before staging npm packages and a Homebrew
   Formula, including on retries. It then publishes the six npm platform packages
   followed by `@ivoryheart/herdr-world`. RCs use GitHub prerelease status,
   npm's `next` tag and the `herdr-world-rc` Formula. Stable releases become GitHub
   Latest, use npm's `latest` tag and update the `herdr-world` Formula. The workflow
   opens a ready PR in `IvoryHeart/homebrew-tap`; merge it after independent review.
5. Verify the installer, npm installation with optional dependencies, Homebrew
   installation after the tap PR merges, and Herdr plugin download/start/status/url
   flow against the published assets. For stable releases, also verify the project-site
   Latest release probe.

Before publishing the first release, bootstrap the six new platform package names
once. npm requires a package to exist before its trusted publisher can be set.
Run `bun scripts/stage-npm-bootstrap.ts`, review the six generated manifests under
ignored `dist/npm-bootstrap/`, then publish each directory with `npm publish
dist/npm-bootstrap/<platform> --access public --tag bootstrap` using the npm
maintainer account and interactive 2FA. The bootstrap versions contain no binary.
npm may assign `latest` to the first version of a new package even when it is
published with `--tag bootstrap`; the registry does not allow removing that tag.
Until the first stable release replaces it, install `@ivoryheart/herdr-world`
instead of any platform package directly. RC platform packages use `next`.
Configure `release.yml` as an npm trusted
publisher with direct publish permission for all six names and the existing
`@ivoryheart/herdr-world` package. The release workflow then uses GitHub Actions
OIDC without an npm token. The platform names are
`@ivoryheart/herdr-world-{linux,darwin,windows}-{x64,arm64}`.
The existing `HOMEBREW_TAP_TOKEN` must have permission to push a branch and open a PR
in `IvoryHeart/homebrew-tap`. A failed downstream publish can be rerun for the same
tag: npm skips byte-identical versions and rejects changed content.

Do not retag a release or build final artifacts from an unreviewed worktree. If a
published RC artifact is wrong, prepare `X.Y.Z-rc.(N+1)` on a new reviewed release
commit. Prepare the stable `X.Y.Z` only after testing the candidate across the
supported platforms. PWA/site deployment runs from `main` and requires a valid
published Latest release.
