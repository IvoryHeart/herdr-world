# Release process

Release automation is started in **Actions → Release PR → Run workflow** with
`X.Y.Z`, `X.Y.Z-rc.N`, `patch`, `minor` or `major`. It requires green main,
opens or refreshes one `release/next` PR and dispatches its CI with the existing
workflow token. The PR bumps `herdr-plugin.toml` and assembles a short changelog
section from `changes/`. That section is the release notes; no separate notes
file is required. Development manifests stay at `0.0.0`.

## Three owner steps

1. **Merge the release PR.** Review the version and changelog, then merge once
   **Delivery checks** and independent review pass. Main CI builds the packages,
   checks their installed behavior and retains one sealed `verified-release`
   artifact for 30 days.
2. **Create `vX.Y.Z` on that merge commit.** Only the owner creates tags; the tag
   ruleset is unchanged. The tag starts **Release** automatically. It verifies
   main ancestry, the version-changing commit and the matching plugin version,
   then waits for that commit's main CI. It publishes the tested seal to GitHub,
   publishes npm with OIDC provenance, then opens or updates the Homebrew tap PR
   using `HOMEBREW_TAP_TOKEN`. No run ID, receipt or further dispatch is needed.
3. **Merge the Homebrew tap PR.** Its own macOS check installs the formula and
   verifies runtime ownership. Pages deployment runs independently of that merge
   and of tap publication failure.

For `vX.Y.Z-rc.N`, GitHub marks a prerelease, npm uses `next`, and the tap PR
updates `herdr-world-rc`. Stable Latest channels remain unchanged. To rehearse
`0.3.8-rc.1`, run Release PR for that version and follow the same three steps.
On a Mac with the previous World service running, upgrade through the RC formula
and confirm World answers on the new version with its existing data.

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

Only then does the workflow seal the GitHub assets (including installer), npm
packs, formula/tap inputs and changelog notes with their content digests, version
and source commit. Every publisher verifies that manifest immediately before its
effects. Release runs do not repeat source or browser tests. Main CI supplies
those results, reusing the PR result when its tested tree is identical.

## When a step fails

A failed release's summary gives one line naming the failed stage and what a
rerun does. Open its failed job for the underlying error.

- **Release PR:** fix red main or the version/changelog input, then rerun Release
  PR. It refreshes the same PR rather than opening another.
- **Main CI or a channel contract:** fix the failing code. The release waits for
  queued/running CI and the single infrastructure retry; a real CI failure
  refuses publication. Do not retag a published version. Start a new release PR
  when code must change.
- **Transient runner/setup/download failure:** automation retries failed jobs
  once. A second failure stays visible. Re-run the tag workflow after resolving
  infrastructure; no authorization ceremony is required.
- **Interrupted publication:** use **Actions → Release → the tag run → Re-run all
  jobs** (or failed jobs while its retained seal is available). Identical existing
  GitHub assets are checked and kept; existing npm versions are checked by
  integrity and skipped; an open tap PR is updated in place. Different public
  bytes are refused, never overwritten.
- **Expired seal:** rerunning the tag automatically rebuilds and repeats every
  channel contract above before publication. It never publishes untested bytes.
- **Tap check:** repair the formula/acceptance change in the existing tap PR and
  review it. GitHub/npm publication and Pages do not wait for the tap merge.

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

## Pre-merge installer upgrades

Installer, service-manager, plugin, release and native test inputs select the
six-OS native matrix on PRs. Ordinary server changes use Linux static, unit,
browser and behavioral checks. **Delivery checks** is the only required
aggregate. **Nightly native** exercises all six targets and running channel
upgrades on main; one issue tracks failures as a signal rather than a merge gate.

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
