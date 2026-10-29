# Packaging

Release archives contain one compiled `herdr-world` executable with embedded web
assets plus version, lineage and licence material. They do not contain Herdr, a second
Roamgate application or the retired Rust bridge. Instead the executable pins one
verified Herdr release (`server/src/herdr/release.ts`: version, per-platform package
checksums and the checksum of Herdr's Windows `install.ps1`). The standalone
installer installs Herdr only when absent; explicit World updates retain their
separate Herdr upgrade step. The Homebrew Formula has no mandatory Herdr formula
dependency and never exports a second Herdr executable. Its launcher reuses an
existing Herdr, or installs the verified prebuilt release on first normal startup
when missing, outside the keg. This avoids source builds on Intel Macs. See
[Herdr installation and upgrades](DEPLOYMENT.md#herdr-installation-and-upgrades).

The web build is limited to 180 files and 13.25 MiB total embedded assets,
including lazy features such as Ranger, commit history, the diff worker and the
Town and Board views. Startup limits remain 660 KiB
JavaScript (202 KiB gzip) and 196 KiB CSS. Small highlighting themes share a
lazy chunk to control file count. `bun run build` enforces these limits.

From an installed, clean checkout:

```bash
bun run notices:check
HERDR_WORLD_BUILD_VERSION=X.Y.Z bun run package:linux-x64
```

Available targets are `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`windows-x64` and `windows-arm64`. Bun cross-compiles the executable; package output
is written to ignored `dist/` as a versioned archive, a latest-channel archive,
checksums and an update manifest.
`HERDR_WORLD_BUILD_VERSION` accepts `X.Y.Z` and `X.Y.Z-rc.N`; candidates use the
same six targets and archive layout.

Each archive must contain:

- the platform executable and `VERSION` file;
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `DEPENDENCY_NOTICES.md`,
  `DEPENDENCY_LICENSES.md` and `LICENSES/`;
- `UPSTREAM.md` with the exact Roamgate synchronization point.

Inspect the archive and validate its checksum before publication. Never commit
archives, extracted package directories or compiled binaries. GitHub's Release
workflow builds every supported target and runs
[`scripts/verify-release-package.sh`](../scripts/verify-release-package.sh) on each
archive. It checks the executable header's format and native machine ID rather than
`file` output, whose wording changes between versions; the native Linux x64 binary is
also executed to verify its version.

The same verified archives feed six public npm platform packages and the
`@ivoryheart/herdr-world` launcher. npm selects one binary through optional
dependencies and runs no install script; Node.js 22.14.0 or newer is required for
the launcher. The Release workflow also generates a checksum-pinned Homebrew
Formula for macOS and Linux and opens a reviewable PR in
`IvoryHeart/homebrew-tap` after the GitHub assets are published. Windows uses npm
or the standalone archive; Homebrew does not manage Windows.
Candidates publish to npm's `next` tag and the separate `herdr-world-rc` Formula.

The responsive Web/PWA is the supported mobile artifact. This foundation does not
produce the former Capacitor Android package.

Released Herdr plugins reuse these checksum-verified archives without external Bun.
The platform installer checks the manifest's exact version and native `plugin`
commands, then installs the World executable and a copy named
`server/herdr-world-plugin.exe`. The latter preserves cached action argv and routes
service operations through the canonical executable. No second release artifact
or bundled Herdr runtime is needed. Unreleased source builds and local linking
continue to use Bun through `scripts/world-plugin.ts build-source`.

Native compatibility acceptance compiles an isolated fixture with an empty PATH
and verifies the cached action verbs over HTTP and HTTPS. Its asynchronous
lifecycle awaits the existing bounded installer-fixture cleanup, yielding between
retryable filesystem failures. Persistent cleanup failures still fail the test;
if the body also fails, an `AggregateError` retains both original errors. Fixture
cleanup does not relax installer validation or change the shipped launcher.
Portable lifecycle and filesystem-denial regressions complement the native
Windows lock tests; local passes do not establish native Windows acceptance.
