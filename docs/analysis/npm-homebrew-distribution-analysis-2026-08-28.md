# Herdr World npm and Homebrew distribution analysis

- **Date:** 2026-08-28
- **Status:** Research complete; implementation not started
- **Repository:** `IvoryHeart/herdr-world`
- **Related specification:** [Spec 017](../specs/017-herdr-world-npm-homebrew-distribution-spec.md)
- **Related research:** [Herdr plugin release analysis](herdr-plugin-release-analysis-2026-08-26.md)

## Conclusion

The right release model is one release pipeline with small channel adapters. A
final tag produces and validates the native archives once, then supplies the
same release version and verified release record to npm, Homebrew, and future
distribution channels. Package-manager channels reuse the native outputs; the
Herdr plugin remains governed by Spec 016 and its source-build contract.

The current `v0.1.0-rc.1` release is useful as an installation test fixture. It
must not become a special case or a version assumption in future release work.

The initial package-manager channels are:

1. one universal public npm package, `@ivoryheart/herdr-world`, containing the
   shared payload and all three desktop bridges; and
2. one stable-only direct-archive Cask in the public third-party tap
   `IvoryHeart/homebrew-tap`.

## Findings

The repository already produces desktop archives with the native bridge, web
assets, launcher, documentation, and legal material. Those verified archives
should remain the only native source. Rebuilding a bridge for npm or Homebrew
would create drift and another release path.

The universal npm package is the smallest initial topology. It avoids a
platform-package graph while retaining one command and one version. The Cask
can use the existing immutable archives directly; it does not need a second
Homebrew binary or a source build.

The exact supported targets and runtime checks belong in the existing packaging
and release documentation. They should be tested by the release pipeline, but
they should not turn this distribution contract into a copy of every launcher,
libc, or workflow detail.

## Recommended release flow

For every intentional final tag:

1. build all native archives;
2. verify contents, legal closure, formats, checksums, and live smoke;
3. expose the verified outputs to the release adapters;
4. generate, inspect, install-test, and hash the exact npm package;
5. for a prerelease, publish npm under its prerelease channel without updating
   the stable Cask; for a stable release, generate and complete Cask validation,
   then publish npm under the stable channel and write the validated Cask update
   to the third-party tap; and
6. run any future adapters against the same version and release record.

Prereleases use the npm prerelease channel and leave the stable Cask unchanged.
Stable releases use the stable npm channel and update the ordinary Cask.
Branches and pull requests never publish.

The release tag is the version source. No future release should require editing
the same fixed version in multiple manifests or repeating a special bootstrap
procedure. Publication credentials and npm scope/tap ownership are setup
prerequisites; they should not create per-release manual work.

Retries are deliberately simple. An adapter may check whether the exact version
and contents are already present and no-op. Published bytes are immutable; a
wrong publication uses a new release version. No publication database, staged
workflow, or recovery service is needed for the initial design.

## Channel contracts

### npm

The package contains the shared launcher behavior, web assets, documentation,
legal assets, and all three native bridges. It exposes only `herdr-world`,
selects the bridge for the supported host, and never downloads or builds a
bridge during installation.

The package is packed and tested before publication, and the published tarball
is the tested tarball. The public package version comes from the final release
tag. Platform-specific npm packages remain deferred until measured evidence
shows the universal package is impractical.

### Homebrew

The Cask is stable-only and references the immutable GitHub release archives and
checksums for the existing supported desktop targets. CI generates, validates,
and, after stable npm publication, writes the small validated Cask metadata
update to `IvoryHeart/homebrew-tap`. There is no separate binary upload,
installer daemon, workspace mutation, or moving `latest` URL.
On retry, CI compares the complete generated Cask with the tap and no-ops when
they already match.

The tap is third-party and must not be described as reviewed or endorsed by
Homebrew. A source formula, binary formula, or separately named prerelease Cask
is deferred.

### Future channels and plugin boundary

A future distribution channel should consume the same release version and
verified release record through one adapter, reusing the artifact set where its
own contract permits. It should add its credentials, metadata, validation, and
publication step without changing native archive production or existing
channels.

Spec 016 remains source-build-only and owns plugin lifecycle. The plugin does
not discover npm or Homebrew installations implicitly. Any external-installation
mode needs an explicit plugin contract covering paths, versions, pairing, and
ownership.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A channel builds different native bytes | Require every adapter to consume verified release outputs |
| A release version drifts between channels | Derive every channel version from the final tag |
| A failed retry overwrites immutable content | Check the channel before retry; no-op when exact, compare the complete generated Cask, and use a new version when different |
| A future channel expands release complexity | Require a small adapter with the same release inputs |
| Package installation changes runtime state | Test no downloader, daemon, workspace mutation, or Herdr startup |

## Deferred decisions

- platform-specific npm packages;
- staged publication and publication state tracking;
- source-building Homebrew formulas;
- unsupported targets such as Linux ARM64, musl Linux, and Windows; and
- plugin reuse of external package-manager installations.

## Sources

### Repository

- [README](../../README.md)
- [Web README](../../web/README.md)
- [Packaging](../packaging.md)
- [Release](../release.md)
- [Spec 016](../specs/016-herdr-world-plugin-release-spec.md)

### npm and Homebrew

- [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)
- [Homebrew taps](https://docs.brew.sh/Taps)
