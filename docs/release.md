# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

## Pre-merge installer upgrades

Every CI run with code changes calls `.github/workflows/installer-upgrade.yml`, and
Delivery checks requires the entire native matrix: Linux x64/ARM64, macOS Intel/Apple Silicon, and
Windows x64/ARM64 on standard hosted runners. The workflow can also be dispatched
manually against a selected ref. It publishes no release, tag, npm package or Formula.
Documentation-only runs (Markdown outside the packaged notices, which run
`check:docs`) and exact-head reuse runs skip it and the Windows plugin check;
Delivery checks then requires both to be skipped.

One planning job freezes the current latest stable World release tag and its source
SHA. Each runner builds the proposed merge revision with `scripts/package-release.sh`
and a synthetic next-patch release-candidate version unique to the CI run. It uses
a loopback artifact server to exercise the same candidate installers before public
release assets exist. The baseline uses its published tag's real plugin build
command and downloaded release executable; older baselines may require Bun at setup.

The matrix verifies fresh plugin installation, latest-stable plugin upgrade, frozen
cached action argv, executable versions, HTTP health, login, embedded browser assets,
configuration and session migration, runtime restart, and checksum
rejection without changing the working installation. Unix additionally upgrades the
standalone shell installation from the baseline executable. Each installer and runtime
subprocess receives isolated synthetic state and a PATH that cannot resolve Bun.
The v0.2.3 upgrade must reject legacy password-signed cookies and allow re-login;
new sessions must survive candidate restart. Later baselines require session
preservation across upgrade as well. Bun remains the build/test driver; this is a no-Bun execution environment, not a claim
that the entire runner has no Bun files. No live service or external Herdr is managed:
the standalone upgrade sets `HERDR_WORLD_SKIP_HERDR=1`, and the installer's Herdr
step is covered by unit tests with fake Herdr binaries, installers and servers.

Reports identify the baseline/candidate revisions, native platform, archive digest
and completed scenarios. Compact JSON evidence is retained for one day; archives
remain on the disposable runner. Missing baseline assets, failed packaging and any
matrix failure block Delivery checks. This deliberately depends on GitHub release
availability and does not silently skip an unavailable latest release.

These checks supplement, rather than replace, the real macOS launchd lifecycle,
installer fault/rollback tests, release archive checks and npm/Homebrew package tests.
They do not claim every historical upgrade, real Herdr plugin registration, OS service
upgrade/reboot, npm/Homebrew channel upgrade or manual browser interaction. Test the
published RC on the owner's existing installation before promoting a stable release.

## Pre-merge platform previews

Add the `release-preview` label to a release preparation PR. Its CI run first
checks the branch, then builds six downloadable `preview-<platform>` artifacts
and a `preview-npm` artifact assembled from those same archives. Each archive passes
the same package verification as Release, on the same pinned runner image, so a
packaging check that would fail after tagging fails on the release PR instead.
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
server, then exercise local/SSH connection selection, Town, Board, Desk,
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

## Bumping the verified Herdr

Each release pins the Herdr it installs and upgrades to
(`server/src/herdr/release.ts`). To move to a new Herdr release:

1. Confirm its protocol is in `server/src/bridge/protocol-compat.ts` and exercise
   World against it.
2. Copy the version, protocol and per-target SHA-256 values from
   `https://herdr.dev/latest.json`. Download `distribution/install.ps1` at the new
   tag and record its SHA-256 too.
3. Note any integration or plugin behaviour the new Herdr changes in the changelog;
   the upgrade step reinstalls the Codex, Claude and Pi integrations after every
   Herdr upgrade.

Users receive the new Herdr with the World release that declares it.

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
4. The Release workflow revalidates metadata and repository tests with one file
   worker and at most two concurrent cases. Its World browser tests use the same
   [World browser workflow](../.github/workflows/world-browser.yml) as PR CI: six
   shards, the web browser job and the quiet latency-budget job, each with one file
   worker per runner. Every shard, the web and latency jobs and repository validation must pass
   before any platform package builds. Prepare Release validates its generated
   working tree in one checkout with one file worker and retains the complete World
   suite; its World cases run one at a time.
   Release then builds all six platform archives,
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
in `IvoryHeart/homebrew-tap`. A fine-grained token needs repository access with
Contents and Pull requests permissions set to Read and write. A successful branch
push does not prove PR creation access: if `createPullRequest` reports
`Resource not accessible by personal access token`, correct that token's repository
access and PR permissions in GitHub settings. Workflow changes cannot grant token
permissions. A failed downstream publish can be rerun for the same
tag: npm skips byte-identical versions and rejects changed content.

Do not move a tag that has published anything, or build final artifacts from an
unreviewed worktree. If a published RC artifact is wrong, prepare `X.Y.Z-rc.(N+1)` on
a new reviewed release commit. Prepare the stable `X.Y.Z` only after testing the candidate across the
supported platforms.

Rerunning a failed tag workflow uses the code and workflow from that tag, so
retrying it does not pick up a fix merged to `main`. When Release failed before
publishing anything, reuse the version rather than skipping it: confirm no GitHub
release exists for the tag and npm has neither the launcher nor any platform
package at that version, delete the tag, merge the reviewed fix, then tag the same
version on the new merge commit as in step 3. Once any asset or package has
published, prepare a new version instead.

Pages deployment runs from `main` and requires a working installer on the
published stable Latest release. Candidates do not deploy the replacement site.
After GitHub assets and npm packages publish and the Homebrew PR opens, the stable
Release workflow dispatches **Deploy Pages** on `main`. Its HTTPS installer guard
remains mandatory; it then builds the shared screenshots, tutorial, metadata,
and World brand assets. The Homebrew tap PR still needs independent review and
merge before that channel is ready.

A main-branch site push before stable publication can fail the installer guard;
this leaves the existing public site untouched. After stable publication, verify
that **Deploy Pages** succeeds, and open the homepage and `/tutorial/`. Check the
favicon, social image, all four views, desktop/mobile screenshots, and copied
installation command. If dispatch or deployment fails, fix the failure and run
**Deploy Pages** manually on `main`; do not remove the guard to publish broken
download instructions. The dispatch uses the Release job's narrowly scoped
`actions: write` token because releases created with `GITHUB_TOKEN` do not
trigger a separate release-event workflow.

Set the repository's GitHub social preview to `site/github-social-preview.png`
in repository settings, and keep its homepage set to the Pages URL. The file's
presence in Git does not configure GitHub's social preview. The homepage,
README, PWA icons, and social images share the World brand; required Roamgate and
third-party attributions remain visible in the notices.
