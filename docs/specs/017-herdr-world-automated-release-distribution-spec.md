# Herdr World automated release distribution

- **Spec ID:** `017-herdr-world-automated-release-distribution`
- **Status:** In review
- **Created:** 2026-08-28
- **Owner:** IvoryHeart / Herdr World
- **Reviewers:** IvoryHeart
- **Approved by:** —
- **Approved at:** —
- **Supersedes:** all earlier drafts of Spec 017

## Purpose

Herdr World SHALL have one versioned release operation that builds the native
application once and automatically publishes every enabled distribution channel.
npm, Homebrew, the Herdr plugin, and future Android or iOS publishers are outputs
of that release; they are not separate operator-run release procedures.

The operator interface remains:

```bash
node scripts/release.mjs vX.Y.Z
node scripts/release.mjs vX.Y.Z-rc.N
```

## Decisions

| Concern | Decision |
| --- | --- |
| Release identities | Stable `vX.Y.Z`; prerelease `vX.Y.Z-rc.N` only |
| Release authorization | Protected release tags pointing at a stamped commit on protected `main` |
| Orchestration | One tag-triggered GitHub Actions workflow |
| Native build | Existing Linux x86-64, macOS ARM64, and macOS x86-64 matrix |
| GitHub | Draft-first release assembly; repository immutability deferred initially |
| npm | One universal public package, `@ivoryheart/herdr-world` |
| npm authentication | One manual 2FA bootstrap, then GitHub Actions OIDC |
| npm channels | `next` for RCs; `latest` for stable releases |
| Homebrew type | Prebuilt binary Formula in `IvoryHeart/homebrew-tap` |
| Homebrew channels | `herdr-world-rc` for RCs; `herdr-world` for stable releases |
| Tap update | Validate, then commit directly with a tap-scoped token; no tap PR |
| Other channels | Same tag, workflow, version, summary, and retry contract |

## Scope

This specification defines release identity, ordering, artifact reuse,
credentials, npm and Homebrew package shape, channel selection, safe retries, and
the boundary for plugin and future publishers.

It does not:

- enable GitHub immutable releases during initial rollout;
- make independent registries transactional;
- publish moving Git tags such as `latest`, `next`, `v1`, or `v1.2`;
- permit a published version to be reused;
- publish either development `package.json`;
- split npm into platform packages initially;
- build or download native code during package-manager installation;
- submit to official Homebrew repositories;
- redefine Herdr plugin runtime lifecycle; or
- publish unsigned Android or iOS production applications.

## Release identity

Every public release tag SHALL match exactly one of these forms:

```text
vMAJOR.MINOR.PATCH
vMAJOR.MINOR.PATCH-rc.NUMBER
```

Version components SHALL be base-10 integers without leading zeroes, except for
the value `0`. The RC number SHALL be positive. Other prerelease labels and build
metadata are invalid.

The Git tag is the release identity. `release.json`, the changelog, public
documentation, plugin metadata, package manifests, artifact names, and channel
versions SHALL agree with it. Formats that do not accept the `v` prefix SHALL
remove that prefix and no other text.

The release command SHALL reject an invalid or existing local tag, origin tag,
GitHub release, npm version, or conflicting Homebrew version before publication.
It SHALL NOT support same-version reissue. Upstream remotes SHALL be fetched
without importing unrelated tags into the Herdr World release namespace.

Release candidates SHALL increment `N` for corrections. A correction after
`v1.2.3-rc.2` is `v1.2.3-rc.3`, never a replacement `rc.2`.

### Channel monotonicity

A unique version SHALL NOT move a distribution channel backwards. The release
preflight and each publisher immediately before mutation SHALL read the current
target channel version and compare it with the candidate using SemVer precedence:

- stable releases compare with npm `latest` and the stable Homebrew Formula;
- RC releases compare with npm `next` and the RC Homebrew Formula; and
- a candidate SHALL be strictly greater than every existing target-channel
  version it would change.

Stable and RC channels are ordered independently; a stable patch may therefore
advance `latest` while a later-version RC remains on `next`. An absent channel
has no ordering constraint. An equal version is permitted only for the matching
content retry described below and SHALL NOT replace content. A lower version,
including a previously unused version, SHALL fail before any channel mutation.

## One release workflow

Except for the one-time npm bootstrap defined below, a valid release-tag push
SHALL be the only event that can publish. Pull-request and manual workflow runs
MAY build and validate synthetic versions, but SHALL NOT create tags, releases,
registry versions, plugin publications, or tap commits.

### Release authorization and provenance

The repository SHALL protect `main` and release tags matching `v*` with GitHub
rulesets. Release-tag creation SHALL be restricted to authorized release
maintainers, and release tags SHALL not be movable or deletable through the
normal release path.

Before any publication job receives npm OIDC permission or the Homebrew tap
secret, a credential-free validation job SHALL fetch the canonical
`origin/main` and prove all of the following:

- the ref matches one of the two allowed release-tag forms;
- the tag resolves to `GITHUB_SHA` and that commit is an ancestor of the fetched
  protected `origin/main`;
- the commit is the correctly stamped `Release <tag>` commit; and
- its changelog, `release.json`, manifests, and other public version references
  agree with the tag.

Publication jobs SHALL depend on that validation result and SHALL be the only
jobs granted their channel credential. The local release helper performs the
same checks for early feedback but is not the authorization boundary.

The release workflow SHALL:

1. Validate the tag, tagged commit, changelog, stamped metadata, release target,
   and external version availability.
2. Build and verify the three native archives with the existing runner matrix,
   package checks, dependency notices, and stock-Herdr live smoke.
3. Assemble the complete GitHub release as a draft and publish it only after all
   required GitHub assets are present.
4. Package, test, and publish each enabled downstream channel from the tagged
   commit and verified outputs.
5. Report every channel's version, result, and public URL in the workflow
   summary.

An enabled channel SHALL fail with a specific setup instruction when its external
prerequisite is absent. It SHALL NOT be silently skipped. The explicitly
authorized first-package npm bootstrap is the sole exception and SHALL be
reported as an incomplete, action-required npm publication until verified.

### Native artifact boundary

These verified archives remain the only initial native build outputs:

| Target | Archive |
| --- | --- |
| Linux x86-64, glibc 2.34+ | `herdr-world-vX.Y.Z-linux-x86_64.tar.gz` |
| macOS ARM64 | `herdr-world-vX.Y.Z-macos-arm64.tar.gz` |
| macOS x86-64 | `herdr-world-vX.Y.Z-macos-x86_64.tar.gz` |

npm and Homebrew SHALL consume those archives or their extracted files. They
SHALL NOT rebuild the bridge or web application. Before publication, the
workflow SHALL verify version, target, archive and bridge digests, native format,
Linux glibc floor, checksum, and complete legal manifest.

### Initial GitHub mutability

Repository-level GitHub release immutability SHALL remain disabled while the
multi-channel pipeline is established. Draft-first assembly is still required so
a normal release is not intentionally published with missing assets.

GitHub assets may be repaired before downstream publication during this initial
phase. After npm or another immutable registry accepts a version, any correction
requires a new RC or stable version even while the GitHub setting remains
mutable.

Enabling GitHub immutable releases later is an owner-operated repository setting,
not a release-format change.

## npm distribution

The public package SHALL be `@ivoryheart/herdr-world`. The repository root and
web manifests SHALL remain private. Release packaging SHALL generate a separate
publish directory with an explicit file allowlist.

The package SHALL:

- expose only the `herdr-world` command;
- derive its version from the release tag;
- declare public access and the exact Herdr World repository;
- require Node.js 22.14.0 or newer;
- contain the shared launcher, web assets, documentation, and legal payload once;
- contain bridges for Linux x64, macOS ARM64, and macOS x64 at fixed internal
  paths;
- choose the bridge using platform, architecture, and Linux libc;
- reject unsupported targets, musl, unknown libc, and glibc below 2.34 before
  native execution;
- resolve all runtime files from its installed package location;
- forward arguments, streams, signals, and exit status;
- make `herdr-world --help` succeed without Herdr or a bridge process; and
- have no install-time downloader, native build, Herdr onboarding, or process
  start.

The workflow SHALL run `npm pack`, inspect and record the exact file list,
manifest, SHA-256, and npm integrity, install-test that tarball on all three
targets, and publish that same tarball without repacking it.

Release candidates SHALL publish with `next`. Stable releases SHALL publish with
`latest`. An RC SHALL never move `latest`.

### npm bootstrap and authentication

Because npm requires the package to exist before trusted publishing can be
configured, exactly one publication event MAY occur outside the tag-triggered
publisher. This exception is allowed only while
`@ivoryheart/herdr-world` does not exist and SHALL proceed as follows:

1. A valid RC tag triggers the normal protected release workflow.
2. The workflow generates, inspects, and install-tests the npm tarball, then
   retains that exact `.tgz` as an artifact and records its artifact name,
   source tag and commit, file list, SHA-256, and npm integrity in the workflow
   record.
3. The owner downloads that artifact, verifies its SHA-256 against the workflow
   record, and publishes that file unchanged with interactive 2FA, public
   access, and the `next` dist-tag. The owner SHALL NOT rebuild, repack, or
   substitute a placeholder package.
4. The registry result is fetched and verified against the recorded version and
   integrity before the npm channel is reported complete.
5. The exact release workflow is registered as the npm trusted publisher before
   another version is released.

The bootstrap SHALL be recorded in the tagged workflow summary. It does not
authorize manual publication of any later version, any different tarball, or a
stable package as the first package.

After bootstrap, the exact release workflow SHALL be registered as the npm
trusted publisher. Publication SHALL use a GitHub-hosted runner with
`id-token: write`, Node.js 22.14.0 or newer, and npm 11.5.1 or newer. It SHALL
require no `NPM_TOKEN`, and npm provenance SHALL remain enabled.

## Homebrew distribution

Homebrew SHALL use prebuilt Formulae in the public third-party tap
`IvoryHeart/homebrew-tap`:

| Release | Formula | Install command |
| --- | --- | --- |
| Stable | `herdr-world` | `brew install IvoryHeart/tap/herdr-world` |
| RC | `herdr-world-rc` | `brew install IvoryHeart/tap/herdr-world-rc` |

The two Formulae SHALL be generated from one repository-owned generator or
template and SHALL conflict so both cannot link `herdr-world`. Stable releases
advance only the stable Formula; RCs advance only the RC Formula.

Each Formula SHALL select an exact versioned GitHub archive and SHA-256 for the
current OS and CPU. It SHALL install the complete bundle under its private prefix
or `libexec` and expose only the existing `herdr-world` launcher in Homebrew's
`bin`.

Formula installation SHALL NOT invoke the bundle installer, install Herdr, start
Herdr or the bridge, create a workspace, or change bridge security defaults.

Before updating the tap, the release workflow SHALL audit and exercise the
generated Formula on Linux x86-64, macOS ARM64, and macOS x86-64, including
install, `herdr-world --help`, upgrade or reinstall where applicable, and
uninstall. It SHALL then commit the validated Formula directly to the tap's
default branch without opening a tap pull request.

The tap update SHALL use `HOMEBREW_TAP_TOKEN`, a fine-grained personal access
token restricted to `IvoryHeart/homebrew-tap` with only the contents permissions
needed to read and update Formulae. A GitHub App MAY replace it later without
changing this distribution contract.

## Plugin and future channels

When the Herdr plugin is present, its manifest version SHALL match the release
and its publication or discoverability update SHALL run in the same workflow.
This specification does not change plugin installation, build, supervision,
configuration, or runtime lifecycle.

A future channel SHALL join the same workflow and define only its necessary
adapter:

- mapping from the release identity to platform version fields;
- build, signing, and validation prerequisites;
- stable and RC channel behavior;
- least-privilege credential;
- immutable external identity and retry check; and
- publication result included in the workflow summary.

A new channel SHALL NOT introduce a second operator release command or rebuild
another channel's artifacts.

## Retry and failure contract

Independent registries cannot publish atomically. Each publisher SHALL inspect
external state and recheck target-channel monotonicity immediately before
mutation:

- absent version: publish it;
- matching version and digest or generated content: report complete and succeed;
- same version with different content: fail without replacement and require a
  new release version.

A matching-version retry MAY complete a missing pointer update only when the
candidate still advances or equals that pointer; it SHALL never regress it.

A workflow rerun after partial failure SHALL resume incomplete channels and skip
verified successful channels. It SHALL not rebuild solely to retry publication.
The summary SHALL distinguish published, already complete, failed, and not yet
enabled channels.

## Security

- Publication jobs SHALL use least-privilege job-level GitHub permissions.
- Protected `main` and release-tag rulesets plus the credential-free provenance
  gate SHALL be the release authorization boundary.
- Pull-request and fork workflows SHALL receive neither publication credentials
  nor a publishing OIDC permission.
- npm SHALL use OIDC after bootstrap, not a stored npm publishing token.
- `HOMEBREW_TAP_TOKEN` SHALL be restricted to the tap and SHALL not enter an
  artifact, cache, Formula, or log.
- Package installation SHALL perform no download, build, setup, workspace
  mutation, or background process start.
- Release URLs SHALL use exact versions, never a moving `latest` URL.
- The workflow record SHALL retain source commit, checksums, npm integrity,
  native digests, and publication identifiers.
- Existing bridge Host, Origin, CSP, loopback, and upload behavior remain
  unchanged. Package-manager installation is not authentication.

## Acceptance

Implementation is complete when automated evidence shows:

- only the two specified version forms are accepted and reused versions fail
  before mutation;
- a lower unique version fails before changing npm or Homebrew, while a verified
  same-version retry remains idempotent;
- an unprotected tag or a tag whose commit is not correctly stamped and
  reachable from protected `origin/main` cannot reach publication credentials;
- pull-request and manual runs exercise packaging without publication;
- the native matrix builds and live-smokes each archive once;
- GitHub releases are draft-first and contain the complete asset set;
- the exact tested npm tarball is published through OIDC with the correct
  `next` or `latest` tag;
- the one-time npm bootstrap publishes the workflow artifact unchanged, records
  its digest and integrity, and cannot authorize a later manual publication;
- npm selects the right bridge on every supported target and rejects unsupported
  targets before execution;
- the correct Homebrew Formula alone advances for an RC or stable release;
- both Formulae pass supported-runner audit and lifecycle tests before a direct
  tap commit;
- plugin metadata, when present, matches the release;
- retry tests skip a matching published npm version and complete an absent tap
  update; and
- `npm run check` remains green with desktop, Android development, and runtime
  behavior outside distribution unchanged.

## Rollout and deferred work

Initial rollout SHALL:

1. Implement strict version validation and remove reissue support.
2. Add npm and Formula generation, dry-run validation, and retry tests.
3. Protect `main` and `v*` tags, then add the credential-free provenance gate.
4. Create `IvoryHeart/homebrew-tap` and configure its restricted token.
5. Tag the first real npm RC; generate, inspect, and test its tarball in the
   protected workflow; then manually publish that exact artifact with 2FA.
6. Verify the bootstrap registry content, configure npm trusted publishing, and
   ensure no npm publishing token is stored.
7. Run a non-publishing dry run, then publish the next unique RC through the
   complete pipeline.
8. Update operator and installation documentation.

Deferred decisions are:

- enabling GitHub immutable releases after the owner confirms the pipeline is
  stable;
- replacing the tap PAT with a GitHub App if token ownership or rotation becomes
  burdensome;
- splitting npm by platform only when measured size or new targets justify it;
- adding Linux ARM64, musl, Windows, Android, iOS, or another target with its own
  validated adapter; and
- considering official Homebrew submission separately from the supported
  third-party Formula.

## References

- [Release process](../release.md)
- [Packaging](../packaging.md)
- [Repository release workflow](../../.github/workflows/release.yml)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm publishing](https://docs.npmjs.com/cli/commands/npm-publish/)
- [npm dist-tags](https://docs.npmjs.com/cli/commands/npm-dist-tag/)
- [Homebrew package selection](https://docs.brew.sh/Adding-Software-to-Homebrew)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Homebrew taps](https://docs.brew.sh/Taps)
- [GitHub Actions token scope](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHub immutable releases](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases)
