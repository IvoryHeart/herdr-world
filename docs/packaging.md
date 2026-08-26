# Packaging

`herdr-world` ships as separate desktop bridge/web tarballs and an Android APK.

The desktop tarball does not include Herdr itself. Users still need a running Herdr `v0.8.2` or
newer session or daemon that reports terminal protocol `20`; the bundled bridge connects to the
normal Herdr socket.

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

Build or provide Linux artifacts from a Linux environment, macOS ARM artifacts from an Apple Silicon
Mac environment, and macOS x86_64 artifacts from an Intel Mac environment. Build the APK from a
machine with the documented Android SDK setup. Local release operators may use supplemental
build-service instructions for those environments, but the artifact names and layouts below remain
the source of truth.

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

`bin/herdr-world` is a small wrapper that runs `herdr-world-bridge` with `--static-dir` pointed at the
bundled web assets.

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

Before uploading or distributing a desktop tarball, inspect it:

```bash
tar -tzf dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz
cat dist-packages/herdr-world-vX.Y.Z-PLATFORM.tar.gz.sha256
```

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

Start or attach Herdr `v0.8.2` or newer with terminal protocol `20` first:

```bash
herdr
```

Unpack and run:

```bash
tar -xzf herdr-world-vX.Y.Z-linux-x86_64.tar.gz
cd herdr-world-vX.Y.Z-linux-x86_64
bin/herdr-world
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

## Manual Release Upload

The release script creates the GitHub release from changelog notes. Separately packaged tarballs and
APKs are uploaded manually after the release exists.

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
