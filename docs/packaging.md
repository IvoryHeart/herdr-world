# Packaging

`herdr-world` ships as separate desktop bridge/web tarballs and an Android APK.

The desktop tarball does not include Herdr itself. Users still need Herdr `v0.8.2` or newer with
terminal protocol `20`; the packaged launcher can guide an interactive user through consent-based
installation and startup of the default local session.

## Release Artifacts

Recommended GitHub release assets:

```text
herdr-world-vX.Y.Z-linux-x86_64.tar.gz
herdr-world-vX.Y.Z-linux-x86_64.tar.gz.sha256
herdr-world-vX.Y.Z-macos-arm64.tar.gz
herdr-world-vX.Y.Z-macos-arm64.tar.gz.sha256
herdr-world-vX.Y.Z-macos-x86_64.tar.gz
herdr-world-vX.Y.Z-macos-x86_64.tar.gz.sha256
herdr-world-vX.Y.Z-android-debug.apk
```

The desktop release workflow builds Linux artifacts on Linux, macOS ARM artifacts on Apple Silicon,
and macOS x86_64 artifacts on Intel. Each native archive is inspected and exercised against two
stock Herdr v0.8.2 daemons before upload. Build the APK separately on a machine with the documented
Android SDK setup; Android is not part of the automated public release until a signed release APK
exists.

The macOS archives are currently unsigned and not notarized. They are public preview artifacts, and
macOS may require users to confirm the first launch in System Settings → Privacy & Security after
verifying the checksum. Do not describe them as signed or notarized until Developer ID credentials
and the corresponding CI steps are in place.

## Desktop Tarball Shape

```text
herdr-world-vX.Y.Z-PLATFORM/
  bin/herdr-world
  bin/herdr-world-bridge
  share/herdr-world/web/
  third_party/licenses/
  third_party/dependencies/
  docs/world-assets.md
  vendor/herdr-compat/VENDOR-MANIFEST.toml
  LICENSE
  THIRD_PARTY_NOTICES.md
  UPSTREAM.md
  README.md
```

`bin/herdr-world` points `herdr-world-bridge` at the bundled web assets. When the default Herdr
socket is absent, it can run Herdr's official installer and start Herdr only after separate explicit
consent. It asks for a Herdr workspace directory rather than using the unpacked bundle by accident.
It fails with manual instructions instead of prompting in automation, and it leaves explicit
session and socket targets under operator control.

## Build A Desktop Tarball

Install dependencies first:

- Node.js 22 or newer
- npm
- Rust stable
- a platform C toolchain usable by Cargo
- `cargo-about` 0.9.2

```bash
npm ci
npm ci --prefix web
npm run notices:check
```

Build the tarball:

```bash
scripts/package-tarball.sh vX.Y.Z linux-x86_64
```

On macOS ARM:

```bash
scripts/package-tarball.sh vX.Y.Z macos-arm64
```

On macOS Intel:

```bash
scripts/package-tarball.sh vX.Y.Z macos-x86_64
```

The output is written under `dist-packages/`:

```text
dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz
dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz.sha256
```

The automated workflow performs the same inspection used locally:

```bash
tar -tzf dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz
cat dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz.sha256
```

CI verifies the complete cross-platform dependency notice closure once before starting the native
matrix, then passes the internal `--notices-verified` assembly flag to avoid rebuilding the same
notice tool on every operating system. Local packaging omits that flag and therefore performs its
own notice check.

Confirm the archive contains the expected root directory, `bin/herdr-world`,
`bin/herdr-world-bridge`, bundled `share/herdr-world/web/` assets, `LICENSE`,
`THIRD_PARTY_NOTICES.md`, `UPSTREAM.md`, the Apache/PixiJS license texts, the World asset
record, complete production npm/Cargo licence inventories, the Herdr vendor
manifest, and `README.md`. The bundled web tree must also contain its
`legal/manifest.json` and referenced legal files so the same notices enter the
Android WebView assembly.

Before release, run the unpacked wrapper against a Herdr `v0.8.2` or newer daemon reporting protocol
`20`. Confirm the bridge accepts that combination and rejects a daemon reporting any other terminal
protocol. Complete the launcher checks in [docs/release.md](release.md) with the packaged bridge, not
only a development build.

In the packaged browser smoke, verify terminal IME commit/cancel behavior and
menu/dialog focus restoration. If Settings → Terminal → Screen-reader text is
enabled, verify the bounded visible-viewport mirror is present; leave it off
by default for ordinary users.

## Build Android APK

Follow [docs/android.md](android.md) for SDK prerequisites, then build:

```bash
npm ci
npm ci --prefix web
npm run android:build:debug
```

The debug build artifact is:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Before uploading or distributing an APK, inspect the package listing or metadata with available
local tools, and confirm it was built from the intended release commit or tag.

To stage the current debug APK under the release asset name for private testing:

```bash
mkdir -p dist-packages
cp android/app/build/outputs/apk/debug/app-debug.apk dist-packages/herdr-world-vX.Y.Z-android-debug.apk
```

For a public release, build a signed release APK instead and use the non-debug release asset name:

```text
dist-packages/herdr-world-vX.Y.Z-android.apk
```

## User Quick Start From Tarball

Unpack and run. If necessary, the interactive launcher offers consent-based Herdr installation and
startup:

```bash
tar -xzf herdr-world-vX.Y.Z-linux-x86_64.tar.gz
cd herdr-world-vX.Y.Z-linux-x86_64
bin/herdr-world
```

To manage Herdr yourself or run from automation, start Herdr first and disable launcher prompts:

```bash
HERDR_WORLD_SETUP=never bin/herdr-world
```

Open:

```text
http://127.0.0.1:8787
```

For LAN or Android testing:

```bash
bin/herdr-world --host 0.0.0.0 --port 4000 --allow-origin http://localhost
```

If using a DNS hostname from Android, also allow it:

```bash
bin/herdr-world --host 0.0.0.0 --port 4000 \
  --allow-origin http://localhost \
  --allow-host herdr-host.local
```

Then install the Android APK and add the bridge URL in the Bridge area of Settings.

For browser-served multi-bridge use, configure both the page-serving bridge and the bridge being
called. If a page opened from `http://host-a:8787` should connect to `http://host-b:8787`, run host
A with:

```bash
bin/herdr-world --host 0.0.0.0 --allow-host host-a --allow-connect-origin http://host-b:8787
```

Run host B with:

```bash
bin/herdr-world --host 0.0.0.0 --allow-host host-b --allow-origin http://host-a:8787
```

`--allow-origin` accepts inbound browser calls to a bridge. `--allow-connect-origin` expands the
served page's Content Security Policy so that page can connect to another bridge over HTTP and
WebSocket.

## Automated Desktop Publication

`node scripts/release.mjs vX.Y.Z` updates the public version references, pushes the release tag,
creates the GitHub release, and triggers `.github/workflows/release.yml`. The workflow builds,
inspects, live-tests, and uploads all six Linux/macOS archive and checksum assets. Existing assets
are never replaced. The release command also updates the website source, so the same release push
deploys current links through the Pages workflow.

Android remains a deliberate separate step until a signed public APK exists. Do not attach a debug
APK to a public release as though it were a production artifact.
