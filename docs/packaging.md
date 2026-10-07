# Packaging

Release archives contain one compiled `herdr-world` executable with embedded web
assets plus version, lineage and licence material. They do not contain Herdr, a second
Roamgate application or the retired Rust bridge.

The web build is limited to 190 files and 14.5 MiB total embedded assets,
including lazy features. The source sync adds Ranger, commit history and a diff
worker; its total budget increases by 0.5 MiB. Startup limits remain 660 KiB
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
workflow builds every supported target and validates the executable format; the native
Linux x64 binary is also executed to verify its version.

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
