# Release Process

`herdr-world` is a public downstream application. One tagged release workflow assembles the
GitHub, npm, and Homebrew distributions from the same verified native artifacts. Root and web
development manifests remain private at version `0.0.0`; public package versions are derived from
the release tag.

## Prerequisites

- Clean `main` branch.
- Node.js 22 or newer.
- Rust stable.
- `cargo-about` 0.9.2 (`cargo install cargo-about --version 0.9.2 --locked --features cli`).
- JDK 21 and Android SDK when validating the Android shell.
- GitHub CLI authenticated as a user that can create releases.
- Active repository rulesets protecting `main` and `v*` release tags.
- The public `IvoryHeart/homebrew-tap` repository and an Actions secret named
  `HOMEBREW_TAP_TOKEN`, restricted to that repository's Formula contents.
- After the one-time npm bootstrap: the exact `.github/workflows/release.yml` workflow configured
  as the npm trusted publisher for `@ivoryheart/herdr-world`.
- `origin` fetch and push URLs both resolve to `IvoryHeart/herdr-world`. The release helper rejects
  upstream, fork, local-path, and unsupported remote URLs before making any release mutation.
- A local Herdr `v0.8.2` or newer session reporting terminal protocol `20` for browser and packaged
  bridge smoke testing.

## Prepare

1. Confirm the changelog has user-facing notes under `## [Unreleased]`.
   Entries merged through pull requests should include the PR number or link before the PR is
   merged.
2. Confirm the vendored Herdr compatibility crate is intentional and clean:

```bash
scripts/check-vendor.sh
```

3. Run the full automated check:

```bash
npm run check
```

Do not cut a release without bridge test/build coverage.

Corrections use a new release-candidate number. For example, a correction after
`v1.2.3-rc.2` is `v1.2.3-rc.3`; the existing tag and public package content are never replaced.

## Package Artifacts

Desktop artifacts are built from the final tag by `.github/workflows/release.yml`; do not upload a
locally built substitute. Pull requests that affect the desktop assembly run the same Linux,
Apple-Silicon, and Intel matrix without publishing. Each job checks the native CPU format and bundle
contents, then exercises the packaged bridge against two checksum-pinned stock Herdr v0.8.2 daemons.
One required notice gate validates the complete cross-platform dependency closure before any native
job starts, avoiding three redundant builds of the notice generator.

Linux desktop tarball:

```bash
npm ci
npm ci --prefix web
scripts/package-tarball.sh vX.Y.Z linux-x86_64
```

macOS ARM desktop tarball, run on an Apple Silicon Mac:

```bash
npm ci
npm ci --prefix web
scripts/package-tarball.sh vX.Y.Z macos-arm64
```

macOS Intel desktop tarball, run on an Intel Mac:

```bash
npm ci
npm ci --prefix web
scripts/package-tarball.sh vX.Y.Z macos-x86_64
```

Android debug APK:

```bash
npm ci
npm ci --prefix web
npm run android:build:debug
```

Local desktop tarballs are written to `dist-packages/`. The debug APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

Before uploading or distributing any tarball or APK, inspect the artifact and confirm it matches the
documented release layout, platform, version, and source commit/tag. For desktop tarballs, list the
archive contents and verify the root installer, named installer, version marker, wrapper, bridge
binary, bundled `web/dist`, README, root license,
third-party notices, upstream record, Apache/PixiJS license texts, generated production npm/Cargo
licence inventories, World asset record, and Herdr vendor manifest are present.
For APKs, inspect the package listing or metadata and verify the bundled
`public/legal/manifest.json` and every file it names.

The macOS archives are intentionally unsigned and unnotarized until Developer ID credentials are
available. Release notes and user documentation must retain that limitation. The workflow does not
attempt to weaken Gatekeeper or modify a user's security policy.

For the desktop installer, verify `./install --install-only` creates versioned user-local files and
working `herdr-world`/`herdr-world-installer` command links without starting Herdr. Verify the
normal `./install` path hands off to the installed launcher. For the desktop launcher, verify
`bin/herdr-world --help` never starts onboarding, a
non-interactive launch with no default Herdr socket fails with manual instructions, and an
interactive missing-session launch asks independently before installation and startup. Also verify
that an interactive incompatible default server asks independently before installation/update,
server stop, and restart, while declining the stop leaves it running. A stale socket with no
reachable daemon must proceed to startup without a stop prompt. Do not exercise the live
installer during release verification; the launcher tests replace its network and process
boundaries with deterministic fakes.

To stage the current debug APK under the release asset name for private testing:

```bash
mkdir -p dist-packages
cp android/app/build/outputs/apk/debug/app-debug.apk dist-packages/herdr-world-vX.Y.Z-android-debug.apk
```

For a public release, build a signed release APK instead and use the non-debug release asset name:

```text
dist-packages/herdr-world-vX.Y.Z-android.apk
```

## Browser And Federation Smoke

Start or attach a Herdr `v0.8.2` or newer session reporting terminal protocol `20`:

```bash
herdr
```

Build and run the web bridge:

```bash
npm run build
scripts/run-bridge.sh
```

Open `http://127.0.0.1:8787` and verify:

- The app loads the workspace, tab, pane, and split layout snapshot.
- Multiple browser clients can attach to the same terminal.
- Pane selection syncs between browser clients.
- Typing, mobile text input, stage-only input, tap-focus setting, scrolling, and refit work.
- Desktop IME composition commits once and canceled preedit is not replayed; dialog/menu focus
  returns to the invoking control.
- Settings → Terminal → Screen-reader text is off by default; when enabled, its mirror contains
  only a bounded visible terminal viewport, including visible scrolled-back rows, and does not
  expose unbounded terminal history or hidden cells.
- New tabs can launch Shell and every enabled managed built-in agent.
- Split right/down can launch Shell and every enabled managed built-in agent.
- A custom preset launches its exact configured `argv`, including a wrapper or SSH-shaped command,
  without a built-in agent executable being prepended.
- A forced managed-agent launch failure removes the tab or split created for that launch.
- Upload button, paste upload, and drop upload place shell-quoted file paths in the terminal.
- Pane notes can be created, edited, reloaded, and recovered from the Notes view.
- Binding to `HOST=0.0.0.0` is only used on a trusted network.

Then follow the two-host procedure in [federation.md](federation.md) and verify direct browser
connections to both bridges, collision-safe host-qualified navigation and command routing, isolated
offline/incompatible host states, terminal input and resize, and serving-host reload behavior. Run
the automated acceptance gate from a clean dependency install:

```bash
npm run check:acceptance
```

Repeat the startup, terminal attach, and launcher checks with an unpacked desktop tarball before
uploading it. Confirm the bridge rejects every protocol other than `20`
instead of serving a partially compatible UI.

## Cut

Choose the GitHub release version explicitly and run:

```bash
node scripts/release.mjs v0.1.0
```

The script:

- requires a clean `main` branch
- verifies both `origin` URLs and GitHub CLI access against `IvoryHeart/herdr-world`
- runs `npm run check`
- updates `release.json` and every current release reference in the README and Pages source
- promotes `CHANGELOG.md` from `Unreleased` to the release version/date
- removes empty unused subsections from the released version notes
- rechecks the stamped release and Pages metadata
- commits `Release vX.Y.Z`
- tags `vX.Y.Z`
- pushes `main` and the tag atomically
- opens the next `## [Unreleased]` changelog section and pushes it

The tag starts the release distribution workflow. It builds and verifies Linux x86-64, macOS ARM64,
and macOS x86-64 archives, assembles a draft GitHub release, and publishes the enabled npm and
Homebrew channels from the exact tested outputs. The release commit's site changes also trigger the
Pages deployment. No separate desktop upload or documentation-edit step is required.

## Android Validation

Before distributing Android builds, follow [docs/android.md](android.md): run
`npm run android:build:debug`, and smoke test bridge configuration on a device or emulator with a
bridge started using `--allow-origin http://localhost`. Revisit the Android backup policy before
adding any pairing token or other secret storage.

## One-time npm bootstrap and external setup

The first npm publication must be a release candidate. The protected workflow generates and
install-tests the exact package tarball, then reports it as an action-required artifact because npm
trusted publishing cannot be configured until the package exists.

1. Download `npm-package-${RUN_ID}` from the tagged workflow.
2. Verify its SHA-256 and npm integrity against `npm-package-metadata.json`.
3. Publish that exact `.tgz` unchanged with interactive 2FA and the `next` dist-tag:

```bash
npm publish herdr-world-vX.Y.Z-rc.N.tgz --access public --tag next
```

4. In npm package settings, configure GitHub Actions trusted publishing for user `IvoryHeart`,
   repository `herdr-world`, workflow `.github/workflows/release.yml`, allowing `npm publish`.
5. Verify the registry version and integrity, then enable two-factor authentication for writes and
   disallow traditional publishing tokens. Later tagged releases publish through OIDC and require
   no `NPM_TOKEN`.

Create the tap-scoped fine-grained GitHub token manually and save it as the repository Actions secret
`HOMEBREW_TAP_TOKEN`. It needs only Contents read/write access to `IvoryHeart/homebrew-tap`; it must
not be written to a Formula, artifact, cache, or log. The workflow validates and exercises the
Formula on all three supported native runners before committing directly to the tap's default branch.

After the tag is pushed, monitor `Release distribution` and `Deploy GitHub Pages`. The release
workflow reports GitHub, npm, and Homebrew results separately. It does not publish Android debug
builds or unsigned artifacts as production-signed software.

## After

- Confirm the GitHub release exists and points at the expected tag.
- Confirm release assets and checksum files are attached.
- Confirm both macOS archives are still described as unsigned until signing is implemented.
- Confirm the project site links to the new release after the Pages deployment.
- Confirm `CHANGELOG.md` on `main` has a fresh empty `## [Unreleased]` section.
