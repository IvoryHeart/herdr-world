# Release Process

`herdr-world` is a public downstream application. Releases create Git tags and GitHub releases.
They do not publish npm packages, and the package versions are not release versions.

## Prerequisites

- Clean `main` branch.
- Node.js 22 or newer.
- Rust stable.
- `cargo-about` 0.9.2 (`cargo install cargo-about --version 0.9.2 --locked --features cli`).
- JDK 21 and Android SDK when validating the Android shell.
- GitHub CLI authenticated as a user that can create releases.
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

## Package Artifacts

Build or provide platform artifacts immediately after cutting the GitHub release, using the final
release commit or tag created by the release script. If you made any pre-release artifacts before
the release script stamped `CHANGELOG.md`, rebuild them from the released `main`/tag with the final
`vX.Y.Z` value before upload. Use the documented packaging commands and any supplemental local build
instructions for the release operator's environment. Do not commit generated tarballs, APKs, or
build-service outputs.

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

The desktop tarballs are written to `dist-packages/`. The debug APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

Before uploading or distributing any tarball or APK, inspect the artifact and confirm it matches the
documented release layout, platform, version, and source commit/tag. For desktop tarballs, list the
archive contents and verify the wrapper, bridge binary, bundled `web/dist`, README, root license,
third-party notices, upstream record, Apache/PixiJS license texts, generated production npm/Cargo
licence inventories, World asset record, and Herdr vendor manifest are present.
For APKs, inspect the package listing or metadata and verify the bundled
`public/legal/manifest.json` and every file it names.

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
- promotes `CHANGELOG.md` from `Unreleased` to the release version/date
- removes empty unused subsections from the released version notes
- runs `npm run check`
- commits `Release vX.Y.Z`
- tags `vX.Y.Z`
- pushes `main` and the tag atomically
- creates a GitHub release with notes extracted from `CHANGELOG.md`
- passes `--repo IvoryHeart/herdr-world` and `--verify-tag` explicitly when creating the release
- opens the next `## [Unreleased]` changelog section and pushes it

The release script does not upload binary artifacts. Upload separately packaged tarballs and APKs
manually after the release exists.

## Android Validation

Before distributing Android builds, follow [docs/android.md](android.md): run
`npm run android:build:debug`, and smoke test bridge configuration on a device or emulator with a
bridge started using `--allow-origin http://localhost`. Revisit the Android backup policy before
adding any pairing token or other secret storage.

## Upload Artifacts

Upload release artifacts manually with GitHub CLI after `node scripts/release.mjs vX.Y.Z` creates
the release. Upload only artifacts built from the final release commit or tag, and inspect each
artifact before upload.

Upload the Linux tarball from the Linux build host:

```bash
gh release upload vX.Y.Z \
  dist-packages/herdr-world-vX.Y.Z-linux-x86_64.tar.gz \
  dist-packages/herdr-world-vX.Y.Z-linux-x86_64.tar.gz.sha256 \
  --repo IvoryHeart/herdr-world
```

Upload the macOS ARM tarball from the Apple Silicon Mac build host, or copy it to the release
operator machine first:

```bash
gh release upload vX.Y.Z \
  dist-packages/herdr-world-vX.Y.Z-macos-arm64.tar.gz \
  dist-packages/herdr-world-vX.Y.Z-macos-arm64.tar.gz.sha256 \
  --repo IvoryHeart/herdr-world
```

Upload the macOS Intel tarball from the Intel Mac build host, or copy it to the release operator
machine first:

```bash
gh release upload vX.Y.Z \
  dist-packages/herdr-world-vX.Y.Z-macos-x86_64.tar.gz \
  dist-packages/herdr-world-vX.Y.Z-macos-x86_64.tar.gz.sha256 \
  --repo IvoryHeart/herdr-world
```

Upload the Android debug APK after it has the final debug asset name:

```bash
gh release upload vX.Y.Z dist-packages/herdr-world-vX.Y.Z-android-debug.apk \
  --repo IvoryHeart/herdr-world
```

If every artifact has been copied to one machine, the same paths can be uploaded in one
`gh release upload` invocation.

## After

- Confirm the GitHub release exists and points at the expected tag.
- Confirm release assets and checksum files are attached.
- Confirm `CHANGELOG.md` on `main` has a fresh empty `## [Unreleased]` section.
