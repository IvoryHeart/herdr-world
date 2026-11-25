# Release process

Release-please keeps one release PR current from squash-merged `fix:` and `feat:`
PR titles. Its **simple** strategy owns `version.txt`, the release manifest and
`CHANGELOG.md`; its generic updater changes the annotated version in
`herdr-plugin.toml`. The version uses block markers so system installers can
still read the plain version assignment. Development npm manifests remain at `0.0.0`.
The [configuration](../release-please-config.json) and
[workflow](../.github/workflows/release-pr.yml) run in PR-only mode:
the pinned release-please CLI's `release-pr` command. Automation never creates tags.

## Three owner steps

1. **Merge the release PR.** Review the version/changelog and merge after
   **Delivery checks** and independent review. Automation opens or refreshes it
   weekly; **Actions → Release PR → Run workflow** can refresh it sooner.
   The optional `release_as` override accepts `0.3.8-rc.1` for the RC rehearsal.
   It is passed to the CLI's `--release-as` flag for that run only; leaving it
   empty uses normal conventional-commit versioning. For subsequent rehearsal
   releases, use `0.3.8-rc.2`, then `0.3.8` for the final release.
   CI is automatically dispatched for the bot PR with the existing workflow token.
2. **Create `vX.Y.Z` on that merge commit.** Only the owner creates tags, under
   the unchanged tag ruleset. Tag before the next release-please run; this is how
   PR-only release-please finds the previous release. After all channels publish,
   Release automatically changes that merged PR from `autorelease: pending` to
   `autorelease: tagged`, allowing the next release PR without a manual label edit.
   The tag starts
   **Release**, validates main ancestry and the version commit, builds each
   native package once, runs the channel contracts below and seals the bytes.
   It publishes GitHub with `softprops/action-gh-release`, npm with
   `npm publish --provenance` (OIDC), and proposes the tap PR automatically.
3. **Merge the Homebrew tap PR.** `mislav/bump-homebrew-formula-action` opens it
   with `create-pullrequest: true` and `HOMEBREW_TAP_TOKEN`. The action updates
   one URL; `peter-evans/create-pull-request` completes that same PR with our
   generated four-platform Formula and the tap's own macOS install check.
   An existing proposal is reused on reruns. Pages deploys independently of tap.

These are the only owner steps. There are no run IDs, receipts, authorization
inputs, copied values or separate release-note files. GitHub generates release
notes; the release PR's changelog is produced by release-please.

For `vX.Y.Z-rc.N`, GitHub marks a prerelease, npm uses `next`, and Homebrew uses
`herdr-world-rc`; stable Latest stays unchanged. Rehearse with `0.3.8-rc.1`.
After the tap merge, upgrade on a Mac with the prior service running and confirm
the new served version, preserved data and a healthy restart after keg cleanup.

The pinned v4 action reads `release-as` but omits it from its manifest-mode
[`Manifest.fromManifest` call](https://github.com/googleapis/release-please-action/blob/5c625bfb5d1ff62eadeeb3772007f7f66fdcf071/src/index.ts#L89-L140).
That input is ignored in manifest mode, rather than overridden by `feat:` commits.
The [CLI passes the override through](https://github.com/googleapis/release-please/blob/v17.3.0/src/bin/release-please.ts#L496-L507),
preserving the manifest's simple strategy and extra-file updater. The supported
[`release-as` configuration](https://github.com/googleapis/release-please/blob/v17.3.0/docs/manifest-releaser.md#configfile)
also accepts a package override, but the CLI flag avoids persisting a one-run
version in the repository. No pre-1.0 bump policy is changed.

## What blocks publication

The reusable [candidate workflow](../.github/workflows/release-candidate.yml)
builds each of the six native packages once. Every channel consumes those bytes:

- Fresh standalone installer starts on Linux and macOS, x64 and arm64; native
  Windows archive installation starts; npm installs and launches its packed
  launcher/payload on all six targets; Homebrew installs on all four Unix targets.
- Installer and Homebrew upgrades from the previous published stable release
  begin with World running as a real user service, preserve saved settings/data,
  answer on the new served version and remain healthy. Homebrew removes the old
  keg and restarts the service again to prove its persisted opt path.
- Claude and Codex start on Herdr TUI and herdr-core and World lists each agent.
- The shipped-dependency security audit passes.

Only then does the standard immutable Actions artifact `verified-release` seal
the tested GitHub assets, npm tarballs and product Formula/tap inputs in this tag
run. The seal job runs only when every contract job succeeded: a cancelled or
skipped job, such as a walk that never got a runner, blocks it. Its `seal.json`
records each contract job's result, and a rerun reuses retained bytes only when
that record is from the same run and all green; otherwise it builds and tests
again. Standard download-artifact checks its digest when publishers retrieve it.
No source or browser suite runs in Release. No candidate is built on main.

## When a step fails

The failed run summary names one stage and what rerunning does.

- **Release PR:** rerun the workflow to refresh the existing PR. If a merged
  release has not been tagged, create that owner tag before its next run.
- **A channel contract:** fix the failing code through a new reviewed release
  PR. Do not move an already published tag. A failed install, upgrade, agent
  start or shipped audit prevents every publication step.
- **Infrastructure:** runner/setup/download failures get one automatic failed-job
  retry. A second failure remains visible; rerun failed jobs after recovery.
- **Interrupted publication:** open **Actions → Release → the tag run → Re-run
  failed jobs**. The retained tested artifact supplies the same bytes. Rerunning
  all jobs also reuses that artifact within the same run; if absent or expired,
  all builds and channel tests run before publication. Existing GitHub assets
  must match and are kept; existing npm integrity must match and is skipped;
  the same open tap PR is completed without another proposal. Label completion
  is retried too, using the PR merged at that exact tag commit. A skipped publisher
  or label job is an incomplete release, never a successful summary.
- **Tap check:** repair the existing tap PR and review it. GitHub/npm and Pages
  do not wait for the tap merge.

## Real-runtime release walk

The existing walk runs on Linux/macOS x64/arm64. In release CI it downloads the
exact candidate archive using `--archive`, so it cannot rebuild another binary.
A signed-out real Claude/Codex first screen and input prove launch without model
credentials. Synthetic homes, named runtime sessions and private core state keep
all activity separate from live runtimes. Harness pins and the Codex startup
update opt-out live in `scripts/release-walk/`.

To run it independently, use a **disposable OS account or VM** with Bun,
Node/npm, Python/venv, GitHub CLI and a working systemd/launchd user manager:

```sh
bun run test:release-walk --disposable-host --archive PACKAGE.tar.xz --version X.Y.Z
```

A temporary HOME alone cannot isolate native service labels. The walk refuses an
existing World service or configuration. It checks discovery, agent launch/input,
World/CLI listing, saved connections/settings/session upgrade preservation and
native service installation/uninstall. Its synthetic reports bind commit and
archive/binary digests. Redacted listing failure artifacts preserve the last
runtime observation without credentials or transcripts. Optional
`listing_repetitions` on **Release walk** adds independent journeys and stops at
the first failure; it never retries a failed assertion.

## Native platform signal

Every required PR check runs on Linux, including installer/release changes.
Native platform, storage/plugin and running-service upgrade acceptance runs
nightly on main and on release tags. Nightly maintains one advisory issue and
blocks nobody. Main only reports the existing PR proof; it starts no heavy jobs.

## Linux systemd installation gate

`bun run test:install-linux --require-docker` remains an explicit disposable
container acceptance command for Linux startup/reboot and runtime ownership.
See the [development recipe](development.md#linux-installation-acceptance).
Native release channel checks use the exact candidate archives and real user
service managers, not newly built substitutes.

## Pre-merge platform previews

The opt-in `release-preview` label produces six downloadable archives, npm packs
and a Homebrew preview installer after Delivery checks. Download them from the
PR's CI artifacts. Preview version `0.0.0-rc.RUN_NUMBER` is never published to
release channels. Previews retain the normal package/header verification.

## Bumping the verified Herdr

Update World's verified runtime version, target checksums and compatibility
record together. Herdr remains separately installed and retains its installation
owner. Follow [packaging](packaging.md) and [UPSTREAM](../UPSTREAM.md); verify real
runtime journeys with the matching package. Signing/notarization is separate work.
