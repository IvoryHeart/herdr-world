# Herdr World npm and Homebrew distribution analysis

- **Date:** 2026-08-28
- **Status:** Research complete; implementation not started
- **Repository:** `IvoryHeart/herdr-world`
- **Current application release:** `v0.1.0-rc.1`
- **Current desktop artifacts:** Linux x86-64, macOS ARM64, and macOS x86-64
- **Related decision record:** [Herdr World plugin release analysis](herdr-plugin-release-analysis-2026-08-26.md)
- **Related specification:** [Spec 016](../specs/016-herdr-world-plugin-release-spec.md)

## Executive conclusion

Herdr World should add two binary-first user distributions backed by the
existing verified desktop release artifacts:

1. A public npm launcher package with platform-specific optional packages for
   the native bridge.
2. A Homebrew Cask in a separate `IvoryHeart/homebrew-tap` repository, with
   platform- and architecture-specific URLs pointing at the GitHub release
   archives.

The npm package and Homebrew Cask should be assembled from the same release
tarballs that are already built, inspected, checksum-published, and exercised
against stock Herdr daemons. They should not introduce a second native build
pipeline or an install-time downloader for release assets.

The recommended Homebrew shape is a Cask rather than a Homebrew/core formula:
the current distribution is an upstream-provided, platform-specific binary
bundle containing a native executable and static web assets. A source-building
formula is possible, but it is a separate packaging investment. It would need
to build the web app and Rust bridge under Homebrew's dependency and sandbox
rules, and should only be chosen if the project specifically requires the
`brew install` formula workflow or eventual Homebrew/core submission.

The existing Herdr plugin plan remains conceptually compatible. The plugin
should not silently depend on whichever npm or Homebrew copy happens to be on
`PATH`; it must keep ownership of its bridge binary, static assets, version,
and service state. A later plugin extension can deliberately add an explicit
“use an installed distribution” mode or a binary-first installer, using the
same release assets.

## Current repository and release baseline

The repository is not currently an npm application package:

- The root `package.json` is private and has version `0.0.0`.
- `web/package.json` is also private and has version `0.0.0`.
- Root npm dependencies are development and Android-related dependencies; the
  web dependencies are the frontend build graph, not runtime package
  dependencies for an installed CLI.
- Release versions are tracked in `release.json`, public documentation, and
  GitHub tags. The release helper currently does not publish npm packages.

The existing desktop release is the right payload boundary. For each supported
platform, `scripts/package-tarball.sh` produces an archive containing:

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

The current `v0.1.0-rc.1` release archives are approximately 6.2–6.6 MiB
each. They contain both the bridge and the web output, so they are already
usable as the canonical binary distribution. The wrapper also preserves the
important runtime behavior: it serves the bundled web app, uses the selected
Herdr socket, and does not package Herdr itself.

The support matrix is currently:

| Target | Current artifact | npm package condition | Homebrew artifact condition |
| --- | --- | --- | --- |
| Linux x86-64 | `linux-x86_64` | `linux`, `x64`, glibc | Linux, Intel |
| macOS Apple Silicon | `macos-arm64` | `darwin`, `arm64` | macOS, ARM |
| macOS Intel | `macos-x86_64` | `darwin`, `x64` | macOS, Intel |

Linux ARM64, musl-based Linux, Windows, and Android are not included in this
distribution scope. The package managers must fail clearly on unsupported
targets rather than selecting a nearby binary.

The current `v0.1.0-rc.1` Linux bridge requires symbols through `GLIBC_2.34`.
The initial Linux runtime contract is therefore glibc 2.34 or newer unless a
separate release-build effort deliberately establishes a lower baseline.
npm's `libc: ["glibc"]` selector identifies the libc family but cannot express
or enforce a glibc version, so release-time symbol extraction and launcher
preflight are both required.

## npm distribution

### Recommended package topology

Use one user-facing package and one implementation-facing package per native
target. The selected names are:

```text
@ivoryheart/herdr-world
  ├─ optional @ivoryheart/herdr-world-linux-x64-gnu
  ├─ optional @ivoryheart/herdr-world-darwin-arm64
  └─ optional @ivoryheart/herdr-world-darwin-x64
```

Ownership of the `@ivoryheart` scope is a publication prerequisite. npm does
not provide an ordinary placeholder-reservation workflow, so the names should
be checked and then first published as one real prerelease package set rather
than occupied by placeholder packages.

The user-facing package should contain:

- the `herdr-world` executable entrypoint;
- the bundled `share/herdr-world/web` tree;
- the existing launcher behavior or a shared launcher invoked with explicit
  bridge and static-directory paths; and
- the project license, third-party notices, upstream record, and relevant
  documentation.

Each platform package should contain only the matching
`herdr-world-bridge` payload, its generated package metadata, and its complete
applicable legal closure. It should declare npm's platform selectors:

- `os` (`linux` or `darwin`);
- `cpu` (`x64` or `arm64`); and
- `libc: ["glibc"]` for the Linux build.

This follows npm's package model: `bin` exposes executables, `files` limits
the published payload, `optionalDependencies` permits platform packages to be
skipped on other targets, and `os`, `cpu`, and `libc` describe compatibility.
The main package must detect a missing or omitted optional package and print a
specific unsupported-platform/install-options message. In particular,
`npm install --omit=optional` must not result in a confusing “file not found”
failure.

The main launcher will need a packaging adaptation. The existing shell
launcher assumes that the bridge and web assets are siblings in one unpacked
tarball. npm's optional native package is installed in a package dependency
tree, so the npm entrypoint should resolve the selected native package and
pass explicit paths to the shared launcher, or the shared launcher should
accept explicit bridge and static-directory environment variables. It must not
guess from the current working directory or from a global npm prefix.

The npm package should not use `preinstall` or `postinstall` to download a
release asset. That would make installation dependent on an additional network
request, complicate package-manager script policies, and weaken the clear
registry integrity boundary. The optional package mechanism gives npm the
platform selection without an install-time downloader.

### User experience

Once scope ownership and package names are confirmed, the intended
stable-channel experience is
roughly:

```bash
npm install --global <package-name>
herdr-world
```

The prerelease experience should be explicit, for example:

```bash
npm install --global <package-name>@next
```

The command still requires a separately installed and running compatible
Herdr session. npm only installs Herdr World; it must not silently install
Herdr or change the user's Herdr workspace. The existing launcher guidance
and exact Herdr `v0.8.2` / terminal protocol `20` admission remain applicable.

`npx` can be documented as a one-off option after the package is stable, but it
should not be the primary command for a long-running bridge. A global install
has a more predictable executable and upgrade lifecycle, while a project-local
install remains available to users who prefer it.

### Package contents and metadata

The published package should be generated in a clean staging directory, not
published from the repository root. Its metadata should include:

- an approved package name and version derived from `release.json` without the
  leading `v`;
- a public repository URL matching `IvoryHeart/herdr-world` exactly;
- the project homepage, license, issue tracker, and description;
- an explicit `bin` mapping to `herdr-world`;
- an allowlisted `files` set;
- an explicit Node engine floor if the launcher uses Node at runtime; and
- exact optional-dependency versions for all platform packages.

The root and web `package.json` files can remain private development manifests.
The generated distribution metadata must not cause release automation to bump
development dependency versions or make the source workspace publishable by
accident.

The package allowlist should exclude `node_modules`, Rust targets, source
trees not needed at runtime, test evidence, Android outputs, and repository
automation. It must include the bundled legal manifest and every file it
references. Each native package must likewise carry the complete notices and
license files applicable to its bridge; legal closure is checked per package,
not only in the main package. `npm pack --dry-run` and a real install from the
generated tarballs should be mandatory release checks. npm always includes some
package metadata such as `package.json`, README, and license files; the
explicit `files` list should still be the primary boundary.

### npm publication and versioning

Publishing needs to account for npm's immutability rule: a given package name
and version cannot be reused after publication, even if the package is later
removed. The workflow should therefore stage, pack, inspect, install-test, and
hash-record all packages before the first publication call.

The release policy should be:

- stable application tags publish the package set under `latest`;
- prerelease tags such as `v0.1.0-rc.1` publish under `next` (or an approved
  equivalent), leaving `latest` on the last stable release; and
- the top-level package and every platform package use the exact same version.

npm recommends alternate dist-tags such as `next` for prereleases, and an
ordinary install resolves the `latest` tag. This makes the current release
candidate safe to publish for testers without making it the default stable
install.

The first publication cannot use staged publishing or trusted publishing as a
bootstrap mechanism: both require the package to already exist. The first real
prerelease must therefore use an operator-authenticated npm workflow with 2FA,
publishing the three platform packages before the launcher. Immediately after
bootstrap, configure GitHub-hosted OIDC trusted publishing separately for all
four packages, using the exact repository and workflow and stage-only
permission where supported.

Subsequent releases should use npm staged publishing from the GitHub-hosted
workflow. The staged-publishing CLI requires npm 11.15.0 or newer and Node
22.14.0 or newer, and the package must already exist. The workflow needs
`id-token: write`, should run `npm stage publish` for all four packages, and
must download and inspect the actual staged tarballs before human 2FA approval.
The three platform stages must be approved before the launcher stage. No
long-lived publish token should be used.

The workflow must publish the platform packages before the top-level package,
because the latter refers to exact platform package versions. It should not
publish anything until the existing native archive verification and the npm
package content checks pass.

Because four npm publications are not atomic, release status must record each
package's stage, publication result, hash, and next safe action. A transient
failure before publication may retry the identical inspected tarball. A live
package with incorrect bytes burns that application version; the complete set
must advance together, with no divergent repair versions and no replacement
of existing contents.

### npm alternatives considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| One package containing all three native binaries | Simplest launcher and publishing graph | Every install downloads unused binaries; weaker platform filtering; larger package; awkward unsupported-target behavior | Reject for the first design |
| One package per target with no top-level package | Simple artifact generation | Poor user experience; users must know target package names; no single `herdr-world` command | Reject |
| Top-level package plus optional target packages | Normal npm CLI experience; precise npm selectors; no install-time downloader | Requires a small resolver/launcher and four package publications | Recommend |
| Top-level package with a postinstall release downloader | Small registry package | Extra network and trust boundary; script-policy failures; mutable downloader behavior | Reject |
| Publish the existing private root package | No new staging layout | Root manifest is not a runtime package and is explicitly private | Reject |

## Homebrew distribution

### Package type decision

Homebrew's current guidance distinguishes the package types this way:

- a formula is for open-source command-line software and libraries that
  Homebrew can build from source;
- a Cask is for native macOS applications and supported binary-only software;
- Casks can target macOS, Linux, or both when their artifact types are
  supported on those systems.

Herdr World is open source, but the currently available public artifacts are
platform-specific prebuilt bundles. The release process does not yet provide a
Homebrew source build with Homebrew-declared Node, Rust, npm, Cargo, and web
dependency behavior. A Cask therefore matches the immediate distribution
boundary more closely and avoids compiling a large application during user
installation.

The official Homebrew Cask repository already has a closely related precedent:
the `codex` Cask selects macOS/Linux and ARM64/x86-64 release archives and
exposes a CLI binary. Herdr World needs the same platform selection plus a
wrapper and static web tree.

This should initially be a third-party Cask in a dedicated public tap, not a
claim of Homebrew review or endorsement. Homebrew's official Cask policy also
requires macOS executable artifacts to pass Gatekeeper checks. The repository
currently documents its macOS artifacts as unsigned and unnotarized, so the
stable Cask should wait for the signing/notarization work. Local implementation
and validation may use release-candidate fixtures, but the ordinary stable
Cask must not point to an RC. If a prerelease Cask is ever needed, it should be
a separately named and deliberately documented channel.

### Recommended tap and install shape

Create a separate public repository named `IvoryHeart/homebrew-tap`, with a
layout such as:

```text
homebrew-tap/
  Casks/
    herdr-world.rb
  README.md
```

Keeping the tap separate gives the formula/Cask a clean Homebrew repository,
avoids mixing Ruby package definitions into the application source tree, and
lets the tap evolve independently. A GitHub repository named
`homebrew-tap` maps to the standard short tap name `IvoryHeart/tap`.

The intended user command is:

```bash
brew install --cask IvoryHeart/tap/herdr-world
```

Homebrew's direct fully qualified install form automatically adds the tap and
limits trust to the requested item. The documentation should still explain
that third-party taps contain executable Ruby package definitions and are not
reviewed by Homebrew. Users who manually tap the repository should prefer
item-level trust rather than trusting every future item in the tap.

### Cask artifact design

The Cask should select the existing immutable release archive by OS and CPU:

```text
macOS ARM64  -> herdr-world-vX.Y.Z-macos-arm64.tar.gz
macOS x86-64 -> herdr-world-vX.Y.Z-macos-x86_64.tar.gz
Linux x86-64 -> herdr-world-vX.Y.Z-linux-x86_64.tar.gz
```

It should carry the SHA-256 for each selected archive, derive URLs only from a
versioned release tag, and fail for unsupported operating systems or
architectures. It should not use a moving `latest` URL or an unchecksummed
download.

The Cask must expose only `herdr-world`. The archive also contains
`herdr-world-bridge`, but it is an implementation binary and must not become a
second global command; it does not provide the static-directory setup that the
primary wrapper provides.

There is a path-layout issue to solve explicitly. The current wrapper computes
the web directory relative to an unpacked bundle root. A Cask stores the
archive under a versioned Caskroom path and links a `binary` artifact into the
Homebrew prefix. The packaging implementation must either:

- make the launcher resolve its real staged path reliably;
- use a Cask `command_wrapper` that passes the staged bridge and static paths;
  or
- install a Homebrew-specific wrapper that preserves the same runtime and
  security behavior.

The solution must be tested through Cask install, upgrade, reinstall, and
uninstall, not only by running the binary directly from the downloaded archive.
It must also preserve the legal files and web assets needed at runtime and
must not start Herdr, the bridge, or mutate a workspace during installation.

The Cask should not start a bridge during installation. Homebrew installation
owns files; it should not create a Herdr session, select a workspace, or leave
a background process behind. The user runs `herdr-world` after installing, and
the Herdr plugin controller remains responsible for plugin-managed lifecycle.

### Formula/source-build alternative

A Homebrew formula remains a valid later option:

```text
source release archive
  -> Homebrew Node/Rust build dependencies
  -> npm web build + locked Cargo release build
  -> formula-installed bridge, wrapper, share/herdr-world/web
```

It would provide the conventional `brew install IvoryHeart/tap/herdr-world`
command and better match the formula source-build model. It also introduces
substantial work:

- declare and test Node and Rust build dependencies;
- make npm and Cargo dependency resolution work reproducibly under Homebrew's
  build environment;
- decide whether the web dependency graph must be represented as Homebrew
  resources or otherwise made available before the build sandbox runs;
- provide a meaningful source-build test on macOS and Linux;
- maintain formula-specific install paths and upgrade behavior; and
- decide whether the formula is merely a third-party tap package or is intended to
  meet `homebrew/core` acceptance requirements.

A third-party binary formula could be made to install the existing archives,
but that would blur the formula/Cask boundary and should not be presented as a
candidate for Homebrew/core. It is explicitly deferred. If the project
specifically requires the exact `brew install` formula command, this option
should be designed and validated as its own workstream rather than smuggled
into the Cask implementation.

### Homebrew alternatives considered

| Option | Benefits | Costs / risks | Decision |
| --- | --- | --- | --- |
| Third-party Cask from release archives | Reuses verified binaries; no Node/Rust on client; supports current macOS/Linux artifact matrix | `brew install --cask`; Caskroom path adaptation; unsigned macOS limitation | Recommend now |
| Source-building formula | Conventional formula UX; most aligned with open-source CLI packaging | New Homebrew build system, dependencies, sandbox/resource work, slower installs | Later option |
| Binary formula in third-party tap | `brew install` UX and easy archive reuse | Not appropriate for Homebrew/core; weaker package-type semantics; still needs path adaptation | Only if exact formula UX is a hard requirement |
| Cask in the main application repository | One repository | Nonstandard tap setup, mixed concerns, harder independent updates | Reject |
| Official Homebrew/core or cask submission immediately | Wider discovery and trust | Current unsigned/unnotarized macOS binaries and immature packaging boundary | Defer |

## Shared artifact and release architecture

The three distribution channels should converge on one release artifact graph:

```text
tagged release commit
        |
        +--> native matrix build and live Herdr smoke
        |       |
        |       +--> GitHub release archives + SHA-256 files
        |       +--> npm platform packages
        |       +--> npm launcher package
        |       +--> Homebrew Cask version/checksum update
        |
        +--> Herdr plugin source-build or future binary-first install
```

The important invariant is that npm and Homebrew must not rebuild a different
bridge from a different commit after the desktop archives have passed release
verification. The existing release matrix should remain the source of native
truth. The npm packager can extract the verified archive into its staging
layout; the Cask should reference the immutable archive directly.

Before npm generation, release validation must compare a canonical sorted
relative-path/SHA-256 manifest for the shared launcher, web assets,
documentation, and legal payload across all three archives. Platform-specific
bridge files are excluded from this common-payload identity check. Only after
that check succeeds may the designated verified Linux x86-64 archive supply the
common npm payload.

The current release process creates the GitHub release before the archive
upload workflow completes. Publication sequencing should therefore be explicit:

1. Build and inspect every native archive.
2. Run the existing stock-Herdr live smoke for every target.
3. Verify common-payload identity across the three archives.
4. Upload and verify the complete GitHub release asset set.
5. Build and inspect npm package tarballs from those verified assets.
6. Install-test and hash-record the npm tarballs.
7. Bootstrap-publish, or stage and approve, the npm package set under the
   selected dist-tag.
8. Update or dispatch the Homebrew tap change after its stable/signing gates,
   then fetch/install-test the Cask.

The Homebrew tap update needs its own authorization and failure behavior. A
source repository release should not silently rewrite an external tap unless
the owner explicitly chooses a narrowly scoped bot or GitHub App flow. A safer
first approach is a generated pull request or a controlled release workflow in
the tap that updates the version, three checksums, and release URL only after
the complete source release is available. The PR must pass Cask audit/style
and install checks and require review.

All public package versions should derive from the same release tag after
removing only the leading `v`. The root development package versions should
remain independent and private. The plugin manifest in Spec 016 already
introduces a second public versioned surface, so the release validation should
eventually check the plugin manifest, npm staging metadata, GitHub tag, and
Homebrew Cask version together without publishing a package as a side effect
of a local development build.

## Relationship to the Herdr plugin

The npm and Homebrew packages are standalone distributions; they do not change
the plugin's product shape. In particular:

- The Herdr plugin remains a thin lifecycle facade around the bridge and web
  client.
- The plugin should not use a global npm or Homebrew installation implicitly,
  because that can pair a controller with a mismatched bridge/static asset
  version.
- The plugin's source-build path can remain the deterministic first path from
  Spec 016.
- A future plugin binary-first path can download the same GitHub archive and
  verify its SHA-256 before extracting it.
- An optional “use external installation” mode should require an explicit path
  or configuration and should verify the application version and asset pairing.
- Homebrew must not be made the service supervisor for a bridge tied to a
  particular Herdr socket. Plugin-managed services belong to the plugin
  controller; standalone package-manager users run the ordinary launcher.

This means the packaging tranche is related to Spec 016 but is independently
specified. It should not make npm or Homebrew installation a hidden prerequisite
for installing the Herdr plugin.

## Security, compatibility, and support risks

### Supply chain

- npm package publication is irreversible at the name/version level; package
  contents must be inspected before publication.
- npm trusted publishing and provenance should be configured for all packages,
  not only the launcher package.
- Homebrew tap Ruby is executable with the user's privileges. Documentation
  must explain third-party tap trust and use fully qualified install commands.
- Homebrew Cask artifacts are upstream-trusted installation inputs. Release
  archives and checksums must remain immutable and publicly auditable.
- Neither package manager changes the bridge's security model. The bridge
  still grants admitted browser clients terminal-equivalent control, and
  Host/Origin/CSP checks are not authentication.

### Runtime compatibility

- The packages still require Herdr `v0.8.2` or newer and terminal protocol
  `20`.
- The packages must preserve loopback defaults and the existing explicit LAN
  host/origin configuration rules.
- The launcher must work from npm's dependency tree and Homebrew's Caskroom or
  keg path, including after upgrades.
- Uninstalling either distribution must not delete unrelated plugin state or
  silently stop a bridge that another process owns. Documentation should tell
  users to stop a managed bridge before uninstalling its distribution.

### Platform lifecycle

- macOS artifacts are currently unsigned and unnotarized. Keep the existing
  limitation in npm, Homebrew, and release documentation; do not suggest
  bypassing Gatekeeper. The ordinary `herdr-world` Cask is stable-only until
  signing, notarization, and applicable Gatekeeper checks pass.
- Homebrew documents a future phase-out of Intel macOS support after Apple's
  announced transition. The repository can keep shipping Intel while it is in
  the tested matrix, but the Homebrew support promise should be reviewed
  before the next platform policy change.
- Linux support should state the glibc baseline and distinguish unsupported
  musl or ARM systems from package-manager failures. The launcher should
  report required and detected glibc versions before execution.

## Proposed validation matrix for the follow-up spec

### npm

- Generate all packages from the final tagged release artifacts.
- Assert the exact package file list with `npm pack --dry-run`.
- Install the launcher package on Linux x86-64, macOS ARM64, and macOS x86-64.
- Verify each host gets only its matching optional native package.
- Verify unsupported combinations and `--omit=optional` produce actionable
  errors.
- Run `herdr-world --help` without a running Herdr session.
- Run the existing packaged bridge live smoke against stock Herdr `v0.8.2`.
- Verify package versions, optional dependency versions, release tag, legal
  assets in every package, common-payload identity, GLIBC symbol baseline, and
  npm dist-tag policy.
- Exercise missing and mismatched platform packages, path overrides, glibc
  below/at/above the floor, and partial-publication recovery without replacing
  existing package contents.
- Exercise a clean publish dry run before any immutable publication.

### Homebrew

- Run Cask audit/style checks from the tap checkout.
- Fetch all three versioned URLs and independently verify their SHA-256 values.
- Install and uninstall the Cask on Linux x86-64, macOS ARM64, and macOS
  x86-64 where those Homebrew targets are available.
- Verify the `herdr-world` command, wrapper-to-asset resolution, permissions,
  and `--help` behavior.
- Upgrade from one Cask version to the next and confirm the command points at
  the new staged assets.
- Reinstall and uninstall the Cask and confirm Caskroom/symlink resolution,
  legal assets, and no daemon or workspace mutation during installation.
- Run the live Herdr bridge smoke separately from the Homebrew no-daemon test.
- Document the current unsigned/unnotarized macOS behavior and confirm no
  installation step weakens Gatekeeper.

### Shared release checks

- Confirm all package-manager versions match the release tag without `v`.
- Confirm all release channels handle prereleases deliberately.
- Confirm npm, Homebrew, tarball, and future plugin installs use the same
  compatibility and platform matrix.
- Confirm the desktop tarball and Android packaging behavior remains unchanged.

## Decisions carried into Spec 017

The follow-up specification resolves the research questions as follows:

1. Use the four scoped names shown above, subject to ownership of the
   `@ivoryheart` scope. Check name availability as a publication prerequisite;
   do not publish placeholders because npm has no ordinary name-reservation
   workflow. Bootstrap with the first real prerelease.
2. Use a Node 22.14.0-or-newer npm launcher with package-resolution-based
   platform selection and explicit validated bridge/static paths.
3. Use `next` for prereleases and `latest` only for stable package sets.
4. Use the public third-party tap `IvoryHeart/homebrew-tap` and
   `brew install --cask IvoryHeart/tap/herdr-world`.
5. Defer both source-building and binary Homebrew formulas.
6. Keep the ordinary `herdr-world` Cask stable-only until macOS signing,
   notarization, and Gatekeeper checks pass. A hypothetical prerelease Cask
   would need a separate name and documented channel.
7. Preserve Spec 016's source-build-only plugin and defer package-manager
   discovery or external binary reuse.
8. Use a generated, reviewed tap pull request with narrowly scoped bot or
   GitHub App credentials.

## Recommended implementation order

1. Establish ownership of the npm scope, select the package names, and create
   the public Homebrew tap repository.
2. Extract a shared release-payload staging helper from the current tarball
   layout, preserving all legal and web assets.
3. Implement and test the npm launcher plus platform packages.
4. Implement the Homebrew Cask and solve Caskroom wrapper path resolution.
5. Add package-manager checks to the tagged release workflow, leaving local
   source builds and desktop tarballs intact.
6. Publish the first npm prerelease only under an explicit non-stable tag.
7. Publish the ordinary Homebrew Cask only after the stable signing and
   notarization gate; use only separately named prerelease work if that later
   channel is explicitly specified.
8. Keep any explicit plugin reuse of installed distributions in a later
   contract rather than changing Spec 016 implicitly.

## Sources

### npm

- [npm `package.json` fields](https://docs.npmjs.com/files/package.json/) —
  `bin`, `files`, `optionalDependencies`, `os`, `cpu`, and `libc`.
- [npm publish](https://docs.npmjs.com/cli/commands/npm-publish/) — package
  contents, dry runs, access, and immutable name/version publication.
- [npm dist-tags](https://docs.npmjs.com/cli/dist-tag/) — stable `latest` and
  prerelease tags such as `next`.
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) — GitHub
  OIDC setup, Node/npm requirements, and automatic provenance.
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/) —
  repository matching and GitHub Actions requirements.

### Homebrew

- [Adding Software to Homebrew](https://docs.brew.sh/Adding-Software-to-Homebrew)
  — formula versus Cask selection and local validation commands.
- [Cask Cookbook](https://docs.brew.sh/Cask-Cookbook) — `binary`,
  `command_wrapper`, checksums, and artifact behavior.
- [Acceptable Casks](https://docs.brew.sh/Acceptable-Casks) — platform support
  and macOS Gatekeeper requirements.
- [Taps](https://docs.brew.sh/Taps) — tap naming and direct installation.
- [Tap Trust](https://docs.brew.sh/Tap-Trust) — trust scope for third-party tap
  code.
- [Official Codex Cask](https://github.com/Homebrew/homebrew-cask/blob/main/Casks/c/codex.rb)
  — a current macOS/Linux ARM64/x86-64 CLI binary Cask precedent.
- [Homebrew on Linux](https://docs.brew.sh/Homebrew-on-Linux) — Linux Homebrew
  installation and glibc/support context.

### Herdr World and Herdr

- [Existing packaging](../packaging.md)
- [Existing release process](../release.md)
- [Herdr plugin release analysis](herdr-plugin-release-analysis-2026-08-26.md)
- [Spec 016](../specs/016-herdr-world-plugin-release-spec.md)
- [Herdr plugin documentation](https://herdr.dev/docs/plugins/)
- [Herdr marketplace](https://herdr.dev/docs/marketplace/)
- [Herdr socket API](https://herdr.dev/docs/socket-api/)
