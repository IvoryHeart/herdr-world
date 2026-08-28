# Herdr World npm and Homebrew distribution analysis

- **Date:** 2026-08-28
- **Status:** Research complete; implementation not started
- **Repository:** `IvoryHeart/herdr-world`
- **Current application release:** `v0.1.0-rc.1`
- **Current desktop artifacts:** Linux x86-64, macOS ARM64, and macOS x86-64
- **Related specification:** [Spec 017](../specs/017-herdr-world-npm-homebrew-distribution-spec.md)
- **Related research:** [Herdr plugin release analysis](herdr-plugin-release-analysis-2026-08-26.md)

## Executive conclusion

The smallest useful distribution is one public universal npm package and one
binary-first Homebrew Cask:

1. `@ivoryheart/herdr-world` contains the Node entrypoint, the shared
   launcher/web/documentation/legal payload, and all three native bridges.
2. `IvoryHeart/homebrew-tap` contains one manually prepared, reviewed Cask
   that selects an existing immutable GitHub release archive.

The existing verified desktop archives remain the only native source. Package
generation should re-layout those outputs, not compile a second bridge or
download release assets during installation. A universal npm package avoids a
four-package publication graph and is adequate while the current release
artifacts remain small. A later platform split should require measured evidence.

This distribution remains independent from the Herdr plugin. It should not
make plugin installation depend on npm or Homebrew, and it should not transfer
plugin-managed lifecycle ownership to a package manager.

## Repository and release baseline

The repository is not currently a public npm application package:

- the root `package.json` is private and has version `0.0.0`;
- `web/package.json` is a private frontend development manifest;
- root dependencies include development and Android tooling; and
- application versions are tracked in `release.json`, documentation, and tags.

The existing `scripts/package-tarball.sh` produces platform archives with this
shape:

```text
herdr-world-vX.Y.Z-PLATFORM/
  bin/herdr-world
  bin/herdr-world-bridge
  share/herdr-world/web/
  third_party/
  docs/
  LICENSE
  THIRD_PARTY_NOTICES.md
  UPSTREAM.md
  README.md
```

The archives are already the right source boundary. They contain the bridge,
web application, launcher, documentation, and legal assets, and the existing
verifier checks checksums, archive safety, native format, required files, legal
manifest closure, launcher help, and a no-session failure path.

The current archive sizes are approximately 6.2–6.6 MiB. A universal npm
package will be larger because it carries three bridges, but it avoids
duplicated package metadata, publication sequencing, optional dependency
selection, and platform-package failure modes. Measure the packed size during
implementation. Split the native payload only if that measurement or an npm
limit makes the universal package impractical.

The support matrix is:

| Target | Existing archive | npm bridge path | Cask archive |
| --- | --- | --- | --- |
| Linux x86-64, glibc 2.34+ | `linux-x86_64` | `native/linux-x64/herdr-world-bridge` | Linux archive |
| macOS ARM64 | `macos-arm64` | `native/darwin-arm64/herdr-world-bridge` | ARM64 archive |
| macOS x86-64 | `macos-x86_64` | `native/darwin-x64/herdr-world-bridge` | Intel archive |

Linux ARM64, musl Linux, Windows, and Android remain outside this distribution
scope.

The current `v0.1.0-rc.1` Linux bridge requires symbols through
`GLIBC_2.34`. The initial Linux runtime contract is therefore glibc 2.34 or
newer unless a separate build effort establishes a lower baseline. npm's
`libc` metadata cannot express a version, and the universal package has no
useful platform selector, so the launcher must perform the runtime check.

## npm distribution

### Universal package

The proposed package is:

```text
@ivoryheart/herdr-world
```

It should be a normal public scoped package with one `herdr-world` command.
Its manifest should derive the version from `release.json` by removing only
the leading `v`, declare Node `>=22.14.0`, use the exact repository URL
`https://github.com/IvoryHeart/herdr-world`, set public scoped-package
publication access, and use an explicit `files` allowlist.

The package should contain:

- the Node entrypoint;
- the existing shared launcher behavior;
- `share/herdr-world/web/**`;
- documentation and the complete legal closure;
- `native/linux-x64/herdr-world-bridge`;
- `native/darwin-arm64/herdr-world-bridge`; and
- `native/darwin-x64/herdr-world-bridge`.

It should not contain the root or web development manifests, source-only
dependencies, tests, CI files, Android output, or an arbitrary
`node_modules` tree. It should not use `preinstall` or `postinstall` to
download an archive or run Herdr.

Each bridge is copied from the matching verified desktop archive. The package
should preserve the existing notices, license files, upstream record, bundled
web legal files, `docs/world-assets.md`, `third_party/**`, and
`vendor/herdr-compat/VENDOR-MANIFEST.toml`. The legal manifest must be closed
within the package.

### Entrypoint behavior

The Node entrypoint should use `process.platform`, `process.arch`, and Linux
libc detection to select exactly one of the three fixed paths. It should
resolve paths from its installed package location, never from the current
working directory, a guessed npm prefix, `PATH`, or a public environment
override.

It should invoke the shared launcher behavior with the selected bridge and
static web directory as package-internal paths. This keeps the public contract
small while retaining the existing runtime behavior. It must preserve
arguments, standard streams, relevant signals, and child exit status.

Unsupported OS/CPU/libc combinations and missing or damaged bridge files
should fail before execution with an actionable message. `herdr-world --help`
should print usage and exit successfully without requiring Herdr, a workspace,
or a bridge process.

### Linux compatibility

Release validation should extract the maximum GLIBC symbol version from the
exact Linux bridge copied from the verified archive and fail if it exceeds
2.34. The extracted value and bridge digest should be retained as release
evidence.

At runtime, the launcher should report required 2.34 and detected glibc when
the host is below the floor. It should identify musl and unknown libc clearly,
and reject Linux ARM64 before native execution. Tests should cover below,
exactly at, and above the floor.

### npm publication

The first release path should be manual and deliberately boring:

1. build a clean package directory from the final verified release outputs;
2. run `npm pack`;
3. inspect the exact `.tgz` file list and manifest;
4. install-test that exact `.tgz` on all three supported targets;
5. record its SHA-256; and
6. publish the same `.tgz` with standard npm authentication.

Prerelease application versions should use the `next` dist-tag. Stable
versions should use `latest`. The `@ivoryheart` scope must be owned before
publication, and npm has no ordinary placeholder reservation process, so the
first publication should be the first real package release rather than a
placeholder.

npm name/version contents are immutable. If the wrong bytes are published, that
version cannot be repaired in place; a later application version is required.
No custom publication state model or staged-publishing workflow is needed for
the initial package.

OIDC and CI publication automation can be evaluated later as ordinary release
hardening after the manual path has worked.

## Homebrew distribution

### Cask choice

A Cask is the appropriate initial Homebrew type because the project already
publishes platform-specific binary archives. A source-building formula would
create a second build system and is not justified by the current goal. A binary
formula is also deferred.

The public command should be:

```bash
brew install --cask IvoryHeart/tap/herdr-world
```

This is a third-party tap command, not a Homebrew endorsement or official
Homebrew package.

### Direct Cask shape

The Cask should use the existing immutable GitHub release archives, select the
URL and SHA-256 by target, and support only macOS ARM64, macOS x86-64, and
Linux x86-64. It should expose the archive's existing `bin/herdr-world`
through the normal Cask `binary` mechanism. The bridge must not become a
second command.

The first implementation should not add a Cask wrapper, path environment
contract, downloader, daemon, or service supervisor. The direct `binary`
mapping must be tested after install, upgrade, reinstall, and removal of an
older version. If direct mapping demonstrably fails because of Caskroom path
resolution, use the smallest validated path adaptation and update the
specification only if the public contract changes. It is not a reason to add
an unreviewed wrapper now.

Installation should only unpack and link files. It must not start Herdr or the
bridge, create or modify a workspace, or weaken the existing bridge security
defaults. The stable Cask should never use a moving `latest` URL. A
prerelease Cask, if ever needed, should have a separate name and documented
channel.

### Tap update and signing readiness

After the complete GitHub release asset set is available, a maintainer should
prepare a reviewed tap pull request that changes the Cask version, three
versioned archive URLs, three checksums, and any necessary Cask metadata. The
maintainer should run Cask audit/style and install checks on every available
supported target. The tap should be identified as third-party.

MacOS signing, notarization, and applicable Gatekeeper checks are a separate
stable-release readiness policy. Local Cask implementation and validation may
use release-candidate fixtures; the ordinary stable Cask should not be
published until that policy gate passes. The gate does not determine whether
the distribution uses a Cask or a universal npm package.

## Release architecture

The release sequence should be:

1. build all three native archives from the final tag;
2. run existing archive verification and the stock-Herdr live smoke;
3. generate the universal npm directory from those verified outputs;
4. pack, inspect, install-test, and hash the exact npm `.tgz`;
5. manually publish the exact npm archive under `next` or `latest`;
6. prepare the reviewed tap change from the immutable release URLs and
   checksums after signing readiness; and
7. run Cask audit/style and installation checks.

The desktop archives and Android package remain unchanged. A failed validation
stops publication. A publication retry must first check the external registry;
published npm bytes must never be silently replaced.

## Relationship to Spec 016

Spec 016 remains source-build-only and owns the plugin's bridge and lifecycle.
Installing npm or Homebrew must not change plugin ownership or lifecycle.
Any future plugin use of an external package-manager installation needs a
separate explicit contract for paths, versions, asset pairing, and ownership.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Universal npm package grows as more targets are added | Measure packed size; split only with evidence |
| npm package is installed on unsupported host | Runtime OS/CPU/libc selection and actionable rejection |
| Linux binary needs newer glibc | Release symbol extraction and runtime 2.34 preflight |
| Package files drift from verified archives | Generate only from final archives and inspect the exact `.tgz` |
| Legal file is omitted | Preserve and validate the complete package legal closure |
| Cask direct binary path does not survive Caskroom relinking | Test lifecycle; defer a wrapper until direct failure is demonstrated |
| Third-party tap code is trusted too broadly | Use a fully qualified command and review the tap change |
| Plugin and standalone distribution ownership becomes coupled | Keep the one-sentence Spec 016 boundary |

## Focused validation matrix

### npm

- assert the exact allowlisted package files, including all three fixed bridge
  paths and legal closure;
- assert public metadata, exact repository, version derivation, Node floor, and
  only the `herdr-world` command;
- run `npm pack`, inspect the exact tarball, install it on all three targets,
  and verify the matching bridge is selected;
- verify unsupported OS, CPU, musl, unknown libc, missing bridge, and Linux
  glibc below 2.34 errors;
- run `herdr-world --help` without Herdr, a workspace, or a bridge;
- run the existing live smoke against stock Herdr;
- verify arguments, stdio, signals, and child exit status; and
- manually publish the exact tested and hashed tarball under the intended tag.

### Homebrew

- audit/style the Cask;
- verify immutable versioned URLs and checksums for all three targets;
- install, upgrade, reinstall, directly invoke, and uninstall the Cask on each
  available supported target;
- verify only `herdr-world` is exposed and no installation step starts a
  process or mutates a workspace; and
- block stable publication until the separate signing/readiness policy passes.

### Unchanged behavior

- existing desktop archive verification and launcher behavior remain intact;
- Android packaging and client behavior remain intact; and
- Spec 016 plugin installation, ownership, source-build behavior, and lifecycle
  remain intact.

## Decisions for Spec 017

1. Use one public universal npm package:
   `@ivoryheart/herdr-world`.
2. Copy all bridges from the corresponding verified archives into fixed
   target-specific paths.
3. Use Node 22.14.0 or newer and a fixed Linux glibc 2.34 preflight.
4. Publish the exact manually tested npm `.tgz`; use `next` for prereleases
   and `latest` for stable releases.
5. Use a direct-archive stable Cask in the public third-party tap
   `IvoryHeart/homebrew-tap`, with a manual reviewed tap change.
6. Keep OIDC/CI npm automation, platform npm splits, Cask wrappers, formulas,
   extra targets, and plugin package-manager reuse deferred.

## Sources

### Repository

- [README](../../README.md)
- [Web README](../../web/README.md)
- [Packaging documentation](../packaging.md)
- [Release documentation](../release.md)
- [Spec 016](../specs/016-herdr-world-plugin-release-spec.md)
- [Plugin release analysis](herdr-plugin-release-analysis-2026-08-26.md)
- [Tarball packaging script](../../scripts/package-tarball.sh)
- [Shared launcher](../../scripts/herdr-world-launcher.sh)
- [Desktop package verifier](../../scripts/verify-desktop-package.sh)
- [Release workflow](../../.github/workflows/release.yml)

### npm

- [npm package.json fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)

### Homebrew

- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew taps](https://docs.brew.sh/Taps)
- [Homebrew acceptable Casks](https://docs.brew.sh/Acceptable-Casks)
- [Homebrew Tap Trust](https://docs.brew.sh/Tap-Trust)
