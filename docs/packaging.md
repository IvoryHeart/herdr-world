# Packaging

`herdr-world` ships as desktop bridge/web tarballs, one universal npm package, Homebrew Formulae,
and an Android APK.

The desktop tarball does not include Herdr itself. Users still need Herdr `v0.8.2` or newer with
terminal protocol `20`; the packaged launcher can guide an interactive user through consent-based
installation and startup of the default local session.

The npm package is generated from the exact three verified desktop archives. It includes the web
assets once and stores the Linux x64, macOS ARM64, and macOS x64 bridges at fixed paths; its launcher
selects the supported bridge and rejects unsupported libc or architectures before native execution.
Installation performs no build, download, Herdr setup, workspace mutation, or process start.

Homebrew uses the prebuilt `herdr-world` Formula for stable releases and `herdr-world-rc` for release
candidates in `IvoryHeart/homebrew-tap`. Each Formula installs the complete bundle privately and
exposes only the `herdr-world` launcher. The two Formulae conflict so they cannot both provide the
same command.

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
  install
  VERSION
  bin/herdr-world
  bin/herdr-world-installer
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

`install` (also available as `bin/herdr-world-installer`) installs the versioned bundle under the
user's local data directory and exposes `herdr-world` and `herdr-world-installer` under
`~/.local/bin`. It then hands off to the installed application, whose Herdr dependency actions
remain separately consented. `--install-only` performs only the local World installation.

`bin/herdr-world` is the portable application launcher and points `herdr-world-bridge` at the
bundled web assets. When the default Herdr
session is missing or incompatible, it can run Herdr's official installer, stop an incompatible
detached server, and start the current Herdr only after separate explicit consent for each action.
The stop prompt warns that the server's panes and processes will exit. The launcher asks for a Herdr
workspace directory rather than using the unpacked bundle by accident. It fails with manual
instructions instead of prompting in automation, and it leaves explicit session and socket targets
under operator control.

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

Confirm the archive contains the expected root directory, `install`, `VERSION`,
`bin/herdr-world`, `bin/herdr-world-installer`, `bin/herdr-world-bridge`, bundled
`share/herdr-world/web/` assets, `LICENSE`,
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

Unpack and install. The installer exposes the application command for the current user and then
continues through consent-based Herdr installation and startup when necessary:

```bash
tar -xzf herdr-world-vX.Y.Z-linux-x86_64.tar.gz
cd herdr-world-vX.Y.Z-linux-x86_64
./install
```

For a portable run without installing World, use `bin/herdr-world`. To install the World commands
without starting anything, use `./install --install-only`.

To manage Herdr yourself or run from automation, start Herdr first and disable launcher prompts:

```bash
HERDR_WORLD_SETUP=never herdr-world
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

`node scripts/release.mjs vX.Y.Z` updates the public version references, pushes the stamped release
tag, and triggers `.github/workflows/release.yml`. The workflow builds, inspects, live-tests, and
retains all six Linux/macOS archive and checksum assets, assembles the GitHub release draft, and
publishes npm and the matching Homebrew channel from the exact tested outputs. Existing public
content is never replaced. The release command also updates the website source, so the same release
push deploys current links through the Pages workflow. See [docs/release.md](release.md) for the
one-time npm bootstrap and required tap secret.

Android remains a deliberate separate step until a signed public APK exists. Do not attach a debug
APK to a public release as though it were a production artifact.
