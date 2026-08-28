# Herdr World npm and Homebrew distribution

- **Spec ID:** `017-herdr-world-npm-homebrew-distribution`
- **Status:** Draft
- **Created:** 2026-08-28
- **Owner:** IvoryHeart
- **Reviewers:** —
- **Approved by:** —
- **Approved at:** —

This is a standalone distribution contract related to, but independent from,
[Spec 016](016-herdr-world-plugin-release-spec.md). Its primary research input
is the [npm and Homebrew distribution analysis](../analysis/npm-homebrew-distribution-analysis-2026-08-28.md).
It does not extend the Herdr plugin lifecycle contract.

## 1. Purpose

Herdr World currently has verified desktop release archives that contain the
native bridge, the web application, the launcher, documentation, and legal
assets. This specification defines how users will obtain the same application
through npm and Homebrew without creating a second native-build truth or an
implicit dependency on either package manager.

The outcome is:

- one public npm launcher package with one exact-version optional native
  package for each supported target; and
- one stable-only Homebrew Cask in the separate public third-party tap
  `IvoryHeart/homebrew-tap`.

Both distributions SHALL remain compatible with the existing Herdr admission,
loopback, browser-origin, and terminal-protocol behavior. Installation SHALL
install files only. It SHALL not install Herdr, start a bridge, create a
workspace, or silently alter Herdr state.

## 2. Scope

This specification includes:

- the verified-release-archive source boundary and common-payload identity
  check;
- the four-package npm topology, metadata, package contents, launcher, and
  platform selection behavior;
- the Linux glibc compatibility contract;
- npm prerelease/stable channels, first-publication bootstrap, subsequent
  staged publishing, and partial-publication recovery;
- the binary-first Homebrew Cask shape, tap update contract, Caskroom path
  handling, and stable/signing gate;
- the relationship between these standalone distributions and the source-build
  only initial plugin design in Spec 016;
- release sequencing, security properties, validation, rollout, and observable
  failure states.

The initial supported package-manager targets are:

| Operating system | CPU | Native archive | npm package |
| --- | --- | --- | --- |
| Linux | x86-64 | `linux-x86_64` | `@ivoryheart/herdr-world-linux-x64-gnu` |
| macOS | ARM64 | `macos-arm64` | `@ivoryheart/herdr-world-darwin-arm64` |
| macOS | x86-64 | `macos-x86_64` | `@ivoryheart/herdr-world-darwin-x64` |

Homebrew SHALL support exactly the same three target combinations. npm and
Homebrew SHALL reject or fail clearly on every other combination.

## 3. Non-goals

The following are explicitly outside this specification:

- changing the existing desktop tarball names, layout, launcher defaults, or
  validation contract;
- changing Android packaging or the Android companion client;
- changing the Herdr plugin lifecycle, plugin manifest, plugin-managed service
  ownership, or Spec 016's initial source-build-only design;
- making the plugin discover or reuse an npm/Homebrew installation;
- a plugin binary-first or external-installation mode;
- Linux ARM64, musl-based Linux, Windows, or any other unsupported target;
- a source-building Homebrew formula;
- a binary Homebrew formula;
- submission to Homebrew/core or the official Homebrew Cask repository;
- a prerelease Homebrew Cask channel;
- an npm install-time release downloader;
- implementation of package generation, npm publication, tap automation,
  release-workflow changes, or launcher changes in this specification task;
- macOS signing/notarization implementation. The stable Cask publication gate
  defined here depends on that work being completed separately.

## 4. Context and constraints

### 4.1 Existing release boundary

The verified GitHub release archives produced by the existing desktop release
process are the native source of truth. For each target, the archive contains
the bridge binary and the common launcher/web/documentation/legal payload. npm
and Homebrew SHALL reuse the bridge binary from the corresponding verified
archive.

After an archive passes release validation, package-manager generation MUST NOT
compile another native bridge from source, select a bridge from an unverified
build, or download a bridge during package installation. A package-manager
artifact MAY re-layout files from a verified archive, but it SHALL not change
the native payload.

The desktop tarballs and Android packaging remain independent products. Adding
the package-manager distributions SHALL not require their layout or behavior to
change.

### 4.2 Release versions

The application version is derived from `release.json` using exactly one
transformation: remove one leading `v`. For example,
`{"current":"v0.1.0-rc.1"}` produces `0.1.0-rc.1`. No other prefix, suffix, or
prerelease component SHALL be removed or rewritten.

The root `package.json` and `web/package.json` remain private development
manifests. They SHALL not become the published npm manifests and their
versions SHALL not be changed merely to publish a distribution.

### 4.3 Runtime and compatibility baseline

The npm launcher runtime is Node.js. The initial supported Node floor is
`22.14.0`; the main package SHALL declare `engines.node: ">=22.14.0"`. The
release and trusted/staged publishing jobs SHALL use Node `22.14.0` or newer.

The current `v0.1.0-rc.1` Linux bridge requires symbols through
`GLIBC_2.34`. Unless a separate, approved effort deliberately lowers the
native baseline, glibc `2.34` is the minimum Linux runtime contract.

npm's `libc: ["glibc"]` metadata expresses the libc family. It does not
express or enforce a glibc version. The npm launcher therefore has an
independent version preflight.

The application still requires a separately installed compatible Herdr
session, Herdr `v0.8.2` or newer, and terminal protocol `20`, as described by
the existing packaging and release documentation.

## 5. Requirements

### Requirement: Verified archive reuse

The release system SHALL build all three native archives from the final tag and
shall verify each archive's contents, legal closure, native format, and
checksum before any npm or Homebrew artifact is generated.

The release system MUST fail if package generation attempts to use a native
binary that is not byte-identical to the bridge extracted from its matching
verified archive.

#### Scenario: A second native build is attempted

- **GIVEN** the three tagged desktop archives have passed validation
- **WHEN** package generation is invoked
- **THEN** generation extracts the matching bridge from those archives and does
  not run a second native build

### Requirement: Common payload identity

Before generating npm packages, release validation SHALL compare the common
payload in all three verified archives. The comparison SHALL normalize away
only the archive's platform-specific root directory and exclude only the
platform-specific bridge binary.

The common payload is the byte content and relative path set for:

- the shared launcher;
- the complete bundled `share/herdr-world/web/` tree;
- the runtime documentation included by the desktop archive;
- `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `UPSTREAM.md`;
- the complete applicable `docs/`, `third_party/`, and legal/inventory trees.

The validator SHALL produce a canonical sorted manifest mapping every common
relative path to its SHA-256 digest, compare those manifests, and SHALL fail on
a missing, additional, or different common file or digest. This manifest is the
release proof that the common payload is byte-identical. One designated
verified archive, `linux-x86_64`, SHALL supply the common npm payload after this
check succeeds.
The designation is a source-selection convenience; it does not relax the
identity check.

#### Scenario: A platform build changes a common file

- **GIVEN** all three native archives pass their individual checks
- **WHEN** the common-payload comparison finds different web, launcher,
  documentation, or legal bytes
- **THEN** npm generation stops, no package is publishable, and the release is
  reported as blocked pending a reproducible payload fix

### Requirement: Main npm package identity and topology

The published npm packages SHALL have exactly these names:

```text
@ivoryheart/herdr-world
@ivoryheart/herdr-world-linux-x64-gnu
@ivoryheart/herdr-world-darwin-arm64
@ivoryheart/herdr-world-darwin-x64
```

Ownership and publication control of the `@ivoryheart` scope is an external
publication prerequisite. Package names SHALL be selected and checked as part
of bootstrap; the workflow SHALL not publish placeholder packages merely to
occupy names.

The main package SHALL:

- be public and non-private;
- declare `publishConfig` with `access: "public"` and
  `registry: "https://registry.npmjs.org/"`;
- declare only one executable mapping, `herdr-world`;
- contain the shared launcher, the common web assets, runtime documentation,
  and all common/applicable legal material;
- declare all three platform packages in `optionalDependencies` at the exact
  same application version;
- use an explicit `files` allowlist;
- derive its version from `release.json` by removing only the leading `v`;
- declare `engines.node: ">=22.14.0"`; and
- use repository metadata resolving exactly to
  `https://github.com/IvoryHeart/herdr-world`.

The generated package metadata SHALL be staged separately from the private
root and web development manifests. It SHALL not publish the repository root,
source-only dependencies, Rust targets, Android outputs, tests, CI files, or
an arbitrary `node_modules` tree.

The main and platform package manifests SHALL not use `preinstall` or
`postinstall` to download release assets or otherwise create a second native
payload. Native bridge bytes SHALL arrive only as the already inspected
platform package tarball.

#### Scenario: Main package metadata is inspected

- **GIVEN** a package has been generated from `v0.1.0-rc.1`
- **WHEN** its `package.json` is inspected
- **THEN** its version is `0.1.0-rc.1`, its repository identifies
  `IvoryHeart/herdr-world`, its access is public, its only `bin` key is
  `herdr-world`, and all three optional dependencies are exactly `0.1.0-rc.1`

### Requirement: Platform npm package contents and selectors

Each platform package SHALL contain only:

- the matching bridge binary extracted from its verified desktop archive;
- generated package metadata required for launcher preflight; and
- the complete legal material applicable to that bridge payload, including the
  project license, native dependency inventory, notices, and referenced license
  files.

The existing desktop legal closure SHALL be copied without path or content
rewriting into every npm package that carries `THIRD_PARTY_NOTICES.md`. This
closure includes `LICENSE`, `THIRD_PARTY_NOTICES.md`, `UPSTREAM.md`,
`docs/world-assets.md`, `vendor/herdr-compat/VENDOR-MANIFEST.toml`, the
complete `third_party/**` trees, and the bundled web legal files. In a platform
package, web legal files are legal-only material; the web runtime tree is not
included. Package generation SHALL not introduce a package-specific notice
splitting system.

Each platform package SHALL have an explicit `files` allowlist and SHALL have
the same application version as the main package. It SHALL declare exact
selectors as follows:

| Package | `os` | `cpu` | `libc` |
| --- | --- | --- | --- |
| `@ivoryheart/herdr-world-linux-x64-gnu` | `linux` | `x64` | `glibc` |
| `@ivoryheart/herdr-world-darwin-arm64` | `darwin` | `arm64` | not applicable |
| `@ivoryheart/herdr-world-darwin-x64` | `darwin` | `x64` | not applicable |

The platform packages MUST NOT declare a `bin` mapping and MUST NOT expose
`herdr-world-bridge` as a global command. The bridge SHALL be stored at the
exact implementation path `native/herdr-world-bridge`, and the main launcher
SHALL resolve that path through package metadata, not by a current-working-
directory guess.

#### Scenario: A platform tarball is inspected

- **GIVEN** the Linux platform package is unpacked
- **WHEN** its file list and metadata are checked
- **THEN** it contains its x86-64 bridge, generated package metadata, and
  complete applicable legal closure, declares `os: ["linux"]`, `cpu: ["x64"]`,
  `libc: ["glibc"]`, has no `bin` mapping, and contains no web runtime or
  launcher payload beyond legal-only files

### Requirement: Explicit npm file boundaries

The generated main and platform package manifests SHALL use explicit
`files` allowlists. Package generation SHALL reject an allowlist that includes
unreviewed build output, an install script, a release downloader, credentials,
or files outside the intended package boundary.

`npm pack --dry-run` SHALL be treated as a release check. The checked file list
SHALL be recorded with the package version and tarball hash before publication.

Every published package SHALL be independently auditable for its payload's
legal closure. A legal manifest SHALL not reference a file absent from that
package, and every applicable native or web dependency notice SHALL be present
in the package that carries the dependency.

### Requirement: npm platform resolver

The `herdr-world` npm launcher SHALL select the platform package using
`process.platform`, `process.arch`, and Linux libc information. The supported
selection table is:

| `process.platform` | `process.arch` | libc result | Selected package |
| --- | --- | --- | --- |
| `linux` | `x64` | glibc at or above 2.34 | `@ivoryheart/herdr-world-linux-x64-gnu` |
| `darwin` | `arm64` | not applicable | `@ivoryheart/herdr-world-darwin-arm64` |
| `darwin` | `x64` | not applicable | `@ivoryheart/herdr-world-darwin-x64` |

The launcher SHALL reject Linux ARM64, Linux musl, Windows, and every other
unsupported operating-system/architecture/libc combination before attempting
to execute a bridge. Linux x64 with glibc below 2.34 SHALL receive a distinct
minimum-version error.

The launcher SHALL resolve the installed optional package using Node package
resolution from the main package's own module location. It MUST NOT infer a
global npm prefix, search the current working directory, or depend on the
user's `PATH` to find the native package. A missing package, an optional
dependency omitted with `--omit=optional`, or a package whose installation was
skipped or failed SHALL produce an actionable error naming the selected
package, detected target, and a corrective installation command.

#### Scenario: Optional dependencies are omitted

- **GIVEN** the main package is installed with `npm install --omit=optional`
- **WHEN** `herdr-world` is invoked on a supported host
- **THEN** it exits nonzero with a clear missing-optional-package diagnostic,
  names the exact platform package, and does not start Herdr or a bridge

### Requirement: Shared-launcher path contract

The shared launcher SHALL support these exact environment variables:

| Variable | Contract |
| --- | --- |
| `HERDR_WORLD_BRIDGE_BIN` | Absolute path to the bridge executable |
| `HERDR_WORLD_STATIC_DIR` | Absolute path to the static web directory |
| `HERDR_WORLD_REQUIRED_GLIBC` | Optional package-manager ABI value in `major.minor` form on Linux |

The npm launcher SHALL set all three values that apply before invoking the
shared launcher. The Homebrew wrapper SHALL set the two absolute paths and the
declared Linux ABI value when running on Linux. Existing desktop tarball calls
with these variables unset SHALL retain the current relative-bundle behavior.

If either path variable is set, both path variables MUST be set. Each path
MUST be absolute, MUST exist at invocation time, and MUST have the expected
type: the bridge MUST be a regular executable file and the static path MUST be
a directory containing the packaged web entrypoint. A supplied required-glibc
value MUST be syntactically valid and match the generated Linux package
metadata or the Cask's recorded release value. Missing, invalid, relative,
nonexistent, or type-incompatible paths
SHALL fail closed before any bridge or Herdr process is started. The launcher
MUST NOT resolve an invalid path relative to the current working directory.

The override contract is intentionally narrow: it supplies only the bridge,
static directory, and ABI preflight inputs. It SHALL not replace Herdr socket,
workspace, host, origin, or security-policy settings.

#### Scenario: A Cask symlink is invoked after an upgrade

- **GIVEN** Homebrew's `herdr-world` symlink points into a versioned Caskroom
  directory
- **WHEN** the command is run after install, upgrade, or reinstall
- **THEN** the wrapper resolves the active staged bridge and static directory
  explicitly, validates both absolute paths, and serves assets from that same
  version without using the caller's working directory

### Requirement: npm launcher process behavior

The npm launcher SHALL:

- preserve every user argument in order and without shell re-parsing;
- preserve standard input, standard output, and standard error;
- forward relevant termination signals to the child bridge/launcher and avoid
  leaving an orphaned child;
- return the child's successful exit status unchanged;
- return a deterministic nonzero status and useful diagnostic for launcher
  preflight failures; and
- avoid starting Herdr onboarding, selecting a workspace, or starting a
  listening bridge for `herdr-world --help`.

For `--help` (including the documented short help form, if supported), the npm
entrypoint SHALL print its usage and exit without spawning the bridge. Help
output SHALL be available without a running Herdr session or installed
optional native package, so an omitted optional dependency does not turn help
into an opaque native-loader error.

#### Scenario: Arguments and signals are forwarded

- **GIVEN** a supported npm installation and a running compatible Herdr
- **WHEN** a user passes arbitrary supported bridge arguments, types on stdin,
  and sends an interrupt or termination signal
- **THEN** the child receives the same arguments and standard streams, receives
  the signal once, and `herdr-world` exits with the child's resulting status

#### Scenario: Help is requested

- **GIVEN** no running Herdr session and no optional native package
- **WHEN** the user runs `herdr-world --help`
- **THEN** usage is printed, the command exits successfully, and neither Herdr
  onboarding nor a bridge process is started

### Requirement: Linux glibc release check

For the Linux x86-64 bridge, release validation SHALL extract the maximum
required GLIBC symbol version from the exact binary copied from the verified
archive. The check SHALL fail if the maximum required version exceeds the
declared baseline `2.34`, and SHALL write the verified requirement into the
Linux platform package metadata.

The check SHALL fail closed if the ELF version information cannot be read. It
SHALL not infer compatibility only from the build host's glibc version. The
release evidence SHALL include the extracted maximum symbol, declared minimum,
binary digest, and target archive digest.

#### Scenario: A bridge requires a newer glibc

- **GIVEN** the extracted Linux binary contains a requirement such as
  `GLIBC_2.35`
- **WHEN** the release ABI check runs with baseline `2.34`
- **THEN** release validation fails before npm or Homebrew generation and the
  binary is not publishable

### Requirement: Linux glibc launcher preflight

Before executing the Linux bridge, the npm launcher SHALL detect the host's
actual glibc version and compare it with the required version from the
generated Linux platform package metadata. It SHALL report both the required
and detected versions before execution when the preflight is evaluated.

The preflight SHALL distinguish:

- glibc below `2.34`, with required and detected versions in the error;
- glibc at `2.34`, which is supported;
- glibc above `2.34`, which is supported subject to the other checks; and
- musl or an unidentifiable libc, which is unsupported for this package.

The Homebrew Linux wrapper SHALL provide the same preflight result before
executing the Cask bridge. No path or libc error SHALL fall through to an
opaque native dynamic-loader failure.

The release validation SHALL include positive execution at the 2.34 floor and
negative execution below the floor. It SHALL also test clear Linux ARM64 and
musl rejection. The npm `libc` selector remains a package-install filter only;
these runtime checks are mandatory.

### Requirement: npm channels and version set

All four packages SHALL use one identical application version and one intended
publication channel for a release set:

- prerelease versions SHALL use the `next` dist-tag;
- stable versions SHALL use the `latest` dist-tag; and
- a prerelease SHALL never move or overwrite `latest`.

The publication command or staged approval SHALL pass the intended tag
explicitly. A package set with mixed versions or mixed intended channels SHALL
be rejected before publication.

### Requirement: First-publication bootstrap

The release process SHALL recognize that trusted publishing and staged
publishing require a package that already exists. They cannot be configured as
the mechanism for creating all four package names for the first time.

The first publication SHALL be the first real prerelease, not a placeholder.
It SHALL use an operator-authenticated npm workflow with 2FA. Before the first
publish call, the process SHALL:

1. generate all four package tarballs from the verified release assets;
2. inspect each tarball's exact file list and metadata;
3. install-test each tarball on its applicable target;
4. record a cryptographic hash for each tarball and the release evidence; and
5. confirm scope ownership, package-name availability, and the `next` channel.

The three platform packages SHALL publish first, in any deterministic order,
and the main launcher package SHALL publish last. Bootstrap SHALL not use a
long-lived token stored in the repository or workflow.

Immediately after all four packages exist, trusted publishing SHALL be
configured separately for every package. Each configuration SHALL identify the
exact `IvoryHeart/herdr-world` repository and exact release workflow. The
configuration SHALL grant stage-only permission where npm supports it.

#### Scenario: Bootstrap is attempted before scope ownership

- **GIVEN** the `@ivoryheart` scope is not controlled by the project
- **WHEN** bootstrap validation runs
- **THEN** publication stops as an external prerequisite failure and no
  placeholder package is published

### Requirement: Subsequent trusted staged publishing

After bootstrap, the release workflow SHALL use GitHub-hosted OIDC trusted
publishing for every package. It SHALL:

- run with `id-token: write`;
- use Node `22.14.0` or newer and npm `11.15.0` or newer;
- use the exact configured repository and workflow for each package;
- grant only stage publishing permission where supported;
- invoke `npm stage publish` for all four packages;
- download and inspect the actual staged tarball for every package before
  approval;
- require human 2FA approval of all three platform stages before approving the
  launcher stage; and
- use no long-lived npm publishing token.

The stage tag and package/version identity SHALL be recorded with every
downloaded staged tarball. Approval SHALL be refused if the downloaded bytes,
metadata, file list, or hash differ from the pre-stage inspected tarball.

The workflow SHALL not assume that a stage is available for a package that has
never been published. A missing-package response SHALL select the bootstrap
path and stop the staged path safely.

#### Scenario: A staged tarball differs from the inspected tarball

- **GIVEN** a package has been staged through trusted publishing
- **WHEN** the downloaded staged tarball does not match the pre-recorded hash
- **THEN** approval is refused, the release is marked failed, and no retry
  SHALL replace or mutate either tarball silently

### Requirement: npm partial-publication recovery

npm publication of four packages SHALL be modeled as a non-atomic state
machine. npm's registry and staged-publishing records SHALL remain the
authoritative publication state. The release process SHALL emit an
operator-visible status projection for each attempt, such as a CI summary or
release artifact, containing the application version, channel, package states,
tarball hashes, stage identifiers where applicable, and the next safe action.
This projection SHALL not become a second publication database and SHALL not
record credentials.

The status projection SHALL report these observable states:

| State | Meaning | Safe next action |
| --- | --- | --- |
| `prepared` | All four tarballs inspected, tested, and hash-recorded | Start bootstrap or stage platform packages |
| `platform-pending` | Platform stages are being inspected or await human 2FA approval | Inspect/approve platform stages only |
| `platform-published` | All three exact platform versions exist and match hashes | Stage/approve the launcher |
| `launcher-pending` | The launcher stage is being inspected or awaits approval | Inspect/approve the launcher stage |
| `partial` | A publication result is unknown or only part of the intended set is live | Query npm and resume only missing packages with identical tarballs |
| `complete` | All four live versions exist with matching hashes and tag | Prepare the eligible tap PR |
| `burned` | A wrong byte set was published for this version | Advance the complete set to a new application version |

A validation or external-prerequisite failure before publication SHALL be
reported as `blocked` with its reason and safe remediation; it is not a new
npm registry state.

Before the launcher package is published, all three platform package names
SHALL exist at the exact application version with the inspected bytes. The
launcher SHALL never be published first.

A transient failure before a package version is published MAY retry the
identical inspected tarball. If a package is already live with correct bytes,
the process SHALL resume the missing package and SHALL not republish or mutate
the existing package. If incorrect bytes are published for any package, that
application version is burned permanently and the complete four-package set
MUST advance to a new application version. The process SHALL never create
divergent package versions to repair one member of the set.

An incorrect staged package that has not been approved MAY be rejected; any
replacement stage SHALL be newly generated, re-inspected, and explicitly
associated with the same version without silently overwriting the rejected
stage. Once incorrect bytes are live, the `burned` rule applies.

#### Scenario: A platform publication times out

- **GIVEN** the platform tarball was inspected and its publication result is
  unknown
- **WHEN** the registry cannot immediately confirm whether the exact version is
  live
- **THEN** the release enters `partial` or an equivalent unknown substate,
  queries the registry before retrying, and either resumes the missing package
  with the identical hash or stops for operator reconciliation

#### Scenario: One package has wrong live bytes

- **GIVEN** one package at version `0.1.0-rc.1` is live with bytes that do not
  match the inspected tarball
- **WHEN** release reconciliation detects the mismatch
- **THEN** version `0.1.0-rc.1` is marked `burned`, no package at that version is
  replaced, and the next release advances all four packages together

### Requirement: Homebrew third-party Cask

The initial Homebrew distribution SHALL be a Cask in the separate public
third-party repository `IvoryHeart/homebrew-tap`. The stable user-facing
command SHALL be:

```bash
brew install --cask IvoryHeart/tap/herdr-world
```

The Cask SHALL use the existing immutable GitHub release archives and select
the URL and SHA-256 by OS and architecture:

| Target | Archive URL pattern |
| --- | --- |
| macOS ARM64 | `herdr-world-vX.Y.Z-macos-arm64.tar.gz` |
| macOS x86-64 | `herdr-world-vX.Y.Z-macos-x86_64.tar.gz` |
| Linux x86-64 | `herdr-world-vX.Y.Z-linux-x86_64.tar.gz` |

The Cask SHALL derive URLs from an immutable versioned release tag and SHALL
never use a moving `latest` URL or omit a checksum. It SHALL explicitly reject
Linux ARM64, musl, Windows, and other unsupported combinations. It SHALL
expose only `herdr-world`; `herdr-world-bridge` SHALL not become a second
global command.

The installed Cask SHALL preserve the staged bridge, web assets,
documentation, and legal material. Installation SHALL not execute Herdr, the
bridge, or a network-time release downloader, and SHALL not create, select, or
modify a Herdr workspace. The Cask SHALL not act as a service supervisor.

The Cask command path SHALL use the explicit shared-launcher path contract or a
narrowly scoped Cask command wrapper. It SHALL not assume that a Homebrew
symlink's current directory is the Caskroom directory. The path solution SHALL
continue to work after upgrade, reinstall, and removal of an older Cask
version. Uninstall SHALL remove only the Cask-owned files and SHALL not delete
unrelated plugin state.

The tap SHALL be described as third-party. It SHALL not be described as
reviewed, endorsed, or official Homebrew software. Documentation SHALL explain
that third-party tap definitions execute with user privileges and that a
fully-qualified item install limits the requested trust scope.

#### Scenario: Cask installation is observed

- **GIVEN** a supported target and a complete signed/stable release asset set
- **WHEN** `brew install --cask IvoryHeart/tap/herdr-world` runs
- **THEN** Homebrew verifies the selected immutable archive and SHA-256,
  installs one `herdr-world` command with its bridge and web assets, starts no
  daemon, and makes no Herdr workspace mutation

### Requirement: Homebrew channel and signing gate

The ordinary `herdr-world` Cask SHALL be stable-only. It SHALL not point at an
RC or other prerelease archive. A prerelease Cask, if ever required, SHALL be a
separately named and deliberately documented channel; it is not part of this
initial specification.

The stable Cask SHALL not be published or merged until the macOS artifacts are
signed and notarized and pass the applicable Gatekeeper checks. Cask
implementation and local validation MAY use release-candidate fixtures before
that gate, but such fixtures SHALL not be presented as a stable publication.

### Requirement: Reviewed tap pull request

After the complete GitHub release asset set is available and the stable
signing gate passes, a maintainer SHALL prepare a pull request in
`IvoryHeart/homebrew-tap` from the verified release data. The initial process
MAY be manual. The change SHALL update only the release version, three target
URLs, and three corresponding SHA-256 values, plus any reviewed metadata
required by the Cask.

The pull request SHALL run Homebrew Cask audit/style and installation checks
for macOS ARM64, macOS x86-64, and Linux x86-64 where those Homebrew targets
are available. A human review SHALL be required before merge.

Bot or GitHub App automation is deferred for the initial release. If it is
introduced later, it SHALL use narrowly scoped credentials limited to the
required tap pull-request operation. The source repository SHALL not hold an
unrestricted credential capable of rewriting the tap. A pull request SHALL not
be prepared from a partial GitHub release asset set.

#### Scenario: The release has one missing archive

- **GIVEN** the release tag exists but one of the three archives or checksums is
  missing or unverifiable
- **WHEN** a tap PR is requested
- **THEN** no tap PR is prepared and the release status names the missing asset

### Requirement: Plugin independence

Spec 016's initial plugin design SHALL remain source-build-only. The plugin
MUST NOT:

- discover or use an npm or Homebrew installation implicitly;
- depend on npm, Homebrew, or a package-manager-specific layout;
- assume that `herdr-world` is on `PATH`;
- delegate plugin-managed bridge/service ownership to Homebrew; or
- pair a plugin controller with an externally installed bridge without an
  explicit contract.

The existing plugin SHALL continue to own or explicitly configure its source
build, bridge, static assets, Herdr socket, and service lifecycle as defined by
Spec 016. A future external-installation or binary-first plugin mode SHALL
require a later specification defining explicit path, version, asset-pairing,
and lifecycle validation.

#### Scenario: Both distribution types are installed

- **GIVEN** a user has an npm or Homebrew Herdr World installation and the
  source-build plugin is installed
- **WHEN** the plugin starts or manages its bridge
- **THEN** it uses its Spec 016 source-build contract and does not discover,
  select, or delegate lifecycle ownership to either external installation

## 6. Data and interface contract

### 6.1 Generated npm package layout

The generated main package SHALL have this package-owned layout (in addition to
the required npm metadata):

```text
package.json
README.md
bin/herdr-world
share/herdr-world/web/**
docs/**
LICENSE
THIRD_PARTY_NOTICES.md
UPSTREAM.md
third_party/**
vendor/herdr-compat/VENDOR-MANIFEST.toml
```

The exact allowlist MAY be narrower, but it SHALL contain the complete runtime
web tree, launcher support files, documentation, and legal closure. It SHALL
not contain a native bridge binary.

Each platform package SHALL have this package-owned layout:

```text
package.json
README.md
native/herdr-world-bridge
LICENSE
THIRD_PARTY_NOTICES.md
UPSTREAM.md
docs/world-assets.md
share/herdr-world/web/legal/**
third_party/**
vendor/herdr-compat/VENDOR-MANIFEST.toml
```

Each platform `package.json` SHALL include a generated `herdrWorld` metadata
object containing the fixed bridge path `native/herdr-world-bridge` and, for
Linux, the required glibc version `2.34`. The Linux value SHALL be generated
from and checked against the verified bridge; it is not user input. Bridge
hashes remain release evidence rather than runtime configuration.

### 6.2 Package version and dependency contract

For an application version `A`, all package manifests SHALL satisfy:

```text
main.version = A
platform.version = A
main.optionalDependencies[platform] = A
```

The dependency ranges SHALL be exact strings, not caret, tilde, wildcard, or
latest ranges. A launcher version mismatch between its own package and the
selected platform package SHALL be an actionable nonzero failure before bridge
execution.

### 6.3 Launcher diagnostics

Launcher errors SHALL identify the failed class, detected values, and the safe
next action. At minimum, diagnostics SHALL distinguish:

- unsupported operating system;
- unsupported CPU architecture;
- Linux ARM64;
- musl or unknown libc;
- glibc below `2.34`, including required and detected versions;
- missing or omitted optional platform package;
- failed optional-package installation;
- main/platform package or generated platform metadata mismatch;
- invalid, missing, relative, nonexistent, or wrong-type path override; and
- bridge execution or child-process failure.

Diagnostics SHALL not print authentication tokens, private paths unrelated to
the package, or arbitrary environment contents.

## 7. Privacy and security

### 7.1 Installation and runtime boundaries

Neither npm nor Homebrew installation SHALL create a Herdr workspace, select a
Herdr session, start a daemon, or change bridge security configuration. The
launcher SHALL preserve the existing loopback defaults and explicit host/origin
configuration rules. These checks are compatibility and browser-admission
controls; they are not a substitute for authentication.

The package-manager launchers SHALL pass only explicit package-owned paths to
the shared launcher. They SHALL not use the current directory, a guessed npm
prefix, an ambient global executable, or an untrusted path from a Cask symlink
without validation.

### 7.2 Publication credentials and immutability

npm package name/version contents are immutable after publication. All tarballs
MUST be inspected, install-tested, and hash-recorded before bootstrap or
staging. Subsequent publication SHALL use short-lived GitHub OIDC trusted
publishing and no long-lived npm token.

Stage-only permission SHALL be preferred for trusted publishers. Human 2FA
approval is the boundary that makes a staged package live, with platform
packages approved before the launcher package.

If Homebrew tap automation is introduced, it SHALL use least-privilege
credentials and pull requests with review. The initial maintainer-prepared tap
PR SHALL be based on the same verified release data. A tap update SHALL be
impossible to prepare from an incomplete or unverified release asset set.

### 7.3 Supply-chain evidence

Release evidence SHALL retain, at minimum:

- each native archive SHA-256 and verified file manifest;
- the common-payload identity result;
- each bridge SHA-256 and native-format result;
- the extracted maximum Linux GLIBC symbol and declared baseline;
- each npm tarball SHA-256 and `npm pack --dry-run` file list;
- staged tarball hashes and stage identifiers, when applicable;
- publication status for each package; and
- the three Homebrew archive SHA-256 values used by the reviewed Cask PR.

## 8. Release mechanics

### 8.1 Required sequence

For every release set, the release operator or trusted workflow SHALL execute
these steps in order:

1. Build all three native archives from the final tag.
2. Verify contents, legal closure, native format, and checksum for every
   archive.
3. Run the stock-Herdr live smoke for all three targets.
4. Verify common-payload byte identity across all three archives.
5. Upload and verify the complete immutable GitHub release asset set.
6. Generate all four npm package tarballs from the verified assets, using the
   designated common-payload archive.
7. Inspect and install-test all npm tarballs, and record their hashes.
8. Bootstrap-publish or stage/approve the npm package set according to whether
   the package names already exist.
9. Prepare a reviewed Homebrew tap PR from the verified release data when the
   stable and signing gates are satisfied.
10. Install-test the resulting Cask from the tap on every supported target.

No later step SHALL make an earlier validation step implicit. In particular,
uploading a GitHub archive does not make an npm tarball trusted, and a
successful npm publication does not make a Cask eligible before signing and
review.

### 8.2 External publication boundaries and retries

Each external boundary SHALL expose a durable observable result:

| Boundary | Success evidence | Safe retry |
| --- | --- | --- |
| GitHub assets | All three archives and checksums resolve and match recorded hashes | Re-query/re-upload only the missing asset; never replace an immutable asset |
| npm bootstrap | Each live package version resolves and matches the inspected tarball | Query first; publish only a missing package with the identical tarball |
| npm stage | Stage identifier and downloaded bytes match the inspected tarball | Resume or reject the exact stage; never silently overwrite it |
| npm approval | Registry shows the exact approved package/version/hash | Approve an outstanding exact stage or stop for reconciliation |
| Tap PR | PR contains only reviewed version/URL/checksum changes and passes checks | Regenerate a new PR from the same immutable release data |
| Cask install | Brew fetch/checksum/install/uninstall checks pass | Fix or close the PR; never point stable Cask at mutable data |

An unknown result SHALL be reconciled against the external registry or GitHub
state before retry. A retry SHALL not assume that a timeout means “not
published.”

## 9. Validation and acceptance evidence

Implementation SHALL provide automated tests and release evidence for the
following scenarios.

### 9.1 npm package and launcher matrix

- exact main and platform package contents and `files` allowlists;
- package names, public metadata, repository, versions, selectors, exact
  optional dependency versions, and only the permitted command;
- optional dependency selection on Linux x64, macOS ARM64, and macOS x64;
- `npm install --omit=optional` and a simulated optional-install failure;
- unsupported OS, CPU, Linux ARM64, musl, and unknown libc;
- glibc below 2.34, exactly 2.34, and above 2.34;
- maximum GLIBC symbol extraction and release failure above the baseline;
- missing or mismatched native package/generated platform metadata;
- invalid, relative, missing, nonexistent, and wrong-type path overrides;
- argument, standard-input/output/error, signal, and exit-status forwarding;
- `herdr-world --help` with no Herdr and no native package;
- live smoke against stock Herdr using the packaged bridge;
- loopback and existing bridge security defaults;
- common-payload path-set and byte identity;
- legal closure in the main and every platform tarball;
- `next` for prereleases and `latest` for stable versions;
- first-publication bootstrap, including operator 2FA and platform-first order;
- trusted staged publishing with npm 11.15.0+ and Node 22.14.0+;
- downloaded staged tarball inspection and platform-before-launcher approval;
- timeout, retry, partial publication, burned version, and no-mutation recovery.

### 9.2 Homebrew matrix

- Cask audit and style checks;
- immutable URL and SHA-256 selection for all three supported targets;
- explicit rejection of Linux ARM64, musl, Windows, and other unsupported
  combinations;
- Cask install, upgrade, reinstall, and uninstall on macOS ARM64, macOS x64,
  and Linux x64 where Homebrew targets are available;
- command exposure limited to `herdr-world`;
- Caskroom/symlink path resolution after install and upgrade;
- live bridge smoke separately from installation's no-daemon check;
- no bridge/Herdr process, workspace creation, or workspace mutation during
  installation;
- no service-supervisor behavior;
- third-party tap trust/documentation behavior;
- signed/notarized macOS assets and applicable Gatekeeper checks before stable
  publication; and
- stable Cask never resolving to an RC archive.

### 9.3 Unchanged-product checks

The release acceptance run SHALL confirm that:

- existing desktop tarball names, layout, default launcher behavior, and
  stock-Herdr smoke remain compatible, with the current verifier continuing to
  pass when package-manager overrides are unset; future release checksums may
  of course differ when release bytes change;
- Android packaging and client behavior remain unchanged; and
- Spec 016 plugin installation, source-build behavior, and plugin-managed
  lifecycle remain unchanged and do not discover package-manager installs.

## 10. Rollout and operations

Rollout SHALL occur in these gates:

1. Resolve external ownership prerequisites: control of `@ivoryheart`, public
   creation of `IvoryHeart/homebrew-tap`, and signing/notarization readiness
   for stable macOS Cask publication.
2. Implement and validate package generation against release-candidate fixtures
   without changing desktop or Android outputs.
3. Perform the first real npm prerelease bootstrap with operator-authenticated
   2FA, platform packages first and launcher last.
4. Configure and verify trusted publishing independently for all four existing
   packages.
5. Use staged publishing for later prereleases, with downloaded-stage
   inspection and human platform-before-launcher approval.
6. Publish the ordinary stable Cask only after macOS signing/notarization and
   Gatekeeper checks pass; merge only a reviewed tap PR prepared from verified
   release data.
7. Monitor the package/release status record for partial publication and
   reconcile before any retry.

Documentation SHALL show the stable npm and Homebrew commands only for stable
releases, and SHALL clearly label `@next`/`next` installation as prerelease.
It SHALL identify the Homebrew repository as a third-party tap and SHALL not
claim Homebrew review or endorsement.

## 11. Deferred decisions

The following are intentionally deferred and require a later specification or
extension before becoming supported behavior:

- a separately named prerelease Homebrew Cask channel;
- a Homebrew source-building formula or binary formula;
- Linux ARM64, musl, Windows, or additional macOS targets;
- a lower Linux glibc baseline;
- plugin reuse of an external npm/Homebrew installation;
- plugin binary-first distribution or external lifecycle ownership; and
- submission to an official Homebrew repository.

No deferred item SHALL be introduced by changing the stable Cask, silently
loosening the npm launcher checks, or modifying Spec 016's source-build-only
plugin behavior.

## 12. Authoritative references

- [npm and Homebrew distribution analysis](../analysis/npm-homebrew-distribution-analysis-2026-08-28.md)
- [Spec 016: Herdr World plugin release](016-herdr-world-plugin-release-spec.md)
- [Packaging](../packaging.md)
- [Release process](../release.md)
- [npm `package.json` fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm staged publishing CLI](https://docs.npmjs.com/cli/v11/commands/npm-stage/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm trusted publishing configuration](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)
- [Homebrew: Adding Software](https://docs.brew.sh/Adding-Software-to-Homebrew)
- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew acceptable Casks](https://docs.brew.sh/Acceptable-Casks)
- [Homebrew taps](https://docs.brew.sh/Taps)
- [Homebrew tap trust](https://docs.brew.sh/Tap-Trust)
