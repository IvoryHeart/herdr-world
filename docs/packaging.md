# Packaging

Release archives contain one compiled `herdr-world` executable with embedded web
assets plus version, lineage and licence material. They do not contain Herdr, a second
Roamgate application or the retired Rust bridge.

From an installed, clean checkout:

```bash
bun run notices:check
HERDR_WORLD_BUILD_VERSION=X.Y.Z bun run package:linux-x64
```

Available targets are `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`windows-x64` and `windows-arm64`. Bun cross-compiles the executable; package output
is written to ignored `dist/` as a versioned archive, a latest-channel archive,
checksums and an update manifest.

Each archive must contain:

- the platform executable and `VERSION` file;
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `DEPENDENCY_NOTICES.md` and `LICENSES/`;
- `UPSTREAM.md` with the exact Roamgate synchronization point.

Inspect the archive and validate its checksum before publication. Never commit
archives, extracted package directories or compiled binaries. GitHub's Release
workflow builds every supported target and validates the executable format; the native
Linux x64 binary is also executed to verify its version.

The responsive Web/PWA is the supported mobile artifact. This foundation does not
produce the former Capacitor Android package.
