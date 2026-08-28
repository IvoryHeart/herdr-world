# Herdr World npm and Homebrew distribution

- **Spec ID:** `017-herdr-world-npm-homebrew-distribution`
- **Status:** Draft
- **Created:** 2026-08-28
- **Owner:** IvoryHeart
- **Reviewers:** —
- **Approved by:** —
- **Approved at:** —

This specification is a standalone distribution contract related to, but
independent from, [Spec 016](016-herdr-world-plugin-release-spec.md). Its
primary research input is the
[npm and Homebrew distribution analysis](../analysis/npm-homebrew-distribution-analysis-2026-08-28.md).
It does not extend the Herdr plugin lifecycle contract.

## 1. Purpose and outcome

Herdr World already produces verified desktop archives containing the native
bridge, web application, launcher, documentation, and legal assets. This
specification defines the smallest package-manager distribution that reuses
those release outputs.

The outcome is:

- one public npm package, `@ivoryheart/herdr-world`, containing the Node
  entrypoint, shared application payload, and all three supported native
  bridges; and
- one binary-first Homebrew Cask in the separate public third-party tap
  `IvoryHeart/homebrew-tap`.

Both distributions SHALL remain separate from Herdr itself. Installation SHALL
install files only: it SHALL not install Herdr, start Herdr or the bridge,
create a workspace, or change plugin state.

## 2. Scope and support matrix

The supported package-manager targets are:

| Operating system | CPU | Existing release archive |
| --- | --- | --- |
| Linux | x86-64 with glibc 2.34 or newer | `linux-x86_64` |
| macOS | ARM64 | `macos-arm64` |
| macOS | x86-64 | `macos-x86_64` |

Linux ARM64, musl Linux, Windows, Android, and other combinations are outside
this support promise. The npm entrypoint and Cask SHALL fail clearly for
unsupported operating systems, architectures, or libc implementations.

This specification does not implement package generation, npm publication,
Cask or release-workflow changes, or launcher changes. Those are follow-up
implementation work.

## 3. Non-goals

The following are explicitly deferred:

- optional npm platform packages or a multi-package publication graph;
- a second native build pipeline or an install-time release downloader;
- npm publication states, staged publishing, OIDC/CI publication automation,
  or a publication database;
- a Cask wrapper, new public path environment contract, or service supervisor;
- source-building or binary Homebrew formulas;
- official Homebrew repository submission;
- a prerelease Homebrew Cask channel;
- Linux ARM64, musl Linux, Windows, or additional targets;
- plugin discovery or reuse of npm/Homebrew installations; and
- changes to desktop tarball layout, Android packaging, or Spec 016.

A later package split MAY be proposed only after measured packed-size evidence or
an actual npm distribution limit demonstrates that the universal package is
impractical.

## 4. Settled requirements

### 4.1 Verified release reuse

The existing GitHub desktop release archives SHALL remain the native source of
truth. The release process SHALL build all three archives from the final tag
and verify their contents, legal closure, native format, and SHA-256 checksums
before creating either package-manager artifact.

The npm package SHALL copy each native bridge from its matching verified archive.
The Cask SHALL use those same immutable release archives. Neither distribution
MAY compile a second native bridge or download a bridge during installation.

The existing desktop tarballs and Android packaging SHALL remain unchanged.

### 4.2 Universal npm package

The package SHALL be named `@ivoryheart/herdr-world`. Ownership of the
`@ivoryheart` npm scope is an external publication prerequisite. npm package
names SHALL be checked before the first real publication; placeholder packages
SHALL not be published merely to reserve names.

The package SHALL:

- be public, with `publishConfig.access: "public"`;
- derive its version from `release.json` by removing only the leading `v`;
- declare `engines.node: ">=22.14.0"`;
- use repository metadata resolving exactly to
  `https://github.com/IvoryHeart/herdr-world`;
- use an explicit `files` allowlist;
- expose only the `herdr-world` command;
- contain the Node entrypoint, shared launcher behavior, bundled web assets,
  documentation, and complete legal material; and
- contain all three bridges at these fixed package-relative paths:

```text
native/linux-x64/herdr-world-bridge
native/darwin-arm64/herdr-world-bridge
native/darwin-x64/herdr-world-bridge
```

The package SHALL not declare optional platform dependencies or platform
selectors. The root and `web/package.json` files SHALL remain private
development manifests and SHALL not be published as the runtime package.

The allowlist SHALL include the package manifest and README, launcher support
files, `share/herdr-world/web/**`, all three native paths, `LICENSE`,
`THIRD_PARTY_NOTICES.md`, `UPSTREAM.md`, `docs/world-assets.md`,
`third_party/**`, and
`vendor/herdr-compat/VENDOR-MANIFEST.toml`. It SHALL include every file
referenced by the bundled legal manifest and SHALL not include source-only
dependencies, tests, CI files, Android outputs, or an arbitrary
`node_modules` tree.

The package SHALL not use `preinstall` or `postinstall` to fetch release
assets, execute Herdr, or create a second native payload.

#### Scenario: The npm package is inspected

- **GIVEN** a package is generated from `v0.1.0-rc.1`
- **WHEN** its manifest and packed file list are inspected
- **THEN** the version is `0.1.0-rc.1`, the repository is exact, access is
  public, only `herdr-world` is exposed, all three fixed bridge paths exist,
  and the package contains complete applicable legal material

### 4.3 npm entrypoint and runtime selection

The Node entrypoint SHALL select exactly one fixed bridge path using
`process.platform`, `process.arch`, and Linux libc information:

| Platform | Architecture | Runtime result | Bridge path |
| --- | --- | --- | --- |
| `linux` | `x64` | glibc 2.34+ | `native/linux-x64/herdr-world-bridge` |
| `darwin` | `arm64` | any supported macOS libc | `native/darwin-arm64/herdr-world-bridge` |
| `darwin` | `x64` | any supported macOS libc | `native/darwin-x64/herdr-world-bridge` |

It SHALL reject Linux ARM64, musl or unknown libc, Windows, and every other
unsupported combination before executing a bridge. Missing or damaged
package-local bridge files SHALL produce an actionable nonzero error.

The entrypoint SHALL resolve all package files from its own installed package
location. It SHALL not use the current working directory, a guessed npm
prefix, an ambient global executable, or a user-provided path override.

The entrypoint SHALL invoke the shared launcher behavior with the selected
package-local bridge and the package-local static web directory. This
selection is an internal package implementation detail; this specification
defines no new public environment-variable path contract.

The entrypoint SHALL preserve arguments, standard input, standard output,
standard error, relevant child signals, and child exit status. It SHALL not
start Herdr onboarding, select a workspace, or start a bridge for
`herdr-world --help`. Help SHALL succeed without a running Herdr session.

#### Scenario: npm target selection succeeds

- **GIVEN** the package is installed on macOS ARM64
- **WHEN** `herdr-world --help` or a normal invocation runs
- **THEN** the entrypoint selects only
  `native/darwin-arm64/herdr-world-bridge` and does not inspect a global
  installation or the caller's working directory

#### Scenario: npm target is unsupported

- **GIVEN** the package is run on Linux ARM64, musl Linux, Windows, or another
  unsupported target
- **WHEN** the entrypoint starts
- **THEN** it exits before bridge execution with a diagnostic naming the
  detected operating system, architecture, or libc and the supported matrix

#### Scenario: npm help is requested

- **GIVEN** no Herdr session is running
- **WHEN** `herdr-world --help` runs
- **THEN** usage is printed, the command exits successfully, and no Herdr or
  bridge process starts

### 4.4 Linux glibc baseline

The published `v0.1.0-rc.1` Linux bridge currently requires symbols through
`GLIBC_2.34`. glibc 2.34 is the initial minimum Linux runtime contract.

Release validation SHALL extract the maximum required GLIBC symbol version from
the exact Linux bridge copied from the verified archive and SHALL fail if it
exceeds 2.34. The extracted value and binary digest SHALL be retained as
release evidence.

The npm entrypoint SHALL detect the host glibc version before executing the
Linux bridge. It SHALL report both the fixed required version, 2.34, and the
detected version when the host is below the floor. npm's libc metadata is not
used because this universal package has no platform selector and npm cannot
express a glibc version constraint.

Validation SHALL include a positive test at glibc 2.34 and negative tests below
2.34, on musl, and on Linux ARM64.

#### Scenario: Linux glibc is too old

- **GIVEN** the Linux host reports glibc 2.33
- **WHEN** `herdr-world` is invoked
- **THEN** it exits before bridge execution and reports required 2.34 and
  detected 2.33

### 4.5 Homebrew Cask

The initial Homebrew distribution SHALL be one stable-only Cask in the
separate public third-party repository `IvoryHeart/homebrew-tap`. The
user-facing command SHALL be:

```bash
brew install --cask IvoryHeart/tap/herdr-world
```

The Cask SHALL select the immutable versioned GitHub release archive and
matching SHA-256 by OS and architecture:

| Target | Archive |
| --- | --- |
| macOS ARM64 | `herdr-world-vX.Y.Z-macos-arm64.tar.gz` |
| macOS x86-64 | `herdr-world-vX.Y.Z-macos-x86_64.tar.gz` |
| Linux x86-64 | `herdr-world-vX.Y.Z-linux-x86_64.tar.gz` |

It SHALL support only those three targets, explicitly reject unsupported
combinations, never use a moving `latest` URL, and expose only the existing
`herdr-world` archive launcher through the normal Cask `binary` mechanism.
The bridge SHALL not become a second command.

The initial Cask design SHALL not add a command wrapper, path environment
contract, downloader, daemon, or service-supervisor behavior. Cask validation
MUST prove that the direct `binary` mapping resolves the archive launcher and
continues to work after install, upgrade, reinstall, and removal of an older
version. If direct mapping demonstrably fails because of Caskroom path
resolution, implementation SHALL stop and request a later narrowly scoped
specification; it SHALL not silently add a workaround to this contract.

Cask installation SHALL preserve the archive's bridge, web assets,
documentation, and legal material. It SHALL not start Herdr or the bridge,
create or modify a workspace, or weaken the existing loopback, host, origin, or
security behavior.

The ordinary Cask SHALL remain stable-only. A prerelease Cask, if later needed,
MUST have a separate name and documented channel. Stable Cask publication is
also gated by the project's separate macOS signing, notarization, and
applicable Gatekeeper checks. That gate is release readiness policy; it does
not determine the package architecture.

#### Scenario: The Cask is installed

- **GIVEN** a supported target and a complete signed stable release
- **WHEN** `brew install --cask IvoryHeart/tap/herdr-world` runs
- **THEN** Homebrew verifies the selected immutable archive and checksum,
  installs only `herdr-world`, starts no process, and makes no workspace
  mutation

### 4.6 Homebrew tap update

After the complete GitHub release asset set is available and the signing gate
passes, a maintainer SHALL prepare a pull request in
`IvoryHeart/homebrew-tap`. The pull request SHALL update only the Cask version,
the three archive URLs, their three SHA-256 values, and reviewed Cask metadata
if required.

The maintainer SHALL run Cask audit/style and installation checks on each
available supported target. Human review SHALL be required before merge. The
tap SHALL be described as third-party and SHALL not be presented as reviewed,
endorsed, or official Homebrew software.

### 4.7 npm publication

The npm package SHALL be generated from the final verified release outputs.
Before publication, the maintainer SHALL:

1. create the package staging directory;
2. run `npm pack` and inspect the exact resulting `.tgz` file list and
   manifest;
3. install-test that exact `.tgz` on Linux x64, macOS ARM64, and macOS x64;
4. record its SHA-256; and
5. publish that same `.tgz` manually with standard npm authentication.

Prerelease application versions SHALL use the `next` dist-tag. Stable
versions SHALL use `latest`. A prerelease SHALL not move `latest`. OIDC and
CI publication automation, including staged publishing, are deferred until
the manual path has worked in practice.

npm package versions are immutable. If incorrect bytes are published, that
version SHALL not be reused; a later release SHALL use a new application
version.

### 4.8 Spec 016 independence

Spec 016 SHALL remain source-build-only. Installing or running the npm package
or Homebrew Cask SHALL not alter plugin ownership, plugin-managed service
lifecycle, or plugin state. Any future plugin mode that uses an external
distribution requires a separate explicit specification.

## 5. Release sequence

For a release intended for either package-manager distribution:

1. Build all three native archives from the final tag.
2. Verify archive contents, legal closure, native formats, checksums, and the
   existing stock-Herdr live smoke for all three targets.
3. Generate the single universal npm package from those verified outputs.
4. Pack, inspect, install-test, and hash the exact npm `.tgz`.
5. Manually publish the exact `.tgz` under `next` or `latest`, as
   appropriate.
6. After the complete immutable release assets and signing gate are available,
   prepare and review the manual Homebrew tap pull request.
7. Run Cask audit/style and install-test checks before merging the tap change.

A failed validation SHALL stop the sequence before publication. A failed or
uncertain npm publication SHALL be checked against the npm registry before a
manual retry; published bytes SHALL never be replaced or silently mutated.

## 6. Security properties

- npm and Homebrew installation SHALL not execute Herdr, a bridge, or a release
  downloader.
- The package-manager launchers SHALL preserve the existing loopback defaults
  and explicit host/origin behavior. These checks are not authentication.
- The npm package SHALL contain no publish credential, install-time network
  downloader, or executable exposed other than `herdr-world`.
- The third-party tap contains executable package definitions and SHALL be
  installed only with a fully qualified tap/item command after appropriate
  review.
- Release archives, the npm `.tgz`, and Cask checksums SHALL be retained as
  immutable release evidence.

## 7. Validation and acceptance

Implementation SHALL provide the following focused evidence:

- `npm pack` contains exactly the allowlisted universal package payload,
  including all three bridge paths and legal files;
- the package version, public metadata, repository, Node floor, and sole
  `herdr-world` command are correct;
- npm installs and selects the correct bridge on all three supported targets;
- unsupported OS, CPU, libc, missing bridge, and glibc-below-floor failures are
  actionable;
- `herdr-world --help` succeeds without Herdr, a workspace, or a bridge;
- arguments, stdio, signals, and child exit status are forwarded;
- the existing live bridge smoke passes against stock Herdr;
- the exact manually published `.tgz` is the one install-tested and hashed;
- `next` and `latest` are used only for their intended release classes;
- Cask audit/style checks pass;
- Cask installation, upgrade, reinstall, direct launcher invocation, and
  uninstall pass on every available supported target;
- Cask installation starts no process and changes no Herdr workspace;
- Cask URLs are immutable and checksums match;
- stable Cask publication is blocked until signing/notarization/Gatekeeper
  checks pass; and
- desktop tarball, Android, and Spec 016 behavior remain unchanged.

## 8. Rollout and deferred work

Before implementation, resolve ownership of the `@ivoryheart` scope and create
the public `IvoryHeart/homebrew-tap` repository. Implement and validate the
manual npm package and direct Cask against release-candidate fixtures without
changing desktop or Android outputs.

Publish the first npm package manually under `next` only after the exact
tarball has been installed and tested on the support matrix. Publish the stable
Cask only after its separate signing/readiness gate passes.

The following require a later specification or evidence-based extension:

- splitting npm native payloads into platform packages;
- OIDC, CI, or staged npm publication;
- Cask path adaptation if direct `binary` mapping fails;
- a separately named prerelease Cask;
- Homebrew formulas or official Homebrew submission;
- additional platform/libc support; and
- plugin reuse of an external package-manager installation.

## 9. References

- [Distribution analysis](../analysis/npm-homebrew-distribution-analysis-2026-08-28.md)
- [Spec 016](016-herdr-world-plugin-release-spec.md)
- [Packaging documentation](../packaging.md)
- [Release documentation](../release.md)
- [npm package.json fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew taps](https://docs.brew.sh/Taps)
- [Homebrew acceptable Casks](https://docs.brew.sh/Acceptable-Casks)
- [Homebrew Tap Trust](https://docs.brew.sh/Tap-Trust)
