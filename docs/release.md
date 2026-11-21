# Release process

Releases are prepared and reviewed through pull requests. Never commit or push a
release change directly to `main`.

## Dependency security gate

Maintainers own the dependency alert queue. Shipped high/critical advisories must
be fixed or excepted with a reviewed reason and expiry before the next release;
development-only alerts must be resolved or explicitly mitigated/tracked within
one week. See [the dependency security policy](../SECURITY.md#dependency-alerts-and-ownership).

Run `bun run security:check` before preparing a release. Protected Delivery checks
audit PRs, a daily main workflow queues shipped high/critical findings as
`crew:ready` issues with `Priority: high`, and Release validation reruns the audit
before any GitHub/npm/Homebrew publication. Pages also audits before deployment.
This live registry check cannot be replaced by a previously green CI result.
Fixable high/critical findings in the potentially shipped server/web runtime
closure block publication. Tooling-only findings are reported without blocking
the release, and no-fix findings still receive queue ownership. Output names each
package, advisory and first published newer unaffected stable version.

Exceptions in `security/dependency-exceptions.json` bind one exact package/version
and GHSA URL to a reason and UTC expiry date; expired entries fail closed.
Registry failures also fail closed. Do not disable the gate to publish.

## Pre-merge installer upgrades

Every CI run with code changes calls `.github/workflows/installer-upgrade.yml`, and
Delivery checks requires the entire native matrix: Linux x64/ARM64, macOS Intel/Apple Silicon, and
Windows x64/ARM64 on standard hosted runners. The workflow can also be dispatched
manually against a selected ref. It publishes no release, tag, npm package or Formula.
Documentation-only runs (Markdown outside the packaged notices, which run
`check:docs`) and exact-head reuse runs skip it and the Windows plugin check;
Delivery checks then requires both to be skipped.

Compact installer evidence uploads retry once after an upload failure, including
transient artifact-service DNS errors. The retry replaces any partial artifact;
a second upload failure still fails the job. Native checks remain strict.

One planning job freezes the current latest stable World release tag and its source
SHA. Each runner builds the proposed merge revision with `scripts/package-release.sh`
and a synthetic next-patch release-candidate version unique to the CI run. It uses
a loopback artifact server to exercise the same candidate installers before public
release assets exist. The baseline uses its published tag's real plugin build
command and downloaded release executable; older baselines may require Bun at setup.
CI caches the baseline's published assets per tag and platform and serves them to
that installer from a loopback mirror, so each tag is downloaded once per platform
rather than on every run; otherwise CI dominated the releases' download counts.

On Windows, baselines at `v0.2.6` or older can finish installing and then fail
only because `Remove-Item` encounters a sharing lock on the extracted staging
executable ([#254](https://github.com/IvoryHeart/herdr-world/pull/254),
[#291](https://github.com/IvoryHeart/herdr-world/pull/291)). The harness recognizes
only that exact post-success cleanup failure and records the exception. Baseline
binary versions, launcher and runtime checks still run. Other baseline failures,
newer baselines and every candidate installation remain strict. The published
installer and general CI rerun policy are unchanged.

Before deriving installer working directories, the harness resolves its newly
created fixture root with native `realpath`. Command failures report their
requested and canonical working directory, with `null` when canonicalization is
unavailable; they do not include an environment snapshot. These diagnostics help
distinguish Windows directory aliases from an unrecognized cleanup record.
Both Windows installer matrix jobs run the focused harness regressions through
`bun run test` after dependency installation and before building the candidate.
Native path coverage reports which case and 8.3 aliases the filesystem supports;
short-path coverage is conditional on an available 8.3 alias.

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
the standalone upgrade sets `HERDR_WORLD_SKIP_HERDR=1`. A separate case runs the
candidate's real `herdr-world herdr upgrade --json` on each native platform against
a fake `herdr`, a small Bun-compiled executable. The fake reports the verified Herdr
version (so nothing is downloaded), records its calls and answers
`integration status` and `plugin list`. The case asserts that only the present,
outdated harness integration is installed (codex and claude present, pi absent) and
that the GitHub plugin is reinstalled with `--ref v<candidate>`. Real: the
candidate executable, its CLI, configuration and process handling on that
platform. Faked: Herdr, the harness commands and the plugin registry. Binary
replacement, live handoff and Windows migration are covered by unit tests with fake
binaries, installers and servers.

Reports identify the baseline/candidate revisions, native platform, archive digest
and completed scenarios. Compact JSON evidence is retained for one day; archives
remain on the disposable runner. Missing baseline assets, failed packaging and any
matrix failure block Delivery checks. This deliberately depends on GitHub release
availability and does not silently skip an unavailable latest release.

These checks supplement, rather than replace, the real macOS launchd lifecycle,
installer fault/rollback tests, release archive checks and npm/Homebrew package tests.
They do not claim every historical upgrade, real Herdr plugin registration, OS service
upgrade/reboot, npm/Homebrew channel upgrade or manual browser interaction. Test the
published RC on an existing installation before promoting a stable release.

## Linux systemd installation gate

Before publishing, the Release workflow's Linux x64 package job runs
`bun run test:install-linux --reuse --version <release-version> --require-docker`
against the exact package it will upload. A failed case blocks the package job and
therefore GitHub, npm and Homebrew publication. The release job authenticates its
latest-stable baseline lookup with the workflow token; the native CI matrix reuses
its already frozen baseline tag without another API lookup. To reproduce before a
release, run `bun run test:install-linux` locally; see the [runbook](development.md#linux-installation-acceptance)
for requirements, pins, failure diagnostics and case maintenance.

The same suite runs in the Linux x64 job of `installer-upgrade.yml`, which feeds
the existing required **Delivery checks** result. Installation inputs explicitly
select native packaging in the shared suite rules: the standalone/core installers,
generated bootstrap and Homebrew sources, release packaging, core install RPC
implementation and connection-profile registration. The wider existing packaging
classification also runs it. Every main push selects the full matrix. Ordinary
docs-only PRs and proven exact-head reuse skip native jobs. Keeping it within the
native matrix preserves all protected check names and branch rules and makes a
failed real-install check block the same gate as other installer failures.

This adds real checksum-verified runtime downloads, a real systemd user manager,
core login startup after reboot, core-only defaults/topology, TUI preservation,
RPC install/start and latest-stable World upgrade preservation. Network or runtime
release failures are failures, not skipped acceptance. macOS and Windows remain
outside this suite; before release, check real macOS installation by hand.

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
   the upgrade step reinstalls the Codex, Claude and Pi harness integrations after every
   Herdr upgrade.

After changing `scripts/herdr-core-install.sh` or `scripts/homebrew-herdr-bootstrap.sh`,
run `bun scripts/herdr-bootstrap.ts` to refresh the standalone installer's
checked-in runtime block. Its parity regression ensures the self-contained
download script and Homebrew use the same canonical shell.

Standalone installers and World updates read that table. Homebrew generates a
launcher with no mandatory `herdr` dependency: normal local startup reuses an
existing runtime (Herdr or herdr-core) or installs herdr-core only when neither
exists. The bootstrap reads core's release list and checks the archive's
published SHA-256; it does not call older World's upgrade command.
Metadata/management commands and remote/custom endpoints do not bootstrap. The
native smoke check uses the real signed herdr-core release on Apple Silicon and
Intel: it verifies installation and a live core socket, stops the core it started,
then checks that reinstalling World preserves core without starting it again.
The check recognizes both `localhost` and `127.0.0.1` in World's listener log,
then verifies the actual loopback TCP connection.
Its fixture HOME is a short temporary directory under `/tmp` to fit macOS's
103-byte Unix socket limit. Linux keeps an offline fake-release check. It must
not compile a core dependency or bypass Apple's signature verification.
Run the generated Ruby formula/launcher regressions when changing this policy.

The **Homebrew runtime acceptance** PR/dispatch workflow runs the current check
against the published 0.3.5 Formula on `macos-15` and `macos-15-intel`. Its Formula
is pinned to the immutable 0.3.5 tap PR revision so this baseline cannot silently
advance. Open that workflow's two **Published 0.3.5** jobs to inspect the signed
bootstrap and preservation steps; the normal Release smoke jobs check each new
release's generated Formula.

## Publishing a candidate or stable release

1. Create a clean release branch from current `origin/main`. For a stable release,
   run `bun run changelog:assemble` and commit the result: it appends every
   `changes/*.md` fragment to the Unreleased section of `CHANGELOG.md`, grouped by
   heading and ordered by file name, and deletes the fragments. Ensure the Unreleased
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
   and fragments open; stable preparation assembles any remaining fragments, then
   promotes Unreleased into a dated release section. The release PR adds no
   fragment, so its description states
   `Changelog: none — release preparation assembles the existing fragments.` The helper
   drafts later RC notes from the stable notes when no exact RC notes exist; review
   and edit that draft in the PR. If stable publication moves to another UTC date,
   update and review the date in that PR. Private root, web and server manifests
   remain at `0.0.0`; tagged builds inject the reviewed release version into binaries,
   archives and update metadata. Run the repository checks on the prepared branch;
   the tracked pre-push hook runs the full gate when pushing it.
3. After independent review and merge, identify the exact release PR merge commit
   on `main` and wait for its CI: tag only a main commit with a successful **CI**
   run for that exact commit, never while it is pending or red (see the Main gate
   in [CONTRIBUTING](../CONTRIBUTING.md#pull-requests)). Main's push CI checks a
   batch of merges once, at its newest commit, so a release commit merged with
   others may have no run of its own; then dispatch CI on a branch at exactly that
   commit, as below, and wait for it. With
   the current repository settings, create and push the annotated
   `vX.Y.Z[-rc.N]` tag on that commit using a maintainer account authorized by the
   release tag ruleset. Verify the tag does not exist and the commit has the expected
   plugin version before pushing. For example:

   ```bash
   git fetch origin main
   release_sha="$(gh pr view PR_NUMBER --json mergeCommit --jq .mergeCommit.oid)"
   git merge-base --is-ancestor "$release_sha" origin/main
   # Only when the release commit has no CI run of its own (a batch skipped it):
   #   git push origin "$release_sha:refs/heads/release-check/vX.Y.Z-rc.N"
   #   gh workflow run CI --ref release-check/vX.Y.Z-rc.N
   #   gh run watch "$(gh run list --workflow CI --commit "$release_sha" \
   #     --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
   # Either way, a successful CI run for exactly this commit must exist:
   gh run list --workflow CI --commit "$release_sha" --json event,conclusion \
     --jq '[.[] | select(.conclusion == "success" and (.event == "push" or .event == "workflow_dispatch"))] | length' # must print 1 or more
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
   shards and the web browser job, each with one file worker per runner and the
   pinned test Chrome. Every shard, the web job and repository validation must pass
   before any platform package builds. Prepare Release validates its generated
   working tree in one checkout with one file worker and retains the complete World
   suite; its World cases run one at a time.
   Release then builds and verifies all six platform archives, their aliases,
   checksums, update manifests and installer. Before any publication it packs all
   seven npm tarballs and smoke-installs the launcher, generates the stable or RC
   Homebrew Formula, syntax-checks it and stage-checks it against all four Unix
   archives, and generates the tap patch and exact PR title/body. Both Mac runners
   install and reinstall using the local candidate archives with the same digests,
   run `brew test` and check runtime bootstrap/preservation. Only the smoke Formula's
   archive transport changes to local file URLs; the original public-URL Formula
   and matching tap acceptance script/workflow remain the publication input.

   Every publisher explicitly depends on every verification job. Once all pass,
   `verified-release` retains archives, installer, npm tarballs, Formula, tap
   acceptance inputs, PR patch/title/body, release notes and a SHA-256 manifest
   bound to the source commit and version. Each publisher downloads this same
   immutable artifact and verifies its file inventory and digests before writing.
   A verification failure publishes nothing. GitHub uploads into a draft, compares
   downloaded assets with the verified digests, then makes it public. npm publishes
   the six platform packages followed by `@ivoryheart/herdr-world`, checking existing
   versions' SHA-512 integrity on retries. The tap publisher copies the retained
   Formula and acceptance inputs and opens the retained PR body, without regenerating
   artifacts. Retries reject changed content.

   RCs use GitHub prerelease status, npm's `next` tag and `herdr-world-rc`.
   Stable releases become GitHub Latest, use npm's `latest` tag and update
   `herdr-world`. Homebrew publication opens a ready PR in `IvoryHeart/homebrew-tap`;
   independent review and merge are still required to make that channel installable.
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
Contents, Pull requests and Workflows permissions set to Read and write; the
release PR synchronizes the tap's acceptance workflow as well as its Formula.
A successful branch
push does not prove PR creation access: if `createPullRequest` reports
`Resource not accessible by personal access token`, correct that token's repository
access and PR permissions in GitHub settings. Workflow changes cannot grant token
permissions. A failed downstream publish can be resumed for the same tag with the retained
verified bundle; see recovery below.

Do not move a tag that has published anything, or build final artifacts from an
unreviewed worktree. If a published RC artifact is wrong, prepare `X.Y.Z-rc.(N+1)` on
a new reviewed release commit. Prepare the stable `X.Y.Z` only after testing the candidate across the
supported platforms.

## Rehearse every channel before tagging

In **Actions → Release → Run workflow**, select `main` (or the candidate branch),
leave **dry_run** checked, enter `0.3.6` in **version**, and click **Run workflow**.
The command equivalent is:

```bash
gh workflow run release.yml --ref main -f dry_run=true -f version=0.3.6
```

Dispatch defaults to a dry run, including on tag refs. Publication dispatches must
explicitly pass `-f dry_run=false` on the matching reviewed tag; **Publish Release**
does this automatically. Tag pushes retain normal publication behavior. A dry-run
version overrides the build version without modifying tracked release metadata;
missing final release notes are replaced with an explicitly dry-run note. Final
publication still requires reviewed metadata, release notes and stable changelog.

A rehearsal runs the complete validation, six builds, npm packing/install check,
Formula syntax/stage checks, tap change/PR generation and both native Homebrew
checks. Read **Publication status and recovery** and download `verified-release`
from the run's **Artifacts** section to inspect `tap/pr.patch`, `tap/pr-body.md`,
`tap/Formula/` and `manifest.json`. No tag, GitHub release, npm package, tap commit,
branch or PR is created. This read-only tap generation uses the workflow token;
it does not prove the separate tap publication token's write permissions.

## Resume a partial publication without rebuilding

Publication spans independent services and cannot be atomic after the verification
barrier. If GitHub, npm or tap publication fails, **Publication status and recovery**
queries the services and lists GitHub's draft/public state and asset count, each npm
package's publication state, and the tap branch/PR/merge state. Failed lookups are
reported as unknown. The summary prints the exact command for that run:

```bash
gh run rerun RUN_ID --failed --repo IvoryHeart/herdr-world
```

The Actions equivalent is **Re-run jobs → Re-run failed jobs**. This reruns failed
publishers and their dependents, reusing successful verification jobs and the same
`verified-release` artifact. Do not choose **Re-run all jobs**: that rebuilds rather
than resuming the verified candidate. Fix external permissions/availability first.
Artifacts are retained for 30 days; resume before they expire. A partial GitHub
upload remains a draft and retries upload only missing assets after checking
existing bytes. Existing public GitHub assets, npm versions and tap branch content
must match the retained input; mismatches stop recovery without overwriting them.

A rerun uses the workflow and code from the original ref, so it cannot pick up a
code fix merged afterward. When verification failed before publishing anything,
fix and rehearse again. For a tag already pushed, confirm no public GitHub release,
npm version or tap proposal exists before deleting it and reusing that version on
the reviewed fix as in step 3. Once anything has published, never move the tag:
resume the original bytes, or prepare a new version if those bytes are wrong.

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
